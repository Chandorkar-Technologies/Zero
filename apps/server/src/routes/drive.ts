import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDb } from '../db';
import { driveFile, driveFolder } from '../db/schema';
import { env } from '../env';
import type { HonoContext } from '../ctx';
import jwt from '@tsndr/cloudflare-worker-jwt';

// Helper to get file extension
function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

// Helper to check if file is editable in OnlyOffice
function isEditableInOnlyOffice(filename: string): boolean {
  const ext = getFileExtension(filename);
  const editableExtensions = [
    'doc', 'docx', 'odt', 'rtf', 'txt',
    'xls', 'xlsx', 'ods', 'csv',
    'ppt', 'pptx', 'odp',
  ];
  return editableExtensions.includes(ext);
}

export const driveApiRouter = new Hono<HonoContext>();

// Upload file endpoint
driveApiRouter.post('/upload', async (c) => {
  const userRecord = c.var.sessionUser;

  if (!userRecord) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const formData = await c.req.formData();
    const fileEntry = formData.get('file');
    const folderId = formData.get('folderId') as string | null;

    if (!fileEntry || typeof fileEntry === 'string') {
      return c.json({ error: 'No file provided' }, 400);
    }

    const file = fileEntry as unknown as { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

    const { db, conn } = createDb(env.HYPERDRIVE.connectionString);

    try {
      // Verify folder exists if provided
      if (folderId) {
        const folder = await db.query.driveFolder.findFirst({
          where: and(eq(driveFolder.id, folderId), eq(driveFolder.userId, userRecord.id)),
        });

        if (!folder) {
          return c.json({ error: 'Folder not found' }, 404);
        }
      }

      // Generate file ID and R2 key
      const fileId = crypto.randomUUID();
      const r2Key = `drive/${userRecord.id}/${fileId}/${file.name}`;

      // Upload to R2
      const bucket = env.DRIVE_BUCKET;
      const arrayBuffer = await file.arrayBuffer();
      await bucket.put(r2Key, arrayBuffer, {
        httpMetadata: {
          contentType: file.type,
        },
      });

      // Save to database
      await db.insert(driveFile).values({
        id: fileId,
        userId: userRecord.id,
        folderId: folderId || null,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        r2Key,
        importSource: 'upload',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      return c.json({
        id: fileId,
        name: file.name,
        size: file.size,
        mimeType: file.type,
      });
    } finally {
      await conn.end();
    }
  } catch (error) {
    console.error('Upload error:', error);
    return c.json({ error: 'Upload failed' }, 500);
  }
});

// Download file endpoint
driveApiRouter.get('/download/:fileId', async (c) => {
  const fileId = c.req.param('fileId');
  const userRecord = c.var.sessionUser;

  if (!userRecord) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);

  try {
    const file = await db.query.driveFile.findFirst({
      where: and(eq(driveFile.id, fileId), eq(driveFile.userId, userRecord.id)),
    });

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    const bucket = env.DRIVE_BUCKET;
    const object = await bucket.get(file.r2Key);

    if (!object) {
      return c.json({ error: 'File not found in storage' }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', file.mimeType);
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    headers.set('Content-Length', file.size.toString());

    return new Response(object.body, { headers });
  } finally {
    await conn.end();
  }
});

// Get file content (for OnlyOffice)
driveApiRouter.get('/file/:fileId/content', async (c) => {
  const fileId = c.req.param('fileId');
  // For OnlyOffice, we might need to accept a token in query params
  const _token = c.req.query('token') || c.req.header('Authorization')?.replace('Bearer ', '');

  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);

  try {
    const file = await db.query.driveFile.findFirst({
      where: eq(driveFile.id, fileId),
    });

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    const bucket = env.DRIVE_BUCKET;
    const object = await bucket.get(file.r2Key);

    if (!object) {
      return c.json({ error: 'File not found in storage' }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', file.mimeType);
    headers.set('Content-Length', file.size.toString());
    // CORS headers for OnlyOffice
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(object.body, { headers });
  } finally {
    await conn.end();
  }
});

// OnlyOffice callback endpoint
driveApiRouter.post('/onlyoffice/callback', async (c) => {
  try {
    const body = await c.req.json();
    console.log('[OnlyOffice Callback]', JSON.stringify(body));

    const { status, key, url } = body;

    // Status codes:
    // 0 - no document with the key identifier could be found
    // 1 - document is being edited
    // 2 - document is ready for saving
    // 3 - document saving error has occurred
    // 4 - document is closed with no changes
    // 6 - document is being edited, but the current document state is saved
    // 7 - error has occurred while force saving the document

    if (status === 2 || status === 6) {
      // Document is ready for saving - download and update R2
      // Key format: {fileId}-{timestamp}
      const fileId = key.split('-')[0];

      const { db, conn } = createDb(env.HYPERDRIVE.connectionString);

      try {
        const file = await db.query.driveFile.findFirst({
          where: eq(driveFile.id, fileId),
        });

        if (!file) {
          console.error(`[OnlyOffice Callback] File not found: ${fileId}`);
          return c.json({ error: 0 }); // Return 0 to indicate error to OnlyOffice
        }

        // Download the edited document from OnlyOffice
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`[OnlyOffice Callback] Failed to download document: ${response.status}`);
          return c.json({ error: 0 });
        }

        const content = await response.arrayBuffer();

        // Update file in R2
        const bucket = env.DRIVE_BUCKET;
        await bucket.put(file.r2Key, content, {
          httpMetadata: {
            contentType: file.mimeType,
          },
        });

        // Update file metadata
        await db
          .update(driveFile)
          .set({
            size: content.byteLength,
            updatedAt: new Date(),
          })
          .where(eq(driveFile.id, fileId));

        console.log(`[OnlyOffice Callback] File saved: ${fileId}`);
      } finally {
        await conn.end();
      }
    }

    // Return 0 to indicate success to OnlyOffice
    return c.json({ error: 0 });
  } catch (error) {
    console.error('[OnlyOffice Callback] Error:', error);
    return c.json({ error: 1 });
  }
});

// CORS preflight for OnlyOffice
driveApiRouter.options('/onlyoffice/callback', () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
});

driveApiRouter.options('/file/:fileId/content', () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
});

// Public endpoint to get shared file/folder info by share token (no auth required)
driveApiRouter.get('/shared/:token', async (c) => {
  const token = c.req.param('token');

  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);

  try {
    // Import driveShare table
    const { driveShare } = await import('../db/schema');

    // Find the share by token
    const share = await db.query.driveShare.findFirst({
      where: eq(driveShare.shareToken, token),
      with: {
        file: true,
        folder: true,
        owner: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!share) {
      return c.json({ error: 'Share not found or has expired' }, 404);
    }

    // Check if share has expired
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return c.json({ error: 'This share link has expired' }, 410);
    }

    // Return share info
    return c.json({
      id: share.id,
      type: share.fileId ? 'file' : 'folder',
      accessLevel: share.accessLevel,
      file: share.file ? {
        id: share.file.id,
        name: share.file.name,
        mimeType: share.file.mimeType,
        size: share.file.size,
      } : null,
      folder: share.folder ? {
        id: share.folder.id,
        name: share.folder.name,
      } : null,
      owner: share.owner ? {
        name: share.owner.name,
      } : null,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
    });
  } catch (error) {
    console.error('[Drive Share] Error fetching share:', error);
    return c.json({ error: 'Failed to load shared item' }, 500);
  } finally {
    await conn.end();
  }
});

// Public endpoint to download shared file by share token (no auth required)
driveApiRouter.get('/shared/:token/download', async (c) => {
  const token = c.req.param('token');

  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);

  try {
    const { driveShare } = await import('../db/schema');

    // Find the share by token
    const share = await db.query.driveShare.findFirst({
      where: eq(driveShare.shareToken, token),
      with: {
        file: true,
      },
    });

    if (!share) {
      return c.json({ error: 'Share not found' }, 404);
    }

    // Check if share has expired
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return c.json({ error: 'This share link has expired' }, 410);
    }

    // Only file shares can be downloaded
    if (!share.file) {
      return c.json({ error: 'Only files can be downloaded' }, 400);
    }

    const file = share.file;
    const bucket = env.DRIVE_BUCKET;
    const object = await bucket.get(file.r2Key);

    if (!object) {
      return c.json({ error: 'File not found in storage' }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', file.mimeType);
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
    headers.set('Content-Length', file.size.toString());

    return new Response(object.body, { headers });
  } catch (error) {
    console.error('[Drive Share] Error downloading shared file:', error);
    return c.json({ error: 'Failed to download file' }, 500);
  } finally {
    await conn.end();
  }
});

// Public endpoint to preview shared file (for images, PDFs, videos)
driveApiRouter.get('/shared/:token/preview', async (c) => {
  const token = c.req.param('token');

  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);

  try {
    const { driveShare } = await import('../db/schema');

    // Find the share by token
    const share = await db.query.driveShare.findFirst({
      where: eq(driveShare.shareToken, token),
      with: {
        file: true,
      },
    });

    if (!share) {
      return c.json({ error: 'Share not found' }, 404);
    }

    // Check if share has expired
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return c.json({ error: 'This share link has expired' }, 410);
    }

    if (!share.file) {
      return c.json({ error: 'Only files can be previewed' }, 400);
    }

    const file = share.file;
    const bucket = env.DRIVE_BUCKET;
    const object = await bucket.get(file.r2Key);

    if (!object) {
      return c.json({ error: 'File not found in storage' }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', file.mimeType);
    headers.set('Content-Length', file.size.toString());
    // Allow inline display for preview
    headers.set('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
    // CORS for cross-origin previews
    headers.set('Access-Control-Allow-Origin', '*');

    return new Response(object.body, { headers });
  } catch (error) {
    console.error('[Drive Share] Error previewing shared file:', error);
    return c.json({ error: 'Failed to preview file' }, 500);
  } finally {
    await conn.end();
  }
});

// Get OnlyOffice editor config for shared file (no auth required, but needs edit access)
driveApiRouter.get('/shared/:token/editor-config', async (c) => {
  const token = c.req.param('token');

  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);

  try {
    const { driveShare } = await import('../db/schema');

    // Find the share by token with file and owner info
    const share = await db.query.driveShare.findFirst({
      where: eq(driveShare.shareToken, token),
      with: {
        file: true,
        owner: {
          columns: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!share) {
      return c.json({ error: 'Share not found' }, 404);
    }

    // Check if share has expired
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return c.json({ error: 'This share link has expired' }, 410);
    }

    // Check if user has edit access
    if (share.accessLevel !== 'edit') {
      return c.json({ error: 'You do not have edit access to this file' }, 403);
    }

    if (!share.file) {
      return c.json({ error: 'Only files can be edited' }, 400);
    }

    const file = share.file;

    // Check if file is editable in OnlyOffice
    if (!isEditableInOnlyOffice(file.name)) {
      return c.json({ error: 'File type not supported for editing' }, 400);
    }

    const onlyOfficeUrl = env.ONLYOFFICE_URL || 'https://office.nubo.email';
    const jwtSecret = env.ONLYOFFICE_JWT_SECRET;
    const backendUrl = env.VITE_PUBLIC_BACKEND_URL;

    if (!jwtSecret) {
      return c.json({ error: 'OnlyOffice not configured' }, 500);
    }

    const ext = getFileExtension(file.name);
    const documentType = ['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)
      ? 'word'
      : ['xls', 'xlsx', 'ods', 'csv'].includes(ext)
        ? 'cell'
        : ['ppt', 'pptx', 'odp'].includes(ext)
          ? 'slide'
          : 'word';

    // Generate unique key for this editing session
    const documentKey = `${file.id}-${new Date(file.updatedAt).getTime()}`;

    // OnlyOffice Document Server configuration
    const config = {
      document: {
        fileType: ext,
        key: documentKey,
        title: file.name,
        url: `${backendUrl}/api/drive/file/${file.id}/content`,
      },
      documentType,
      editorConfig: {
        callbackUrl: `${backendUrl}/api/drive/onlyoffice/callback`,
        user: {
          id: `shared-${token.substring(0, 8)}`,
          name: 'Shared User',
        },
        customization: {
          autosave: true,
          forcesave: true,
        },
      },
    };

    // Sign the config with JWT
    const jwtToken = await jwt.sign(config, jwtSecret, { algorithm: 'HS256' });

    return c.json({
      config: {
        ...config,
        token: jwtToken,
      },
      onlyOfficeUrl,
    });
  } catch (error) {
    console.error('[Drive Share] Error getting editor config:', error);
    return c.json({ error: 'Failed to get editor configuration' }, 500);
  } finally {
    await conn.end();
  }
});

// CORS preflight for shared editor config
driveApiRouter.options('/shared/:token/editor-config', () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
});
