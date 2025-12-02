import { privateProcedure, router } from '../trpc';
import { driveFile, driveFolder, driveImportJob, driveShare, user } from '../../db/schema';
import { eq, and, isNull, desc, asc, or, sql, like } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type * as schema from '../../db/schema';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { env } from '../../env';
import jwt from '@tsndr/cloudflare-worker-jwt';
import { resend } from '../../lib/services';

// Helper to get file extension
function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

// Helper to check if file is editable in OnlyOffice (excludes PDF - PDF is view-only)
function isEditableInOnlyOffice(_mimeType: string, filename: string): boolean {
  const ext = getFileExtension(filename);
  const editableExtensions = [
    // Documents
    'doc', 'docx', 'odt', 'rtf', 'txt',
    // Spreadsheets
    'xls', 'xlsx', 'ods', 'csv',
    // Presentations
    'ppt', 'pptx', 'odp',
  ];
  return editableExtensions.includes(ext);
}

// Helper to check if file can be previewed (includes PDF)
function isPreviewable(mimeType: string, filename: string): boolean {
  const ext = getFileExtension(filename);
  const previewableExtensions = [
    // Documents
    'doc', 'docx', 'odt', 'rtf', 'txt',
    // Spreadsheets
    'xls', 'xlsx', 'ods', 'csv',
    // Presentations
    'ppt', 'pptx', 'odp',
    // PDF
    'pdf',
    // Images
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
    // Videos
    'mp4', 'webm', 'ogg', 'mov',
  ];
  // Also check MIME type for videos and images
  if (mimeType.startsWith('video/') || mimeType.startsWith('image/')) {
    return true;
  }
  return previewableExtensions.includes(ext);
}

// Check if file is a PDF
function isPdf(filename: string): boolean {
  return getFileExtension(filename) === 'pdf';
}

// Check if file is an image
function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

// Check if file is a video
function isVideo(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

// Helper to get mime type category
function getMimeCategory(mimeType: string): 'document' | 'spreadsheet' | 'presentation' | 'pdf' | 'image' | 'video' | 'audio' | 'other' {
  if (mimeType.includes('word') || mimeType.includes('document') || mimeType === 'text/plain') return 'document';
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType === 'text/csv') return 'spreadsheet';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'presentation';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'other';
}

export const driveRouter = router({
  // List files and folders in a directory
  listContents: privateProcedure
    .input(
      z.object({
        folderId: z.string().nullable().optional(), // null or undefined = root
        sortBy: z.enum(['name', 'created', 'updated', 'size']).default('name'),
        sortOrder: z.enum(['asc', 'desc']).default('asc'),
        filter: z.enum(['all', 'files', 'folders', 'starred', 'trashed']).default('all'),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const { folderId, sortBy, sortOrder, filter } = input;

      // Get folders (unless filtering for files only or trashed)
      let folders: typeof driveFolder.$inferSelect[] = [];
      if (filter !== 'files' && filter !== 'trashed') {
        const folderConditions = [eq(driveFolder.userId, sessionUser.id)];

        if (folderId) {
          folderConditions.push(eq(driveFolder.parentId, folderId));
        } else {
          folderConditions.push(isNull(driveFolder.parentId));
        }

        folders = await ctx.db
          .select()
          .from(driveFolder)
          .where(and(...folderConditions))
          .orderBy(sortOrder === 'asc' ? asc(driveFolder.name) : desc(driveFolder.name));
      }

      // Get files
      let files: typeof driveFile.$inferSelect[] = [];
      if (filter !== 'folders') {
        const fileConditions = [eq(driveFile.userId, sessionUser.id)];

        if (filter === 'trashed') {
          fileConditions.push(eq(driveFile.isTrashed, true));
        } else {
          fileConditions.push(eq(driveFile.isTrashed, false));

          if (filter === 'starred') {
            fileConditions.push(eq(driveFile.isStarred, true));
          } else if (folderId) {
            fileConditions.push(eq(driveFile.folderId, folderId));
          } else {
            fileConditions.push(isNull(driveFile.folderId));
          }
        }

        const orderByColumn = {
          name: driveFile.name,
          created: driveFile.createdAt,
          updated: driveFile.updatedAt,
          size: driveFile.size,
        }[sortBy];

        files = await ctx.db
          .select()
          .from(driveFile)
          .where(and(...fileConditions))
          .orderBy(sortOrder === 'asc' ? asc(orderByColumn) : desc(orderByColumn));
      }

      // Enrich files with additional metadata
      const enrichedFiles = files.map((file) => ({
        ...file,
        isEditable: isEditableInOnlyOffice(file.mimeType, file.name),
        isPreviewable: isPreviewable(file.mimeType, file.name),
        isPdf: isPdf(file.name),
        isImage: isImage(file.mimeType),
        isVideo: isVideo(file.mimeType),
        category: getMimeCategory(file.mimeType),
        extension: getFileExtension(file.name),
      }));

      return {
        folders,
        files: enrichedFiles,
      };
    }),

  // Get folder details and breadcrumb path
  getFolder: privateProcedure
    .input(z.object({ folderId: z.string() }))
    .query(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const folder = await ctx.db.query.driveFolder.findFirst({
        where: and(
          eq(driveFolder.id, input.folderId),
          eq(driveFolder.userId, sessionUser.id),
        ),
      });

      if (!folder) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found' });
      }

      // Build breadcrumb path
      const breadcrumbs: { id: string; name: string }[] = [];
      let currentFolder: typeof folder | undefined = folder;

      while (currentFolder) {
        breadcrumbs.unshift({ id: currentFolder.id, name: currentFolder.name });

        if (currentFolder.parentId) {
          currentFolder = await ctx.db.query.driveFolder.findFirst({
            where: and(
              eq(driveFolder.id, currentFolder.parentId),
              eq(driveFolder.userId, sessionUser.id),
            ),
          });
        } else {
          break;
        }
      }

      return {
        folder,
        breadcrumbs,
      };
    }),

  // Create a new folder
  createFolder: privateProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        parentId: z.string().nullable().optional(),
        color: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const folderId = crypto.randomUUID();

      // Verify parent folder exists and belongs to user (if provided)
      if (input.parentId) {
        const parentFolder = await ctx.db.query.driveFolder.findFirst({
          where: and(
            eq(driveFolder.id, input.parentId),
            eq(driveFolder.userId, sessionUser.id),
          ),
        });

        if (!parentFolder) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Parent folder not found' });
        }
      }

      await ctx.db.insert(driveFolder).values({
        id: folderId,
        userId: sessionUser.id,
        name: input.name,
        parentId: input.parentId || null,
        color: input.color,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return { id: folderId };
    }),

  // Rename folder
  renameFolder: privateProcedure
    .input(
      z.object({
        folderId: z.string(),
        name: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      await ctx.db
        .update(driveFolder)
        .set({ name: input.name, updatedAt: new Date() })
        .where(
          and(
            eq(driveFolder.id, input.folderId),
            eq(driveFolder.userId, sessionUser.id),
          ),
        );

      return { success: true };
    }),

  // Delete folder (and all contents recursively)
  deleteFolder: privateProcedure
    .input(z.object({ folderId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      // Verify folder exists and belongs to user
      const folder = await ctx.db.query.driveFolder.findFirst({
        where: and(
          eq(driveFolder.id, input.folderId),
          eq(driveFolder.userId, sessionUser.id),
        ),
      });

      if (!folder) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found' });
      }

      // Get all files in this folder to delete from R2
      const filesToDelete = await ctx.db.query.driveFile.findMany({
        where: eq(driveFile.folderId, input.folderId),
      });

      // Delete files from R2
      const bucket = env.DRIVE_BUCKET;
      for (const file of filesToDelete) {
        try {
          await bucket.delete(file.r2Key);
          if (file.thumbnailR2Key) {
            await bucket.delete(file.thumbnailR2Key);
          }
        } catch (e) {
          console.error(`Failed to delete file from R2: ${file.r2Key}`, e);
        }
      }

      // Delete folder (cascade will delete files from DB)
      await ctx.db.delete(driveFolder).where(eq(driveFolder.id, input.folderId));

      return { success: true };
    }),

  // Get file details
  getFile: privateProcedure
    .input(z.object({ fileId: z.string() }))
    .query(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const file = await ctx.db.query.driveFile.findFirst({
        where: and(
          eq(driveFile.id, input.fileId),
          eq(driveFile.userId, sessionUser.id),
        ),
      });

      if (!file) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      }

      return {
        ...file,
        isEditable: isEditableInOnlyOffice(file.mimeType, file.name),
        category: getMimeCategory(file.mimeType),
        extension: getFileExtension(file.name),
      };
    }),

  // Get download URL for a file
  getDownloadUrl: privateProcedure
    .input(z.object({ fileId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const file = await ctx.db.query.driveFile.findFirst({
        where: and(
          eq(driveFile.id, input.fileId),
          eq(driveFile.userId, sessionUser.id),
        ),
      });

      if (!file) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      }

      // Get file from R2 and generate a temporary URL
      // For now, return the R2 key - in production you'd generate a signed URL
      const bucket = env.DRIVE_BUCKET;
      const object = await bucket.get(file.r2Key);

      if (!object) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found in storage' });
      }

      // Helper function to convert ArrayBuffer to base64 without stack overflow
      const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192; // Process in chunks to avoid call stack issues
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
          binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        return btoa(binary);
      };

      // Return the file content as base64 for small files, or a download endpoint for large files
      if (file.size < 10 * 1024 * 1024) { // Less than 10MB
        const arrayBuffer = await object.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        return {
          type: 'base64' as const,
          data: base64,
          mimeType: file.mimeType,
          fileName: file.name,
        };
      }

      // For larger files, return download endpoint URL
      const backendUrl = ctx.c.env.VITE_PUBLIC_BACKEND_URL || '';
      return {
        type: 'url' as const,
        url: `${backendUrl}/api/drive/download/${file.id}`,
        fileName: file.name,
      };
    }),

  // Rename file
  renameFile: privateProcedure
    .input(
      z.object({
        fileId: z.string(),
        name: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      await ctx.db
        .update(driveFile)
        .set({ name: input.name, updatedAt: new Date() })
        .where(
          and(
            eq(driveFile.id, input.fileId),
            eq(driveFile.userId, sessionUser.id),
          ),
        );

      return { success: true };
    }),

  // Move file to a different folder
  moveFile: privateProcedure
    .input(
      z.object({
        fileId: z.string(),
        targetFolderId: z.string().nullable(), // null = root
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      // Verify target folder exists (if not root)
      if (input.targetFolderId) {
        const targetFolder = await ctx.db.query.driveFolder.findFirst({
          where: and(
            eq(driveFolder.id, input.targetFolderId),
            eq(driveFolder.userId, sessionUser.id),
          ),
        });

        if (!targetFolder) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Target folder not found' });
        }
      }

      await ctx.db
        .update(driveFile)
        .set({ folderId: input.targetFolderId, updatedAt: new Date() })
        .where(
          and(
            eq(driveFile.id, input.fileId),
            eq(driveFile.userId, sessionUser.id),
          ),
        );

      return { success: true };
    }),

  // Toggle star on file
  toggleStar: privateProcedure
    .input(z.object({ fileId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const file = await ctx.db.query.driveFile.findFirst({
        where: and(
          eq(driveFile.id, input.fileId),
          eq(driveFile.userId, sessionUser.id),
        ),
      });

      if (!file) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      }

      await ctx.db
        .update(driveFile)
        .set({ isStarred: !file.isStarred, updatedAt: new Date() })
        .where(eq(driveFile.id, input.fileId));

      return { isStarred: !file.isStarred };
    }),

  // Move file to trash
  trashFile: privateProcedure
    .input(z.object({ fileId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      await ctx.db
        .update(driveFile)
        .set({ isTrashed: true, trashedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(driveFile.id, input.fileId),
            eq(driveFile.userId, sessionUser.id),
          ),
        );

      return { success: true };
    }),

  // Restore file from trash
  restoreFile: privateProcedure
    .input(z.object({ fileId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      await ctx.db
        .update(driveFile)
        .set({ isTrashed: false, trashedAt: null, updatedAt: new Date() })
        .where(
          and(
            eq(driveFile.id, input.fileId),
            eq(driveFile.userId, sessionUser.id),
          ),
        );

      return { success: true };
    }),

  // Permanently delete file
  deleteFile: privateProcedure
    .input(z.object({ fileId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const file = await ctx.db.query.driveFile.findFirst({
        where: and(
          eq(driveFile.id, input.fileId),
          eq(driveFile.userId, sessionUser.id),
        ),
      });

      if (!file) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      }

      // Delete from R2
      const bucket = env.DRIVE_BUCKET;
      try {
        await bucket.delete(file.r2Key);
        if (file.thumbnailR2Key) {
          await bucket.delete(file.thumbnailR2Key);
        }
      } catch (e) {
        console.error(`Failed to delete file from R2: ${file.r2Key}`, e);
      }

      // Delete from database
      await ctx.db.delete(driveFile).where(eq(driveFile.id, input.fileId));

      return { success: true };
    }),

  // Empty trash
  emptyTrash: privateProcedure.mutation(async ({ ctx }) => {
    const { sessionUser } = ctx;

    // Get all trashed files
    const trashedFiles = await ctx.db.query.driveFile.findMany({
      where: and(
        eq(driveFile.userId, sessionUser.id),
        eq(driveFile.isTrashed, true),
      ),
    });

    // Delete from R2
    const bucket = env.DRIVE_BUCKET;
    for (const file of trashedFiles) {
      try {
        await bucket.delete(file.r2Key);
        if (file.thumbnailR2Key) {
          await bucket.delete(file.thumbnailR2Key);
        }
      } catch (e) {
        console.error(`Failed to delete file from R2: ${file.r2Key}`, e);
      }
    }

    // Delete from database
    await ctx.db
      .delete(driveFile)
      .where(
        and(
          eq(driveFile.userId, sessionUser.id),
          eq(driveFile.isTrashed, true),
        ),
      );

    return { deletedCount: trashedFiles.length };
  }),

  // Get storage usage stats
  getStorageStats: privateProcedure.query(async ({ ctx }) => {
    const { sessionUser } = ctx;

    const files = await ctx.db.query.driveFile.findMany({
      where: and(
        eq(driveFile.userId, sessionUser.id),
        eq(driveFile.isTrashed, false),
      ),
      columns: {
        size: true,
        mimeType: true,
      },
    });

    const totalSize = files.reduce((acc, file) => acc + file.size, 0);
    const totalFiles = files.length;

    // Group by category
    const byCategory: Record<string, { count: number; size: number }> = {};
    for (const file of files) {
      const category = getMimeCategory(file.mimeType);
      if (!byCategory[category]) {
        byCategory[category] = { count: 0, size: 0 };
      }
      byCategory[category].count++;
      byCategory[category].size += file.size;
    }

    return {
      totalSize,
      totalFiles,
      byCategory,
    };
  }),

  // Get OnlyOffice Document Server editor config for a file
  getEditorConfig: privateProcedure
    .input(z.object({ fileId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      // Use ctx.c.env to get the proper environment variables from the Hono context
      const workerEnv = ctx.c.env;

      const file = await ctx.db.query.driveFile.findFirst({
        where: and(
          eq(driveFile.id, input.fileId),
          eq(driveFile.userId, sessionUser.id),
        ),
      });

      if (!file) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      }

      if (!isEditableInOnlyOffice(file.mimeType, file.name)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File type not supported for editing' });
      }

      const onlyOfficeUrl = workerEnv.ONLYOFFICE_URL || 'https://office.nubo.email';
      const jwtSecret = workerEnv.ONLYOFFICE_JWT_SECRET;
      const backendUrl = workerEnv.VITE_PUBLIC_BACKEND_URL;

      if (!jwtSecret) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'OnlyOffice JWT secret not configured' });
      }

      const ext = getFileExtension(file.name);
      const documentType = ['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)
        ? 'word'
        : ['xls', 'xlsx', 'ods', 'csv'].includes(ext)
          ? 'cell'
          : ['ppt', 'pptx', 'odp'].includes(ext)
            ? 'slide'
            : 'word';

      // Generate document key for OnlyOffice
      //
      // OnlyOffice uses this key to identify document versions.
      // Using fileId + updatedAt ensures:
      // - Same key during an editing session (if user saves and keeps editing)
      // - New key when reopening after save (updatedAt changed)
      //
      // This approach means each "version" of the document gets its own key.
      const documentKey = `${file.id}-${file.updatedAt.getTime()}`;

      // OnlyOffice Document Server configuration
      const config = {
        document: {
          fileType: ext,
          key: documentKey,
          title: file.name,
          // No cache-busting params needed - OnlyOffice handles caching based on document key
          // Adding timestamp params can cause issues if they change between requests
          url: `${backendUrl}/api/drive/file/${file.id}/content`,
        },
        documentType,
        editorConfig: {
          callbackUrl: `${backendUrl}/api/drive/onlyoffice/callback`,
          user: {
            id: sessionUser.id,
            name: sessionUser.name || sessionUser.email,
          },
          customization: {
            // IMPORTANT: Forcesave is disabled because it causes version mismatch errors.
            // When forcesave is enabled, OnlyOffice sends status 6 callbacks which write
            // new content to R2. But OnlyOffice also re-fetches the document URL to check
            // for external changes. When it sees the new content (that it just saved),
            // it incorrectly thinks someone else modified the file and shows a version
            // mismatch error.
            //
            // With forcesave disabled, documents are only saved when the editor is closed
            // (status 2), which is when the document key will change anyway.
            autosave: false,
            forcesave: false,
          },
        },
      };

      // Sign the config with JWT using the cloudflare-worker-jwt library
      const token = await jwt.sign(config, jwtSecret, { algorithm: 'HS256' });

      return {
        config: {
          ...config,
          token,
        },
        onlyOfficeUrl,
      };
    }),

  // Get import job status
  getImportJob: privateProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const job = await ctx.db.query.driveImportJob.findFirst({
        where: and(
          eq(driveImportJob.id, input.jobId),
          eq(driveImportJob.userId, sessionUser.id),
        ),
      });

      if (!job) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Import job not found' });
      }

      return job;
    }),

  // List recent import jobs
  listImportJobs: privateProcedure
    .input(z.object({ limit: z.number().default(10) }))
    .query(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const jobs = await ctx.db
        .select()
        .from(driveImportJob)
        .where(eq(driveImportJob.userId, sessionUser.id))
        .orderBy(desc(driveImportJob.createdAt))
        .limit(input.limit);

      return jobs;
    }),

  // Get Google Drive OAuth URL
  getGoogleDriveAuthUrl: privateProcedure
    .input(z.object({ redirectUri: z.string() }))
    .mutation(({ input }) => {
      const scopes = [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file',
      ];

      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: input.redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        state: 'google_drive_import',
      });

      return {
        url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      };
    }),

  // Exchange Google OAuth code for tokens
  exchangeGoogleDriveCode: privateProcedure
    .input(z.object({
      code: z.string(),
      redirectUri: z.string(),
    }))
    .mutation(async ({ input }) => {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          code: input.code,
          grant_type: 'authorization_code',
          redirect_uri: input.redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('Google OAuth error:', error);
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Failed to exchange code' });
      }

      const tokens = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
      };
    }),

  // List files from Google Drive
  listGoogleDriveFiles: privateProcedure
    .input(z.object({
      accessToken: z.string(),
      folderId: z.string().optional(),
      pageToken: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const query = input.folderId
        ? `'${input.folderId}' in parents and trashed = false`
        : "'root' in parents and trashed = false";

      const params = new URLSearchParams({
        q: query,
        fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, iconLink, thumbnailLink)',
        pageSize: '100',
        orderBy: 'folder,name',
      });

      if (input.pageToken) {
        params.append('pageToken', input.pageToken);
      }

      const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
        headers: { Authorization: `Bearer ${input.accessToken}` },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Google Drive API error:', response.status, errorText);
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Failed to list files: ${errorText}` });
      }

      const data = await response.json() as {
        files: Array<{
          id: string;
          name: string;
          mimeType: string;
          size?: string;
          modifiedTime: string;
          iconLink?: string;
          thumbnailLink?: string;
        }>;
        nextPageToken?: string;
      };

      return {
        files: data.files.map((file) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: file.size ? parseInt(file.size) : 0,
          modifiedTime: file.modifiedTime,
          isFolder: file.mimeType === 'application/vnd.google-apps.folder',
          iconLink: file.iconLink,
          thumbnailLink: file.thumbnailLink,
        })),
        nextPageToken: data.nextPageToken,
      };
    }),

  // Import files from Google Drive
  importFromGoogleDrive: privateProcedure
    .input(z.object({
      accessToken: z.string(),
      fileIds: z.array(z.string()),
      targetFolderId: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const bucket = ctx.c.env.DRIVE_BUCKET as R2Bucket;

      // Create import job
      const jobId = crypto.randomUUID();
      await ctx.db.insert(driveImportJob).values({
        id: jobId,
        userId: sessionUser.id,
        source: 'google_drive',
        status: 'processing',
        totalFiles: input.fileIds.length,
        processedFiles: 0,
        failedFiles: 0,
        sourceFileIds: input.fileIds,
        targetFolderId: input.targetFolderId || null,
        startedAt: new Date(),
        createdAt: new Date(),
      });

      // Process files using waitUntil to keep worker alive
      const importPromise = processGoogleDriveImport(
        input.accessToken,
        input.fileIds,
        sessionUser.id,
        sessionUser.email,
        jobId,
        input.targetFolderId || null,
        ctx.db,
        bucket,
      ).catch((error) => {
        console.error('[GoogleDriveImport] Import failed:', error);
      });

      // Keep worker alive until import completes
      ctx.c.executionCtx.waitUntil(importPromise);

      return { jobId };
    }),

  // Get OneDrive OAuth URL
  getOneDriveAuthUrl: privateProcedure
    .input(z.object({ redirectUri: z.string() }))
    .mutation(({ input }) => {
      const scopes = [
        'Files.Read',
        'Files.Read.All',
        'offline_access',
      ];

      const params = new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID,
        redirect_uri: input.redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        prompt: 'consent',
        state: 'onedrive_import',
      });

      return {
        url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`,
      };
    }),

  // Exchange OneDrive OAuth code for tokens
  exchangeOneDriveCode: privateProcedure
    .input(z.object({
      code: z.string(),
      redirectUri: z.string(),
    }))
    .mutation(async ({ input }) => {
      const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.MICROSOFT_CLIENT_ID,
          client_secret: env.MICROSOFT_CLIENT_SECRET,
          code: input.code,
          grant_type: 'authorization_code',
          redirect_uri: input.redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('OneDrive OAuth error:', error);
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Failed to exchange code' });
      }

      const tokens = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
      };
    }),

  // List files from OneDrive
  listOneDriveFiles: privateProcedure
    .input(z.object({
      accessToken: z.string(),
      folderId: z.string().optional(),
      skipToken: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const endpoint = input.folderId
        ? `https://graph.microsoft.com/v1.0/me/drive/items/${input.folderId}/children`
        : 'https://graph.microsoft.com/v1.0/me/drive/root/children';

      const url = new URL(endpoint);
      url.searchParams.set('$select', 'id,name,size,lastModifiedDateTime,file,folder');
      url.searchParams.set('$top', '100');
      url.searchParams.set('$orderby', 'name');

      if (input.skipToken) {
        url.searchParams.set('$skiptoken', input.skipToken);
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${input.accessToken}` },
      });

      if (!response.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Failed to list files' });
      }

      const data = await response.json() as {
        value: Array<{
          id: string;
          name: string;
          size?: number;
          lastModifiedDateTime: string;
          file?: { mimeType: string };
          folder?: object;
        }>;
        '@odata.nextLink'?: string;
      };

      // Extract skipToken from nextLink
      let nextSkipToken: string | undefined;
      if (data['@odata.nextLink']) {
        const nextUrl = new URL(data['@odata.nextLink']);
        nextSkipToken = nextUrl.searchParams.get('$skiptoken') || undefined;
      }

      return {
        files: data.value.map((item) => ({
          id: item.id,
          name: item.name,
          mimeType: item.file?.mimeType || 'application/octet-stream',
          size: item.size || 0,
          modifiedTime: item.lastModifiedDateTime,
          isFolder: !!item.folder,
        })),
        nextSkipToken,
      };
    }),

  // Import files from OneDrive
  importFromOneDrive: privateProcedure
    .input(z.object({
      accessToken: z.string(),
      fileIds: z.array(z.string()),
      targetFolderId: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const bucket = ctx.c.env.DRIVE_BUCKET as R2Bucket;

      // Create import job
      const jobId = crypto.randomUUID();
      await ctx.db.insert(driveImportJob).values({
        id: jobId,
        userId: sessionUser.id,
        source: 'onedrive',
        status: 'processing',
        totalFiles: input.fileIds.length,
        processedFiles: 0,
        failedFiles: 0,
        sourceFileIds: input.fileIds,
        targetFolderId: input.targetFolderId || null,
        startedAt: new Date(),
        createdAt: new Date(),
      });

      // Process files using waitUntil to keep worker alive
      const importPromise = processOneDriveImport(
        input.accessToken,
        input.fileIds,
        sessionUser.id,
        sessionUser.email,
        jobId,
        input.targetFolderId || null,
        ctx.db,
        bucket,
      ).catch((error) => {
        console.error('[OneDriveImport] Import failed:', error);
      });

      // Keep worker alive until import completes
      ctx.c.executionCtx.waitUntil(importPromise);

      return { jobId };
    }),

  // Import entire Google Drive (recursive)
  importEntireGoogleDrive: privateProcedure
    .input(z.object({
      accessToken: z.string(),
      targetFolderId: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const bucket = ctx.c.env.DRIVE_BUCKET as R2Bucket;

      // First, get all file IDs recursively
      console.log(`[GoogleDriveImport] Starting full drive scan for user ${sessionUser.id}`);
      const allFileIds = await getAllGoogleDriveFiles(input.accessToken);
      console.log(`[GoogleDriveImport] Found ${allFileIds.length} files to import`);

      if (allFileIds.length === 0) {
        return { jobId: null, totalFiles: 0 };
      }

      // Create import job
      const jobId = crypto.randomUUID();
      await ctx.db.insert(driveImportJob).values({
        id: jobId,
        userId: sessionUser.id,
        source: 'google_drive',
        status: 'processing',
        totalFiles: allFileIds.length,
        processedFiles: 0,
        failedFiles: 0,
        sourceFileIds: allFileIds,
        targetFolderId: input.targetFolderId || null,
        startedAt: new Date(),
        createdAt: new Date(),
      });

      // Process files using waitUntil to keep worker alive
      const importPromise = processGoogleDriveImport(
        input.accessToken,
        allFileIds,
        sessionUser.id,
        sessionUser.email,
        jobId,
        input.targetFolderId || null,
        ctx.db,
        bucket,
      ).catch((error) => {
        console.error('[GoogleDriveImport] Full import failed:', error);
      });

      ctx.c.executionCtx.waitUntil(importPromise);

      return { jobId, totalFiles: allFileIds.length };
    }),

  // Import entire OneDrive (recursive)
  importEntireOneDrive: privateProcedure
    .input(z.object({
      accessToken: z.string(),
      targetFolderId: z.string().nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const bucket = ctx.c.env.DRIVE_BUCKET as R2Bucket;

      // First, get all file IDs recursively
      console.log(`[OneDriveImport] Starting full drive scan for user ${sessionUser.id}`);
      const allFileIds = await getAllOneDriveFiles(input.accessToken);
      console.log(`[OneDriveImport] Found ${allFileIds.length} files to import`);

      if (allFileIds.length === 0) {
        return { jobId: null, totalFiles: 0 };
      }

      // Create import job
      const jobId = crypto.randomUUID();
      await ctx.db.insert(driveImportJob).values({
        id: jobId,
        userId: sessionUser.id,
        source: 'onedrive',
        status: 'processing',
        totalFiles: allFileIds.length,
        processedFiles: 0,
        failedFiles: 0,
        sourceFileIds: allFileIds,
        targetFolderId: input.targetFolderId || null,
        startedAt: new Date(),
        createdAt: new Date(),
      });

      // Process files using waitUntil to keep worker alive
      const importPromise = processOneDriveImport(
        input.accessToken,
        allFileIds,
        sessionUser.id,
        sessionUser.email,
        jobId,
        input.targetFolderId || null,
        ctx.db,
        bucket,
      ).catch((error) => {
        console.error('[OneDriveImport] Full import failed:', error);
      });

      ctx.c.executionCtx.waitUntil(importPromise);

      return { jobId, totalFiles: allFileIds.length };
    }),

  // ================== SHARING ENDPOINTS ==================

  // Get preview URL for PDF/images (no editing)
  getPreviewUrl: privateProcedure
    .input(z.object({ fileId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const workerEnv = ctx.c.env;
      const bucket = workerEnv.DRIVE_BUCKET as R2Bucket;

      const file = await ctx.db.query.driveFile.findFirst({
        where: and(
          eq(driveFile.id, input.fileId),
          eq(driveFile.userId, sessionUser.id),
        ),
      });

      if (!file) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
      }

      // Helper function to convert ArrayBuffer to base64 without stack overflow
      const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192; // Process in chunks to avoid call stack issues
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
          binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        return btoa(binary);
      };

      // For images, return base64
      if (isImage(file.mimeType)) {
        const object = await bucket.get(file.r2Key);
        if (!object) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'File content not found' });
        }
        const arrayBuffer = await object.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        return {
          type: 'image' as const,
          mimeType: file.mimeType,
          data: base64,
          fileName: file.name,
        };
      }

      // For PDFs, return base64
      if (isPdf(file.name)) {
        const object = await bucket.get(file.r2Key);
        if (!object) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'File content not found' });
        }
        const arrayBuffer = await object.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        return {
          type: 'pdf' as const,
          mimeType: 'application/pdf',
          data: base64,
          fileName: file.name,
        };
      }

      // For videos, return base64 for small files or URL for large files
      if (isVideo(file.mimeType)) {
        const object = await bucket.get(file.r2Key);
        if (!object) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'File content not found' });
        }

        // For videos larger than 50MB, return URL instead of base64
        if (file.size > 50 * 1024 * 1024) {
          const backendUrl = workerEnv.VITE_PUBLIC_BACKEND_URL || '';
          return {
            type: 'video_url' as const,
            mimeType: file.mimeType,
            url: `${backendUrl}/api/drive/download/${file.id}`,
            fileName: file.name,
          };
        }

        const arrayBuffer = await object.arrayBuffer();
        const base64 = arrayBufferToBase64(arrayBuffer);
        return {
          type: 'video' as const,
          mimeType: file.mimeType,
          data: base64,
          fileName: file.name,
        };
      }

      throw new TRPCError({ code: 'BAD_REQUEST', message: 'File type not previewable' });
    }),

  // Create a share for a file or folder
  createShare: privateProcedure
    .input(z.object({
      fileId: z.string().optional(),
      folderId: z.string().optional(),
      shareType: z.enum(['user', 'link', 'email_invite']),
      accessLevel: z.enum(['view', 'edit', 'admin']).default('view'),
      sharedWithUserId: z.string().optional(), // Direct user ID
      sharedWithUsername: z.string().optional(),
      sharedWithEmail: z.string().optional(),
      expiresAt: z.string().optional(), // ISO date string
      password: z.string().optional(),
      message: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      // Validate that either fileId or folderId is provided
      if (!input.fileId && !input.folderId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Either fileId or folderId is required' });
      }

      // Verify ownership
      if (input.fileId) {
        const file = await ctx.db.query.driveFile.findFirst({
          where: and(
            eq(driveFile.id, input.fileId),
            eq(driveFile.userId, sessionUser.id),
          ),
        });
        if (!file) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' });
        }
      }

      if (input.folderId) {
        const folder = await ctx.db.query.driveFolder.findFirst({
          where: and(
            eq(driveFolder.id, input.folderId),
            eq(driveFolder.userId, sessionUser.id),
          ),
        });
        if (!folder) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found' });
        }
      }

      // Find user by ID or username if sharing with user
      let sharedWithUserId: string | null = input.sharedWithUserId || null;
      let sharedWithUsername: string | null = input.sharedWithUsername || null;

      if (input.shareType === 'user') {
        if (input.sharedWithUserId) {
          // Verify user exists and get username
          const targetUser = await ctx.db.query.user.findFirst({
            where: eq(user.id, input.sharedWithUserId),
          });
          if (!targetUser) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
          }
          sharedWithUserId = targetUser.id;
          sharedWithUsername = targetUser.username;
        } else if (input.sharedWithUsername) {
          const targetUser = await ctx.db.query.user.findFirst({
            where: eq(user.username, input.sharedWithUsername),
          });
          if (!targetUser) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
          }
          sharedWithUserId = targetUser.id;
        }
      }

      // Generate share token for link shares
      const shareToken = input.shareType === 'link'
        ? crypto.randomUUID().replace(/-/g, '')
        : null;

      const shareId = crypto.randomUUID();
      await ctx.db.insert(driveShare).values({
        id: shareId,
        userId: sessionUser.id,
        fileId: input.fileId || null,
        folderId: input.folderId || null,
        sharedWithUserId,
        sharedWithUsername,
        sharedWithEmail: input.sharedWithEmail || null,
        accessLevel: input.accessLevel,
        shareType: input.shareType,
        shareToken,
        password: input.password || null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        message: input.message || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Generate share URL for link shares
      const shareUrl = shareToken
        ? `${env.VITE_PUBLIC_APP_URL}/drive/shared/${shareToken}`
        : null;

      return {
        shareId,
        shareToken,
        shareUrl,
      };
    }),

  // Get shares for a file or folder
  getShares: privateProcedure
    .input(z.object({
      fileId: z.string().optional(),
      folderId: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const conditions = [eq(driveShare.userId, sessionUser.id)];
      if (input.fileId) {
        conditions.push(eq(driveShare.fileId, input.fileId));
      }
      if (input.folderId) {
        conditions.push(eq(driveShare.folderId, input.folderId));
      }

      const shares = await ctx.db
        .select()
        .from(driveShare)
        .where(and(...conditions))
        .orderBy(desc(driveShare.createdAt));

      return shares.map(share => ({
        ...share,
        shareUrl: share.shareToken
          ? `${env.VITE_PUBLIC_APP_URL}/drive/shared/${share.shareToken}`
          : null,
      }));
    }),

  // Delete a share
  deleteShare: privateProcedure
    .input(z.object({ shareId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const share = await ctx.db.query.driveShare.findFirst({
        where: and(
          eq(driveShare.id, input.shareId),
          eq(driveShare.userId, sessionUser.id),
        ),
      });

      if (!share) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share not found' });
      }

      await ctx.db.delete(driveShare).where(eq(driveShare.id, input.shareId));
      return { success: true };
    }),

  // Get files shared with me
  getSharedWithMe: privateProcedure
    .query(async ({ ctx }) => {
      const { sessionUser } = ctx;

      const shares = await ctx.db
        .select({
          share: driveShare,
          file: driveFile,
          folder: driveFolder,
          owner: {
            id: user.id,
            name: user.name,
            email: user.email,
            username: user.username,
          },
        })
        .from(driveShare)
        .leftJoin(driveFile, eq(driveShare.fileId, driveFile.id))
        .leftJoin(driveFolder, eq(driveShare.folderId, driveFolder.id))
        .leftJoin(user, eq(driveShare.userId, user.id))
        .where(eq(driveShare.sharedWithUserId, sessionUser.id))
        .orderBy(desc(driveShare.createdAt));

      return shares;
    }),

  // Search users by username (for sharing autocomplete)
  searchUsers: privateProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const users = await ctx.db
        .select({
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          image: user.image,
        })
        .from(user)
        .where(
          and(
            or(
              like(user.username, `%${input.query}%`),
              like(user.name, `%${input.query}%`),
              like(user.email, `%${input.query}%`),
            ),
            // Don't include current user
            sql`${user.id} != ${sessionUser.id}`,
          ),
        )
        .limit(10);

      return users;
    }),

  // ================== USERNAME ENDPOINTS ==================

  // Set or update username
  setUsername: privateProcedure
    .input(z.object({
      username: z.string()
        .min(3, 'Username must be at least 3 characters')
        .max(30, 'Username must be at most 30 characters')
        .regex(/^[a-z0-9_]+$/, 'Username can only contain lowercase letters, numbers, and underscores'),
    }))
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      // Check if username is taken
      const existing = await ctx.db.query.user.findFirst({
        where: and(
          eq(user.username, input.username),
          sql`${user.id} != ${sessionUser.id}`,
        ),
      });

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Username already taken' });
      }

      await ctx.db
        .update(user)
        .set({ username: input.username, updatedAt: new Date() })
        .where(eq(user.id, sessionUser.id));

      return { success: true, username: input.username };
    }),

  // Check if username is available
  checkUsername: privateProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ input, ctx }) => {
      const { sessionUser } = ctx;

      const existing = await ctx.db.query.user.findFirst({
        where: and(
          eq(user.username, input.username),
          sql`${user.id} != ${sessionUser.id}`,
        ),
      });

      return { available: !existing };
    }),

  // Get my username
  getMyUsername: privateProcedure
    .query(async ({ ctx }) => {
      const { sessionUser } = ctx;

      const userData = await ctx.db.query.user.findFirst({
        where: eq(user.id, sessionUser.id),
        columns: { username: true },
      });

      return { username: userData?.username || null };
    }),

  // Create a new blank file (document, spreadsheet, presentation)
  createBlankFile: privateProcedure
    .input(
      z.object({
        fileType: z.enum(['document', 'spreadsheet', 'presentation']),
        fileName: z.string().min(1),
        folderId: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser } = ctx;
      const { fileType, fileName, folderId } = input;

      // Verify folder exists if provided
      if (folderId) {
        const folder = await ctx.db.query.driveFolder.findFirst({
          where: and(
            eq(driveFolder.id, folderId),
            eq(driveFolder.userId, sessionUser.id),
          ),
        });

        if (!folder) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Folder not found' });
        }
      }

      // Determine file extension and MIME type
      let extension: string;
      let mimeType: string;
      let templateData: Uint8Array;

      switch (fileType) {
        case 'document':
          extension = 'docx';
          mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          templateData = createMinimalDocx();
          break;
        case 'spreadsheet':
          extension = 'xlsx';
          mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          templateData = createMinimalXlsx();
          break;
        case 'presentation':
          extension = 'pptx';
          mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
          templateData = createMinimalPptx();
          break;
        default:
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid file type' });
      }

      // Ensure filename has correct extension
      const baseName = fileName.replace(/\.(docx|xlsx|pptx)$/i, '');
      const fullFileName = `${baseName}.${extension}`;

      // Create file record
      const fileId = crypto.randomUUID();
      const r2Key = `drive/${sessionUser.id}/${fileId}/${fullFileName}`;

      // Upload template to R2
      await env.DRIVE_BUCKET.put(r2Key, templateData.buffer, {
        httpMetadata: { contentType: mimeType },
      });

      // Insert file record
      await ctx.db.insert(driveFile).values({
        id: fileId,
        userId: sessionUser.id,
        folderId: folderId || null,
        name: fullFileName,
        mimeType,
        size: templateData.byteLength,
        r2Key,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return {
        fileId,
        fileName: fullFileName,
        editUrl: `/drive/edit/${fileId}`,
      };
    }),
});

// Helper functions to create minimal Office documents
// These create valid but minimal Office Open XML files

// Minimal DOCX creation (Word document)
function createMinimalDocx(): Uint8Array {
  // A DOCX file is a ZIP archive containing XML files
  // This creates a minimal valid document that OnlyOffice can edit
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t></w:t></w:r></w:p>
  </w:body>
</w:document>`,
  };
  return createZipFromFiles(files);
}

// Minimal XLSX creation (Excel spreadsheet)
function createMinimalXlsx(): Uint8Array {
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData/>
</worksheet>`,
  };
  return createZipFromFiles(files);
}

// Minimal PPTX creation (PowerPoint presentation)
function createMinimalPptx(): Uint8Array {
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
</Relationships>`,
    'ppt/presentation.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId2"/></p:sldMasterIdLst>
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>`,
    'ppt/slides/_rels/slide1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
    'ppt/slides/slide1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sld>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
    'ppt/slideLayouts/slideLayout1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" type="blank">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sldLayout>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
    'ppt/slideMasters/slideMaster1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`,
  };
  return createZipFromFiles(files);
}

// Simple ZIP file creator (uncompressed)
function createZipFromFiles(files: Record<string, string>): Uint8Array {
  const entries: Array<{ name: string; data: Uint8Array }> = [];

  for (const [name, content] of Object.entries(files)) {
    const encoder = new TextEncoder();
    entries.push({ name, data: encoder.encode(content) });
  }

  // Calculate total size needed
  let totalSize = 0;
  const localHeaders: Array<{ offset: number; name: Uint8Array; data: Uint8Array }> = [];

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    localHeaders.push({
      offset: totalSize,
      name: nameBytes,
      data: entry.data,
    });
    // Local file header (30) + filename + file data
    totalSize += 30 + nameBytes.length + entry.data.length;
  }

  const centralDirStart = totalSize;

  // Calculate central directory size
  let centralDirSize = 0;
  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    centralDirSize += 46 + nameBytes.length;
  }

  // End of central directory record
  const eocdSize = 22;
  totalSize += centralDirSize + eocdSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let offset = 0;

  // Write local file headers and data
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const nameBytes = new TextEncoder().encode(entry.name);

    // Local file header signature
    view.setUint32(offset, 0x04034b50, true);
    offset += 4;

    // Version needed to extract
    view.setUint16(offset, 20, true);
    offset += 2;

    // General purpose bit flag
    view.setUint16(offset, 0, true);
    offset += 2;

    // Compression method (0 = stored)
    view.setUint16(offset, 0, true);
    offset += 2;

    // File last modification time
    view.setUint16(offset, 0, true);
    offset += 2;

    // File last modification date
    view.setUint16(offset, 0, true);
    offset += 2;

    // CRC-32
    view.setUint32(offset, crc32(entry.data), true);
    offset += 4;

    // Compressed size
    view.setUint32(offset, entry.data.length, true);
    offset += 4;

    // Uncompressed size
    view.setUint32(offset, entry.data.length, true);
    offset += 4;

    // File name length
    view.setUint16(offset, nameBytes.length, true);
    offset += 2;

    // Extra field length
    view.setUint16(offset, 0, true);
    offset += 2;

    // File name
    bytes.set(nameBytes, offset);
    offset += nameBytes.length;

    // File data
    bytes.set(entry.data, offset);
    offset += entry.data.length;
  }

  // Write central directory
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const header = localHeaders[i];
    const nameBytes = new TextEncoder().encode(entry.name);

    // Central directory file header signature
    view.setUint32(offset, 0x02014b50, true);
    offset += 4;

    // Version made by
    view.setUint16(offset, 20, true);
    offset += 2;

    // Version needed to extract
    view.setUint16(offset, 20, true);
    offset += 2;

    // General purpose bit flag
    view.setUint16(offset, 0, true);
    offset += 2;

    // Compression method
    view.setUint16(offset, 0, true);
    offset += 2;

    // File last modification time
    view.setUint16(offset, 0, true);
    offset += 2;

    // File last modification date
    view.setUint16(offset, 0, true);
    offset += 2;

    // CRC-32
    view.setUint32(offset, crc32(entry.data), true);
    offset += 4;

    // Compressed size
    view.setUint32(offset, entry.data.length, true);
    offset += 4;

    // Uncompressed size
    view.setUint32(offset, entry.data.length, true);
    offset += 4;

    // File name length
    view.setUint16(offset, nameBytes.length, true);
    offset += 2;

    // Extra field length
    view.setUint16(offset, 0, true);
    offset += 2;

    // File comment length
    view.setUint16(offset, 0, true);
    offset += 2;

    // Disk number start
    view.setUint16(offset, 0, true);
    offset += 2;

    // Internal file attributes
    view.setUint16(offset, 0, true);
    offset += 2;

    // External file attributes
    view.setUint32(offset, 0, true);
    offset += 4;

    // Relative offset of local header
    view.setUint32(offset, header.offset, true);
    offset += 4;

    // File name
    bytes.set(nameBytes, offset);
    offset += nameBytes.length;
  }

  // Write end of central directory record
  view.setUint32(offset, 0x06054b50, true); // Signature
  offset += 4;
  view.setUint16(offset, 0, true); // Number of this disk
  offset += 2;
  view.setUint16(offset, 0, true); // Disk where central directory starts
  offset += 2;
  view.setUint16(offset, entries.length, true); // Number of central directory records on this disk
  offset += 2;
  view.setUint16(offset, entries.length, true); // Total number of central directory records
  offset += 2;
  view.setUint32(offset, centralDirSize, true); // Size of central directory
  offset += 4;
  view.setUint32(offset, centralDirStart, true); // Offset of start of central directory
  offset += 4;
  view.setUint16(offset, 0, true); // Comment length
  // offset += 2;

  return new Uint8Array(buffer);
}

// CRC-32 calculation for ZIP
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return crc ^ 0xffffffff;
}

// Helper to send import completion email
async function sendImportCompletionEmail(
  userEmail: string,
  source: 'Google Drive' | 'OneDrive',
  processedCount: number,
  failedCount: number,
  totalCount: number,
) {
  const status = failedCount === totalCount ? 'failed' : 'completed';
  const subject = status === 'completed'
    ? `✅ Your ${source} import is complete!`
    : `❌ Your ${source} import encountered issues`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: ${status === 'completed' ? '#10b981' : '#ef4444'};">
        ${status === 'completed' ? '🎉 Import Complete!' : '⚠️ Import Completed with Issues'}
      </h2>
      <p>Your ${source} import has finished processing.</p>
      <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <p style="margin: 0;"><strong>Summary:</strong></p>
        <ul style="margin: 8px 0;">
          <li>Total files: ${totalCount}</li>
          <li style="color: #10b981;">Successfully imported: ${processedCount}</li>
          ${failedCount > 0 ? `<li style="color: #ef4444;">Failed: ${failedCount}</li>` : ''}
        </ul>
      </div>
      <p>You can view your imported files in <a href="https://nubo.email/drive" style="color: #3b82f6;">Nubo Drive</a>.</p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #6b7280; font-size: 12px;">This email was sent from Nubo. Please do not reply to this email.</p>
    </div>
  `;

  try {
    await resend().emails.send({
      from: 'Nubo <noreply@nubo.email>',
      to: userEmail,
      subject,
      html,
    });
    console.log(`[ImportEmail] Sent completion email to ${userEmail}`);
  } catch (error) {
    console.error('[ImportEmail] Failed to send email:', error);
  }
}

// Helper to recursively get all files from Google Drive
async function getAllGoogleDriveFiles(
  accessToken: string,
  folderId?: string,
): Promise<string[]> {
  const allFileIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const query = folderId
      ? `'${folderId}' in parents and trashed = false`
      : "'root' in parents and trashed = false";

    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken, files(id, mimeType)',
      pageSize: '1000',
    });

    if (pageToken) {
      params.append('pageToken', pageToken);
    }

    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.error('[GoogleDriveImport] Failed to list files:', await response.text());
      break;
    }

    const data = await response.json() as {
      files: Array<{ id: string; mimeType: string }>;
      nextPageToken?: string;
    };

    for (const file of data.files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        // Recursively get files from subfolder
        const subFiles = await getAllGoogleDriveFiles(accessToken, file.id);
        allFileIds.push(...subFiles);
      } else {
        allFileIds.push(file.id);
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFileIds;
}

// Helper to recursively get all files from OneDrive
async function getAllOneDriveFiles(
  accessToken: string,
  folderId?: string,
): Promise<string[]> {
  const allFileIds: string[] = [];
  let nextLink: string | undefined;

  const baseUrl = folderId
    ? `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children`
    : 'https://graph.microsoft.com/v1.0/me/drive/root/children';

  let url = `${baseUrl}?$select=id,folder&$top=999`;

  do {
    const response = await fetch(nextLink || url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.error('[OneDriveImport] Failed to list files:', await response.text());
      break;
    }

    const data = await response.json() as {
      value: Array<{ id: string; folder?: object }>;
      '@odata.nextLink'?: string;
    };

    for (const item of data.value) {
      if (item.folder) {
        // Recursively get files from subfolder
        const subFiles = await getAllOneDriveFiles(accessToken, item.id);
        allFileIds.push(...subFiles);
      } else {
        allFileIds.push(item.id);
      }
    }

    nextLink = data['@odata.nextLink'];
  } while (nextLink);

  return allFileIds;
}

// Background import processor for Google Drive
async function processGoogleDriveImport(
  accessToken: string,
  fileIds: string[],
  userId: string,
  userEmail: string,
  jobId: string,
  targetFolderId: string | null,
  db: NeonHttpDatabase<typeof schema>,
  bucket: R2Bucket,
) {
  let processed = 0;
  let failed = 0;

  console.log(`[GoogleDriveImport] Starting import job ${jobId} for ${fileIds.length} files, userId: ${userId}`);

  for (const sourceFileId of fileIds) {
    try {
      console.log(`[GoogleDriveImport] Processing file ${sourceFileId}`);
      // Get file metadata
      const metaResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${sourceFileId}?fields=name,mimeType,size`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!metaResponse.ok) {
        failed++;
        continue;
      }

      const meta = await metaResponse.json() as { name: string; mimeType: string; size?: string };

      // Skip Google Docs/Sheets/Slides - they need export
      const googleDocTypes = [
        'application/vnd.google-apps.document',
        'application/vnd.google-apps.spreadsheet',
        'application/vnd.google-apps.presentation',
        'application/vnd.google-apps.folder',
      ];

      if (googleDocTypes.includes(meta.mimeType)) {
        // For Google Docs, export as Office format
        let exportMimeType: string;
        let extension: string;

        if (meta.mimeType === 'application/vnd.google-apps.document') {
          exportMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          extension = '.docx';
        } else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
          exportMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          extension = '.xlsx';
        } else if (meta.mimeType === 'application/vnd.google-apps.presentation') {
          exportMimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
          extension = '.pptx';
        } else {
          // Skip folders
          continue;
        }

        const exportResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${sourceFileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );

        if (!exportResponse.ok) {
          failed++;
          continue;
        }

        const content = await exportResponse.arrayBuffer();
        const fileId = crypto.randomUUID();
        const fileName = meta.name.endsWith(extension) ? meta.name : `${meta.name}${extension}`;
        const r2Key = `drive/${userId}/${fileId}/${fileName}`;

        await bucket.put(r2Key, content, {
          httpMetadata: { contentType: exportMimeType },
        });

        console.log(`[GoogleDriveImport] Inserting Google Doc file to DB: ${fileName}, r2Key: ${r2Key}`);
        await db.insert(driveFile).values({
          id: fileId,
          userId,
          folderId: targetFolderId,
          name: fileName,
          mimeType: exportMimeType,
          size: content.byteLength,
          r2Key,
          importSource: 'google_drive',
          sourceFileId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(`[GoogleDriveImport] Successfully inserted Google Doc: ${fileId}`);
      } else {
        // Download regular file
        const downloadResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files/${sourceFileId}?alt=media`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );

        if (!downloadResponse.ok) {
          failed++;
          continue;
        }

        const content = await downloadResponse.arrayBuffer();
        const fileId = crypto.randomUUID();
        const r2Key = `drive/${userId}/${fileId}/${meta.name}`;

        await bucket.put(r2Key, content, {
          httpMetadata: { contentType: meta.mimeType },
        });

        console.log(`[GoogleDriveImport] Inserting regular file to DB: ${meta.name}, r2Key: ${r2Key}, size: ${content.byteLength}`);
        await db.insert(driveFile).values({
          id: fileId,
          userId,
          folderId: targetFolderId,
          name: meta.name,
          mimeType: meta.mimeType,
          size: meta.size ? parseInt(meta.size) : content.byteLength,
          r2Key,
          importSource: 'google_drive',
          sourceFileId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(`[GoogleDriveImport] Successfully inserted regular file: ${fileId}`);
      }

      processed++;
      console.log(`[GoogleDriveImport] File ${sourceFileId} processed successfully. Total: ${processed}/${fileIds.length}`);
    } catch (e) {
      console.error(`Failed to import file ${sourceFileId}:`, e);
      failed++;
    }

    // Update job progress
    await db
      .update(driveImportJob)
      .set({ processedFiles: processed, failedFiles: failed })
      .where(eq(driveImportJob.id, jobId));
  }

  // Mark job as complete
  await db
    .update(driveImportJob)
    .set({
      status: failed === fileIds.length ? 'failed' : 'completed',
      processedFiles: processed,
      failedFiles: failed,
      completedAt: new Date(),
    })
    .where(eq(driveImportJob.id, jobId));

  // Send completion email
  await sendImportCompletionEmail(userEmail, 'Google Drive', processed, failed, fileIds.length);
}

// Background import processor for OneDrive
async function processOneDriveImport(
  accessToken: string,
  fileIds: string[],
  userId: string,
  userEmail: string,
  jobId: string,
  targetFolderId: string | null,
  db: NeonHttpDatabase<typeof schema>,
  bucket: R2Bucket,
) {
  let processed = 0;
  let failed = 0;

  for (const sourceFileId of fileIds) {
    try {
      // Get file metadata
      const metaResponse = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${sourceFileId}?$select=name,size,file`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!metaResponse.ok) {
        failed++;
        continue;
      }

      const meta = await metaResponse.json() as {
        name: string;
        size: number;
        file?: { mimeType: string };
      };

      // Download file content
      const downloadResponse = await fetch(
        `https://graph.microsoft.com/v1.0/me/drive/items/${sourceFileId}/content`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!downloadResponse.ok) {
        failed++;
        continue;
      }

      const content = await downloadResponse.arrayBuffer();
      const fileId = crypto.randomUUID();
      const mimeType = meta.file?.mimeType || 'application/octet-stream';
      const r2Key = `drive/${userId}/${fileId}/${meta.name}`;

      await bucket.put(r2Key, content, {
        httpMetadata: { contentType: mimeType },
      });

      await db.insert(driveFile).values({
        id: fileId,
        userId,
        folderId: targetFolderId,
        name: meta.name,
        mimeType,
        size: meta.size || content.byteLength,
        r2Key,
        importSource: 'onedrive',
        sourceFileId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      processed++;
    } catch (e) {
      console.error(`Failed to import file ${sourceFileId}:`, e);
      failed++;
    }

    // Update job progress
    await db
      .update(driveImportJob)
      .set({ processedFiles: processed, failedFiles: failed })
      .where(eq(driveImportJob.id, jobId));
  }

  // Mark job as complete
  await db
    .update(driveImportJob)
    .set({
      status: failed === fileIds.length ? 'failed' : 'completed',
      processedFiles: processed,
      failedFiles: failed,
      completedAt: new Date(),
    })
    .where(eq(driveImportJob.id, jobId));

  // Send completion email
  await sendImportCompletionEmail(userEmail, 'OneDrive', processed, failed, fileIds.length);
}
