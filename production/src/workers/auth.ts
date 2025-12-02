/**
 * Worker 2: Auth Worker
 *
 * This worker handles:
 * - /auth/* routes (better-auth handlers)
 * - /.well-known/oauth-authorization-server
 * - Session management
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { oAuthDiscoveryMetadata } from 'better-auth/plugins';
import { createAuth } from '../lib/auth';
import type { ZeroEnv } from '../env';

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
app.get('/health', (c) => c.json({ message: 'Nubo Auth Worker is Up!' }));

// OAuth discovery metadata
app.get('/.well-known/oauth-authorization-server', async (c) => {
  const auth = createAuth();
  return oAuthDiscoveryMetadata(auth)(c.req.raw);
});

// Auth routes - delegate to better-auth
app.on(['GET', 'POST', 'OPTIONS'], '/auth/*', (c) => {
  const auth = createAuth();
  return auth.handler(c.req.raw);
});

export default app;
