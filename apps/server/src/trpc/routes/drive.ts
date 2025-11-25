import { privateProcedure, router } from '../trpc';
import { driveFile, driveFolder, driveImportJob } from '../../db/schema';
import { eq, and, isNull, desc, asc } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type * as schema from '../../db/schema';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { env } from '../../env';

// Helper to get file extension
function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

// Helper to check if file is editable in OnlyOffice
function isEditableInOnlyOffice(_mimeType: string, filename: string): boolean {
  const ext = getFileExtension(filename);
  const editableExtensions = [
    // Documents
    'doc', 'docx', 'odt', 'rtf', 'txt',
    // Spreadsheets
    'xls', 'xlsx', 'ods', 'csv',
    // Presentations
    'ppt', 'pptx', 'odp',
    // PDF (view/edit)
    'pdf',
  ];
  return editableExtensions.includes(ext);
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
      const bucket = env.THREADS_BUCKET;
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
      const bucket = env.THREADS_BUCKET;
      const object = await bucket.get(file.r2Key);

      if (!object) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found in storage' });
      }

      // Return the file content as base64 for small files, or a download endpoint for large files
      if (file.size < 10 * 1024 * 1024) { // Less than 10MB
        const arrayBuffer = await object.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        return {
          type: 'base64' as const,
          data: base64,
          mimeType: file.mimeType,
          fileName: file.name,
        };
      }

      // For larger files, return download endpoint
      return {
        type: 'url' as const,
        url: `/api/drive/download/${file.id}`,
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
      const bucket = env.THREADS_BUCKET;
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
    const bucket = env.THREADS_BUCKET;
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

  // Get OnlyOffice editor config for a file
  getEditorConfig: privateProcedure
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

      if (!isEditableInOnlyOffice(file.mimeType, file.name)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File type not supported for editing' });
      }

      const ext = getFileExtension(file.name);
      const documentType = ['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)
        ? 'word'
        : ['xls', 'xlsx', 'ods', 'csv'].includes(ext)
          ? 'cell'
          : ['ppt', 'pptx', 'odp'].includes(ext)
            ? 'slide'
            : 'word'; // default to word for PDF etc

      // Generate unique key for this editing session
      const documentKey = `${file.id}-${file.updatedAt.getTime()}`;

      // OnlyOffice Document Server configuration
      const config = {
        document: {
          fileType: ext,
          key: documentKey,
          title: file.name,
          url: `${env.VITE_PUBLIC_BACKEND_URL}/api/drive/file/${file.id}/content`,
        },
        documentType,
        editorConfig: {
          callbackUrl: `${env.VITE_PUBLIC_BACKEND_URL}/api/onlyoffice/callback`,
          user: {
            id: sessionUser.id,
            name: sessionUser.name || sessionUser.email,
          },
          customization: {
            autosave: true,
            forcesave: true,
          },
        },
      };

      return {
        config,
        onlyOfficeUrl: env.ONLYOFFICE_URL || 'http://157.180.65.242',
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
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Failed to list files' });
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

      // Process files in background (simplified - in production would use a queue)
      processGoogleDriveImport(
        input.accessToken,
        input.fileIds,
        sessionUser.id,
        jobId,
        input.targetFolderId || null,
        ctx.db,
      ).catch(console.error);

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

      // Process files in background
      processOneDriveImport(
        input.accessToken,
        input.fileIds,
        sessionUser.id,
        jobId,
        input.targetFolderId || null,
        ctx.db,
      ).catch(console.error);

      return { jobId };
    }),
});

// Background import processor for Google Drive
async function processGoogleDriveImport(
  accessToken: string,
  fileIds: string[],
  userId: string,
  jobId: string,
  targetFolderId: string | null,
  db: NeonHttpDatabase<typeof schema>,
) {
  let processed = 0;
  let failed = 0;
  const bucket = env.THREADS_BUCKET;

  for (const sourceFileId of fileIds) {
    try {
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
      }

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
}

// Background import processor for OneDrive
async function processOneDriveImport(
  accessToken: string,
  fileIds: string[],
  userId: string,
  jobId: string,
  targetFolderId: string | null,
  db: NeonHttpDatabase<typeof schema>,
) {
  let processed = 0;
  let failed = 0;
  const bucket = env.THREADS_BUCKET;

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
}
