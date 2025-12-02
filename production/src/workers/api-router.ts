/**
 * Worker 1: API Router - Lightweight entry point
 *
 * This worker handles:
 * - Health checks
 * - Root redirects
 * - Sentry monitoring proxy
 * - Routes requests to specialized workers via Service Bindings
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Env = {
  // Worker URLs for HTTP routing (not service bindings to avoid cold start cascading)
  AUTH_WORKER_URL: string;
  TRPC_WORKER_URL: string;
  WEBHOOKS_WORKER_URL: string;

  // Environment variables
  VITE_PUBLIC_APP_URL: string;
  COOKIE_DOMAIN: string;
};

const SENTRY_HOST = 'o4509328786915328.ingest.us.sentry.io';
const SENTRY_PROJECT_IDS = new Set(['4509328795303936']);

const app = new Hono<{ Bindings: Env }>();

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

// Health check - handled locally (no forwarding)
app.get('/health', (c) => c.json({ message: 'Nubo API Router is Up!' }));

// Root redirect
app.get('/', (c) => c.redirect(c.env.VITE_PUBLIC_APP_URL));

// Sentry monitoring tunnel
app.post('/monitoring/sentry', async (c) => {
  try {
    const envelopeBytes = await c.req.arrayBuffer();
    const envelope = new TextDecoder().decode(envelopeBytes);
    const piece = envelope.split('\n')[0];
    const header = JSON.parse(piece);
    const dsn = new URL(header['dsn']);
    const project_id = dsn.pathname?.replace('/', '');

    if (dsn.hostname !== SENTRY_HOST) {
      throw new Error(`Invalid sentry hostname: ${dsn.hostname}`);
    }

    if (!project_id || !SENTRY_PROJECT_IDS.has(project_id)) {
      throw new Error(`Invalid sentry project id: ${project_id}`);
    }

    const upstream_sentry_url = `https://${SENTRY_HOST}/api/${project_id}/envelope/`;
    await fetch(upstream_sentry_url, {
      method: 'POST',
      body: envelopeBytes,
    });

    return c.json({ status: 'ok' });
  } catch (e) {
    console.error('Sentry tunnel error:', e);
    return c.json({ status: 'error' }, 400);
  }
});

// Helper to forward requests to other workers via HTTP
async function forwardRequest(c: any, workerUrl: string): Promise<Response> {
  const url = new URL(c.req.url);
  const targetUrl = workerUrl + url.pathname + url.search;

  // Clone headers but update host
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Forwarded-Host', url.host);

  const fetchOptions: RequestInit = {
    method: c.req.method,
    headers,
    redirect: 'manual',
  };

  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    fetchOptions.body = c.req.raw.body;
  }

  return fetch(targetUrl, fetchOptions);
}

// Forward /auth/* to Auth Worker
app.all('/auth/*', async (c) => {
  return forwardRequest(c, c.env.AUTH_WORKER_URL);
});

// Forward /.well-known/* to Auth Worker
app.all('/.well-known/*', async (c) => {
  return forwardRequest(c, c.env.AUTH_WORKER_URL);
});

// Forward /api/* to TRPC Worker
app.all('/api/*', async (c) => {
  return forwardRequest(c, c.env.TRPC_WORKER_URL);
});

// Forward /webhooks/*, /a8n/*, queues, and crons to Webhooks Worker
app.all('/webhooks/*', async (c) => {
  return forwardRequest(c, c.env.WEBHOOKS_WORKER_URL);
});

app.all('/a8n/*', async (c) => {
  return forwardRequest(c, c.env.WEBHOOKS_WORKER_URL);
});

app.all('/recordings/*', async (c) => {
  return forwardRequest(c, c.env.WEBHOOKS_WORKER_URL);
});

// Forward MCP routes to TRPC Worker (which handles MCP)
app.all('/mcp/*', async (c) => {
  return forwardRequest(c, c.env.TRPC_WORKER_URL);
});

app.all('/sse/*', async (c) => {
  return forwardRequest(c, c.env.TRPC_WORKER_URL);
});

// Catch-all 404
app.all('*', (c) => c.json({ error: 'Not Found' }, 404));

export default app;
