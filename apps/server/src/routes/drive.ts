import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { createDb } from '../db';
import { driveFile, driveFolder, session, user } from '../db/schema';
import { env } from '../env';

export const driveApiRouter = new Hono();

// Helper to get user from session token
async function getUserFromToken(token: string | undefined) {
  if (!token) return null;

  const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
  try {
    const sessionRecord = await db.query.session.findFirst({
      where: and(eq(session.token, token), eq(session.expiresAt, new Date())),
    });

    if (!sessionRecord) return null;

    const userRecord = await db.query.user.findFirst({
      where: eq(user.id, sessionRecord.userId),
    });

    return userRecord;
  } finally {
    await conn.end();
  }
}

// Upload file endpoint
driveApiRouter.post('/upload', async (c) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  const userRecord = await getUserFromToken(token);

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
      const bucket = env.THREADS_BUCKET;
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
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  const userRecord = await getUserFromToken(token);

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

    const bucket = env.THREADS_BUCKET;
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

    const bucket = env.THREADS_BUCKET;
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
        const bucket = env.THREADS_BUCKET;
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
