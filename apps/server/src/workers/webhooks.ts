/**
 * Worker 4: Webhooks Worker
 *
 * This worker handles:
 * - /webhooks/* routes (LiveKit, external webhooks)
 * - /a8n/* routes (Google notifications)
 * - /recordings/* routes
 * - Queue consumers (subscribe, thread, send-email)
 * - Scheduled tasks (crons)
 * - Email processing (inbound email)
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import {
  toAttachmentFiles,
  type SerializedAttachment,
  type AttachmentFile,
} from '../lib/attachments';
import { getZeroAgent } from '../lib/server-utils';
import { EProviders, type IEmailSendBatch } from '../types';
import { enableBrainFunction } from '../lib/brain';
import { initTracing } from '../lib/tracing';
import { verifyToken } from '../lib/server-utils';
import type { ZeroEnv } from '../env';
import { createDb } from '../db';
import { cors } from 'hono/cors';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { connection, email } from '../db/schema';
import PostalMime from 'postal-mime';

type HonoEnv = {
  Bindings: ZeroEnv;
};

const app = new Hono<HonoEnv>();

// CORS middleware
app.use('*', cors({
  origin: (origin, c) => {
    if (!origin) return null;
    if (origin === 'http://localhost:3000') return origin;

    let hostname: string;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return null;
    }

    const cookieDomain = c.env.COOKIE_DOMAIN;
    if (!cookieDomain) return null;
    const domain = cookieDomain.startsWith('.') ? cookieDomain.substring(1) : cookieDomain;
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      return origin;
    }
    return null;
  },
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-Zero-Redirect'],
}));

// Health check
app.get('/health', (c) => c.json({ message: 'Nubo Webhooks Worker is Up!' }));

// ================== ROCKET.CHAT SSO ENDPOINTS ==================

// Helper to make Rocket.Chat API calls
async function rocketchatApi(
  env: ZeroEnv,
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
) {
  const url = `${env.ROCKETCHAT_URL}/api/v1${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Auth-Token': env.ROCKETCHAT_ADMIN_AUTH_TOKEN!,
    'X-User-Id': env.ROCKETCHAT_ADMIN_USER_ID!,
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (method === 'POST' && body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return response.json();
}

// SSO endpoint - called by Rocket.Chat iframe to validate user
// This is the API URL configured in Rocket.Chat Admin → Accounts → Iframe
app.post('/webhooks/rocketchat/sso', async (c) => {
  try {
    const env = c.env;

    if (!env.ROCKETCHAT_URL || !env.ROCKETCHAT_ADMIN_AUTH_TOKEN || !env.ROCKETCHAT_ADMIN_USER_ID) {
      console.error('[ROCKETCHAT] Missing configuration');
      return c.json({ error: 'Rocket.Chat not configured' }, 500);
    }

    // Get the auth cookie from the request (sent by iframe)
    const cookies = c.req.header('cookie') || '';

    // Forward the request to our auth endpoint to validate the session
    const authResponse = await fetch(`${env.BASE_URL}/auth/get-session`, {
      headers: {
        'Cookie': cookies,
      },
    });

    if (!authResponse.ok) {
      return c.body('', 401);
    }

    const session = await authResponse.json() as { user?: { id: string } };
    if (!session?.user?.id) {
      return c.body('', 401);
    }

    // Get the user's Nubo username from database
    const { db, conn } = await import('../db').then(m => m.createDb(env.HYPERDRIVE.connectionString));
    const { user } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');

    const nuboUser = await db.query.user.findFirst({
      where: eq(user.id, session.user.id),
      columns: { id: true, username: true, name: true, email: true },
    });

    await conn.end();

    if (!nuboUser?.username) {
      console.log('[ROCKETCHAT] User has no Nubo username:', session.user.id);
      return c.body('', 401);
    }

    const rcUsername = nuboUser.username;
    const rcEmail = `${nuboUser.username}@nubo.email`;
    const rcName = nuboUser.name || nuboUser.username;

    // Check if user exists in Rocket.Chat
    let rcUser: any = null;
    try {
      const userInfo = await rocketchatApi(env, `/users.info?username=${rcUsername}`) as any;
      if (userInfo.success && userInfo.user) {
        rcUser = userInfo.user;
      }
    } catch {
      // User doesn't exist, will be created below
    }

    // Create user if doesn't exist
    if (!rcUser) {
      console.log('[ROCKETCHAT] Creating user:', rcUsername);
      const createResult = await rocketchatApi(env, '/users.create', 'POST', {
        username: rcUsername,
        email: rcEmail,
        name: rcName,
        password: crypto.randomUUID(), // Random password, user won't use it
        verified: true,
      }) as any;

      if (!createResult.success) {
        console.error('[ROCKETCHAT] Failed to create user:', createResult);
        return c.body('', 401);
      }
      rcUser = createResult.user;
    }

    // Generate login token for the user
    const tokenResult = await rocketchatApi(env, '/users.createToken', 'POST', {
      userId: rcUser._id,
    }) as any;

    if (!tokenResult.success || !tokenResult.data?.authToken) {
      console.error('[ROCKETCHAT] Failed to create token:', tokenResult);
      return c.body('', 401);
    }

    // Return the token in the format Rocket.Chat expects
    return c.json({
      loginToken: tokenResult.data.authToken,
    });

  } catch (error) {
    console.error('[ROCKETCHAT] SSO error:', error);
    return c.body('', 401);
  }
});

// Get Rocket.Chat token for authenticated Nubo user (called by frontend)
app.get('/webhooks/rocketchat/token', async (c) => {
  try {
    const env = c.env;

    if (!env.ROCKETCHAT_URL || !env.ROCKETCHAT_ADMIN_AUTH_TOKEN || !env.ROCKETCHAT_ADMIN_USER_ID) {
      return c.json({ error: 'Rocket.Chat not configured' }, 500);
    }

    // Get the auth cookie from the request
    const cookies = c.req.header('cookie') || '';

    // Validate session
    const authResponse = await fetch(`${env.BASE_URL}/auth/get-session`, {
      headers: {
        'Cookie': cookies,
      },
    });

    if (!authResponse.ok) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const session = await authResponse.json() as { user?: { id: string } };
    if (!session?.user?.id) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Get the user's Nubo username
    const { db, conn } = await import('../db').then(m => m.createDb(env.HYPERDRIVE.connectionString));
    const { user } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');

    const nuboUser = await db.query.user.findFirst({
      where: eq(user.id, session.user.id),
      columns: { id: true, username: true, name: true, email: true },
    });

    await conn.end();

    if (!nuboUser?.username) {
      return c.json({ error: 'No Nubo username set' }, 400);
    }

    const rcUsername = nuboUser.username;
    const rcEmail = `${nuboUser.username}@nubo.email`;
    const rcName = nuboUser.name || nuboUser.username;

    // Check if user exists in Rocket.Chat
    let rcUser: any = null;
    try {
      const userInfo = await rocketchatApi(env, `/users.info?username=${rcUsername}`) as any;
      if (userInfo.success && userInfo.user) {
        rcUser = userInfo.user;
      }
    } catch {
      // User doesn't exist, will be created below
    }

    // Create user if doesn't exist
    if (!rcUser) {
      console.log('[ROCKETCHAT] Creating user:', rcUsername);
      const createResult = await rocketchatApi(env, '/users.create', 'POST', {
        username: rcUsername,
        email: rcEmail,
        name: rcName,
        password: crypto.randomUUID(),
        verified: true,
      }) as any;

      if (!createResult.success) {
        console.error('[ROCKETCHAT] Failed to create user:', createResult);
        return c.json({ error: 'Failed to create Rocket.Chat user' }, 500);
      }
      rcUser = createResult.user;
    }

    // Generate login token
    const tokenResult = await rocketchatApi(env, '/users.createToken', 'POST', {
      userId: rcUser._id,
    }) as any;

    if (!tokenResult.success || !tokenResult.data?.authToken) {
      console.error('[ROCKETCHAT] Failed to create token:', tokenResult);
      return c.json({ error: 'Failed to create token' }, 500);
    }

    return c.json({
      token: tokenResult.data.authToken,
      userId: rcUser._id,
      username: rcUser.username,
    });

  } catch (error) {
    console.error('[ROCKETCHAT] Token error:', error);
    return c.json({ error: 'Internal error' }, 500);
  }
});

// Recordings endpoint
app.get('/recordings/:r2Key', async (c) => {
  try {
    const r2Key = c.req.param('r2Key');
    const object = await c.env.RECORDINGS_BUCKET.get(r2Key);

    if (!object) {
      return c.json({ error: 'Recording not found' }, { status: 404 });
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'video/mp4');
    headers.set('Content-Length', object.size.toString());
    headers.set('Cache-Control', 'public, max-age=31536000');

    return new Response(object.body, { headers });
  } catch (e) {
    console.error('error serving recording', e);
    return c.json({ error: 'error serving recording' }, { status: 500 });
  }
});

// LiveKit egress webhook
app.post('/webhooks/livekit/egress', async (c) => {
  try {
    const body = await c.req.json<{
      event: string;
      egressId: string;
      roomName: string;
      file?: {
        filename: string;
        size: number;
        duration: number;
      };
    }>();

    if (body.event === 'egress_ended' && body.file) {
      console.log('Egress completed:', body);
    }

    return c.json({ success: true });
  } catch (e) {
    console.error('error handling egress webhook', e);
    return c.json({ error: 'error handling webhook' }, { status: 500 });
  }
});

// Google notification endpoint
app.post('/a8n/notify/:providerId', async (c) => {
  const tracer = initTracing();
  const span = tracer.startSpan('a8n_notify', {
    attributes: {
      'provider.id': c.req.param('providerId'),
      'notification.type': 'email_notification',
      'http.method': c.req.method,
      'http.url': c.req.url,
    },
  });

  try {
    if (!c.req.header('Authorization')) {
      span.setAttributes({ 'auth.status': 'missing' });
      return c.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (c.env.DISABLE_WORKFLOWS === 'true') {
      span.setAttributes({ 'workflows.disabled': true });
      return c.json({ message: 'OK' }, { status: 200 });
    }
    const providerId = c.req.param('providerId');
    if (providerId === EProviders.google) {
      const body = await c.req.json<{ historyId: string }>();
      const subHeader = c.req.header('x-goog-pubsub-subscription-name');

      span.setAttributes({
        'history.id': body.historyId,
        'subscription.name': subHeader || 'missing',
      });

      if (!subHeader) {
        console.log('[GOOGLE] no subscription header', body);
        span.setAttributes({ 'error.type': 'missing_subscription_header' });
        return c.json({}, { status: 200 });
      }
      const isValid = await verifyToken(c.req.header('Authorization')!.split(' ')[1]);
      if (!isValid) {
        console.log('[GOOGLE] invalid request', body);
        span.setAttributes({ 'auth.status': 'invalid' });
        return c.json({}, { status: 200 });
      }

      span.setAttributes({ 'auth.status': 'valid' });

      try {
        await c.env.thread_queue.send({
          providerId,
          historyId: body.historyId,
          subscriptionName: subHeader,
        });
        span.setAttributes({ 'queue.message_sent': true });
      } catch (error) {
        console.error('Error sending to thread queue', error, {
          providerId,
          historyId: body.historyId,
          subscriptionName: subHeader,
        });
        span.recordException(error as Error);
        span.setStatus({ code: 2, message: (error as Error).message });
      }
      return c.json({ message: 'OK' }, { status: 200 });
    }
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: 2, message: (error as Error).message });
    throw error;
  } finally {
    span.end();
  }
});

export default class WebhooksWorker extends WorkerEntrypoint<ZeroEnv> {
  async fetch(request: Request): Promise<Response> {
    return app.fetch(request, this.env, this.ctx);
  }

  async queue(
    batch: MessageBatch<unknown> | { queue: string; messages: Array<{ body: IEmailSendBatch }> },
  ) {
    switch (true) {
      case batch.queue.startsWith('subscribe-queue'): {
        console.log('batch', batch);
        await Promise.all(
          batch.messages.map(async (msg: any) => {
            const connectionId = msg.body.connectionId;
            const providerId = msg.body.providerId;
            try {
              await enableBrainFunction({ id: connectionId, providerId });
            } catch (error) {
              console.error(
                `Failed to enable brain function for connection ${connectionId}:`,
                error,
              );
            }
          }),
        );
        console.log('[SUBSCRIBE_QUEUE] batch done');
        return;
      }
      case batch.queue.startsWith('send-email-queue'): {
        await Promise.all(
          batch.messages.map(async (msg: any) => {
            const { messageId, connectionId, mail } = msg.body;

            const { pending_emails_status: statusKV, pending_emails_payload: payloadKV } = this
              .env as { pending_emails_status: KVNamespace; pending_emails_payload: KVNamespace };

            const status = await statusKV.get(messageId);
            if (status === 'cancelled') {
              console.log(`Email ${messageId} cancelled – skipping send.`);
              return;
            }

            let payload = mail;
            if (!payload) {
              const stored = await payloadKV.get(messageId);
              if (!stored) {
                console.error(`No payload found for scheduled email ${messageId}`);
                return;
              }
              payload = JSON.parse(stored);
            }

            const agent = await getZeroAgent(connectionId, this.ctx);
            try {
              if (Array.isArray((payload as any).attachments)) {
                const attachments = (payload as any).attachments;

                const processedAttachments = await Promise.all(
                  attachments.map(
                    async (att: SerializedAttachment | AttachmentFile, index: number) => {
                      if ('arrayBuffer' in att && typeof att.arrayBuffer === 'function') {
                        return { attachment: att as AttachmentFile, index };
                      } else {
                        const processed = toAttachmentFiles([att as SerializedAttachment]);
                        return { attachment: processed[0], index };
                      }
                    },
                  ),
                );

                const orderedAttachments = Array.from({ length: attachments.length });
                processedAttachments.forEach(({ attachment, index }) => {
                  orderedAttachments[index] = attachment;
                });

                (payload as any).attachments = orderedAttachments;
              }

              if ('draftId' in (payload as any) && (payload as any).draftId) {
                const { draftId, ...rest } = payload as any;
                await agent.stub.sendDraft(draftId, rest as any);
              } else {
                await agent.stub.create(payload as any);
              }

              await statusKV.delete(messageId);
              await payloadKV.delete(messageId);
              console.log(`Email ${messageId} sent successfully`);
            } catch (error) {
              console.error(`Failed to send scheduled email ${messageId}:`, error);
              await statusKV.delete(messageId);
              await payloadKV.delete(messageId);
            }
          }),
        );
        return;
      }
      case batch.queue.startsWith('thread-queue'): {
        const tracer = initTracing();

        await Promise.all(
          batch.messages.map(async (msg: any) => {
            const span = tracer.startSpan('thread_queue_processing', {
              attributes: {
                'provider.id': msg.body.providerId,
                'history.id': msg.body.historyId,
                'subscription.name': msg.body.subscriptionName,
                'queue.name': batch.queue,
              },
            });

            try {
              const providerId = msg.body.providerId;
              const historyId = msg.body.historyId;
              const subscriptionName = msg.body.subscriptionName;

              const workflowRunner = this.env.WORKFLOW_RUNNER.get(this.env.WORKFLOW_RUNNER.newUniqueId());
              const result = await workflowRunner.runMainWorkflow({
                providerId,
                historyId,
                subscriptionName,
              });
              console.log('[THREAD_QUEUE] result', result);
              span.setAttributes({
                'workflow.result': typeof result === 'string' ? result : JSON.stringify(result),
                'workflow.success': true,
              });
            } catch (error) {
              console.error('Error running workflow', error);
              span.recordException(error as Error);
              span.setStatus({ code: 2, message: (error as Error).message });
            } finally {
              span.end();
            }
          }),
        );
        break;
      }
    }
  }

  async scheduled() {
    console.log('Running scheduled tasks...');

    await this.processScheduledEmails();
    await this.processExpiredSubscriptions();
  }

  async email(message: ForwardableEmailMessage, env: ZeroEnv, _ctx: ExecutionContext) {
    console.log(`[EMAIL] Received email from ${message.from} to ${message.to}`);

    try {
      const parser = new PostalMime();
      const rawEmail = await new Response(message.raw).arrayBuffer();
      const parsed = await parser.parse(rawEmail);

      const messageId = message.headers.get('Message-ID') || crypto.randomUUID();
      const r2Key = `email/${messageId}`;
      await env.THREADS_BUCKET.put(r2Key, rawEmail);

      const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
      const recipient = message.to;

      const foundConnection = await db.query.connection.findFirst({
        where: eq(connection.email, recipient),
      });

      if (!foundConnection) {
        console.log(`[EMAIL] No connection found for recipient ${recipient}`);
        await conn.end();
        return;
      }

      let threadId = crypto.randomUUID();
      const inReplyTo = parsed.inReplyTo;

      if (inReplyTo) {
        const parent = await db.query.email.findFirst({
          where: eq(email.messageId, inReplyTo),
        });
        if (parent) {
          threadId = parent.threadId;
        }
      }

      await db.insert(email).values({
        id: crypto.randomUUID(),
        threadId,
        connectionId: foundConnection.id,
        messageId: parsed.messageId || messageId,
        inReplyTo: parsed.inReplyTo,
        references: typeof parsed.references === 'string' ? parsed.references : (Array.isArray(parsed.references) ? parsed.references.join(' ') : null),
        subject: parsed.subject || '(No Subject)',
        from: parsed.from ? { name: parsed.from.name, address: parsed.from.address } : { name: '', address: message.from },
        to: parsed.to?.map(t => ({ name: t.name, address: t.address })) || [],
        cc: parsed.cc?.map(t => ({ name: t.name, address: t.address })) || [],
        bcc: parsed.bcc?.map(t => ({ name: t.name, address: t.address })) || [],
        bodyR2Key: r2Key,
        internalDate: new Date(parsed.date || Date.now()),
        snippet: parsed.text?.substring(0, 200) || '',
        isRead: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await conn.end();
      console.log(`[EMAIL] Processed email ${messageId} for connection ${foundConnection.id}`);

    } catch (error) {
      console.error('[EMAIL] Error processing email:', error);
    }
  }

  private async processScheduledEmails() {
    console.log('Checking for scheduled emails ready to be queued...');
    const { scheduled_emails: scheduledKV, send_email_queue } = this.env as {
      scheduled_emails: KVNamespace;
      send_email_queue: Queue<IEmailSendBatch>;
    };

    try {
      const now = Date.now();
      const twelveHoursFromNow = now + 12 * 60 * 60 * 1000;

      let cursor: string | undefined = undefined;
      const batchSize = 1000;

      do {
        const listResp: {
          keys: { name: string }[];
          cursor?: string;
        } = await scheduledKV.list({ cursor, limit: batchSize });
        cursor = listResp.cursor;

        for (const key of listResp.keys) {
          try {
            const scheduledData = await scheduledKV.get(key.name);
            if (!scheduledData) continue;

            const { messageId, connectionId, sendAt } = JSON.parse(scheduledData);

            if (sendAt <= twelveHoursFromNow) {
              const delaySeconds = Math.max(0, Math.floor((sendAt - now) / 1000));

              console.log(`Queueing scheduled email ${messageId} with ${delaySeconds}s delay`);

              const queueBody: IEmailSendBatch = {
                messageId,
                connectionId,
                sendAt,
              };

              await send_email_queue.send(queueBody, { delaySeconds });
              await scheduledKV.delete(key.name);

              console.log(`Successfully queued scheduled email ${messageId}`);
            }
          } catch (error) {
            console.error('Failed to process scheduled email key', key.name, error);
          }
        }
      } while (cursor);
    } catch (error) {
      console.error('Error processing scheduled emails:', error);
    }
  }

  private async processExpiredSubscriptions() {
    console.log('[SCHEDULED] Checking for expired subscriptions...');
    const { db, conn } = createDb(this.env.HYPERDRIVE.connectionString);
    const allAccounts = await db.query.connection.findMany({
      where: (fields, { isNotNull, and }) =>
        and(isNotNull(fields.accessToken), isNotNull(fields.refreshToken)),
    });
    await conn.end();
    console.log('[SCHEDULED] allAccounts', allAccounts.length);
    const now = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const expiredSubscriptions: Array<{ connectionId: string; providerId: EProviders }> = [];

    const nowTs = Date.now();

    const unsnoozeMap: Record<string, { threadIds: string[]; keyNames: string[] }> = {};

    let cursor: string | undefined = undefined;
    do {
      const listResp: {
        keys: { name: string; metadata?: { wakeAt?: string } }[];
        cursor?: string;
      } = await this.env.snoozed_emails.list({ cursor, limit: 1000 });
      cursor = listResp.cursor;

      for (const key of listResp.keys) {
        try {
          const wakeAtIso = key.metadata?.wakeAt as string | undefined;
          if (!wakeAtIso) continue;
          const wakeAt = new Date(wakeAtIso).getTime();
          if (wakeAt > nowTs) continue;

          const [threadId, connectionId] = key.name.split('__');
          if (!threadId || !connectionId) continue;

          if (!unsnoozeMap[connectionId]) {
            unsnoozeMap[connectionId] = { threadIds: [], keyNames: [] };
          }
          unsnoozeMap[connectionId].threadIds.push(threadId);
          unsnoozeMap[connectionId].keyNames.push(key.name);
        } catch (error) {
          console.error('Failed to prepare unsnooze for key', key.name, error);
        }
      }
    } while (cursor);

    await Promise.all(
      allAccounts.map(async ({ id, providerId }) => {
        const lastSubscribed = await this.env.gmail_sub_age.get(`${id}__${providerId}`);

        if (lastSubscribed) {
          const subscriptionDate = new Date(lastSubscribed);
          if (subscriptionDate < fiveDaysAgo) {
            console.log(`[SCHEDULED] Found expired Google subscription for connection: ${id}`);
            expiredSubscriptions.push({ connectionId: id, providerId: providerId as EProviders });
          }
        } else {
          expiredSubscriptions.push({ connectionId: id, providerId: providerId as EProviders });
        }
      }),
    );

    if (expiredSubscriptions.length > 0) {
      console.log(
        `[SCHEDULED] Sending ${expiredSubscriptions.length} expired subscriptions to renewal queue`,
      );
      await Promise.all(
        expiredSubscriptions.map(async ({ connectionId, providerId }) => {
          await this.env.subscribe_queue.send({ connectionId, providerId });
        }),
      );
    }

    console.log(
      `[SCHEDULED] Processed ${allAccounts.length} accounts, found ${expiredSubscriptions.length} expired subscriptions`,
    );
  }
}
