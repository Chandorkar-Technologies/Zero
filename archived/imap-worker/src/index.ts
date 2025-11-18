import { Hono } from 'hono';
import { Effect } from 'effect';
import type { Env } from './env';
import { discoverEmailProvider } from './lib/auto-discovery';
import { ImapClient, createImapClientFromDB } from './lib/imap-client';
import { syncConnection } from './lib/sync-engine';

const app = new Hono<{ Bindings: Env }>();

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'imap-worker' });
});

// Discover IMAP settings from email address
app.post('/discover', async (c) => {
  try {
    const { email } = await c.req.json<{ email: string }>();

    if (!email) {
      return c.json({ error: 'Email is required' }, 400);
    }

    const result = await Effect.runPromise(discoverEmailProvider(email));
    return c.json(result);
  } catch (error) {
    console.error('[IMAP Worker] Discovery failed:', error);
    return c.json({ error: 'Failed to discover email settings' }, 500);
  }
});

// Test IMAP connection
app.post('/test', async (c) => {
  try {
    const input = await c.req.json<{
      email: string;
      password: string;
      imapHost: string;
      imapPort: number;
      imapSecure: boolean;
    }>();

    const { email, password, imapHost, imapPort, imapSecure } = input;

    const imapClient = new ImapClient({
      host: imapHost,
      port: imapPort,
      secure: imapSecure,
      auth: { user: email, pass: password },
    });

    // Test with 30 second timeout
    const testEffect = imapClient.testConnection();
    const timeoutEffect = Effect.timeout(testEffect, '30 seconds');
    const result = await Effect.runPromise(Effect.either(timeoutEffect));

    if (result._tag === 'Right' && result.right) {
      return c.json({
        success: true,
        message: 'Connection test successful!',
      });
    } else if (result._tag === 'Left') {
      const error = result.left;
      if (error && typeof error === 'object' && 'message' in error &&
          (error.message as string).includes('Timeout')) {
        return c.json({
          success: false,
          message: 'Connection test timed out. Please check your server settings.',
        });
      }
      return c.json({
        success: false,
        message: error?.message || 'Connection test failed.',
      });
    }

    return c.json({
      success: false,
      message: 'Connection test failed.',
    });
  } catch (error: any) {
    console.error('[IMAP Worker] Test failed:', error);
    return c.json({
      success: false,
      message: error?.message || 'Failed to test connection',
    }, 500);
  }
});

// Fetch emails from R2 for an IMAP connection
app.get('/emails/:connectionId', async (c) => {
  try {
    const connectionId = c.req.param('connectionId');
    const maxResults = parseInt(c.req.query('maxResults') || '50');
    const cursor = c.req.query('cursor') || '';

    const threadsBucket = c.env.THREADS_BUCKET;

    const listed = await threadsBucket.list({
      prefix: `${connectionId}/`,
      limit: maxResults,
      cursor: cursor || undefined,
    });

    const threads: { id: string; historyId: string | null; $raw?: unknown }[] = [];

    for (const obj of listed.objects) {
      try {
        const threadObject = await threadsBucket.get(obj.key);
        if (!threadObject) continue;

        const threadData = JSON.parse(await threadObject.text());
        const threadId = obj.key.split('/')[1]?.replace('.json', '') ||
                        threadData.latest?.threadId ||
                        threadData.latest?.id;

        threads.push({
          id: threadId,
          historyId: null,
          $raw: threadData,
        });
      } catch (error) {
        console.error(`[IMAP Worker] Failed to parse thread ${obj.key}:`, error);
      }
    }

    return c.json({
      threads,
      nextPageToken: listed.truncated ? listed.cursor : null,
    });
  } catch (error) {
    console.error('[IMAP Worker] Failed to fetch emails:', error);
    return c.json({ error: 'Failed to fetch emails' }, 500);
  }
});

// Queue consumer for IMAP sync
export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    console.log('[IMAP Worker] Processing batch with', batch.messages.length, 'messages');

    await Promise.all(
      batch.messages.map(async (msg) => {
        const { connectionId, userId, isInitialSync, db } = msg.body;

        try {
          console.log(`[IMAP Worker] Syncing connection ${connectionId} for user ${userId}`);

          // Create IMAP client
          const imapClient = await Effect.runPromise(createImapClientFromDB(connectionId, db));

          // Perform sync
          const result = await Effect.runPromise(
            syncConnection(imapClient, connectionId, db, env.THREADS_BUCKET, {
              isInitialSync,
              limit: isInitialSync ? 100 : undefined,
            }),
          );

          console.log(
            `[IMAP Worker] Sync complete for ${connectionId}. ` +
              `Synced ${result.totalSynced} emails from folders: ${result.folders.join(', ')}`,
          );
        } catch (error) {
          console.error(`[IMAP Worker] Failed to sync connection ${connectionId}:`, error);
        }
      }),
    );

    console.log('[IMAP Worker] Batch processing complete');
  },
};
