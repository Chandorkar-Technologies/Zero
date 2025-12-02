import { createRateLimiterMiddleware, privateProcedure, publicProcedure, router } from '../trpc';
import { getActiveConnection, getZeroDB } from '../../lib/server-utils';
import { Ratelimit } from '@upstash/ratelimit';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { connection } from '../../db/schema';
import { createDb } from '../../db';

export const connectionsRouter = router({
  list: privateProcedure
    .use(
      createRateLimiterMiddleware({
        limiter: Ratelimit.slidingWindow(120, '1m'),
        generatePrefix: ({ sessionUser }) => `ratelimit:get-connections-${sessionUser?.id}`,
      }),
    )
    .query(async ({ ctx }) => {
      const { sessionUser } = ctx;
      const db = await getZeroDB(sessionUser.id);
      const connections = await db.findManyConnections();

      const disconnectedIds = connections
        .filter((c) => c.providerId !== 'imap' && (!c.accessToken || !c.refreshToken))
        .map((c) => c.id);

      return {
        connections: connections.map((connection) => {
          return {
            id: connection.id,
            email: connection.email,
            name: connection.name,
            picture: connection.picture,
            createdAt: connection.createdAt,
            providerId: connection.providerId,
          };
        }),
        disconnectedIds,
      };
    }),
  setDefault: privateProcedure
    .input(z.object({ connectionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { connectionId } = input;
      const user = ctx.sessionUser;
      const db = await getZeroDB(user.id);
      const foundConnection = await db.findUserConnection(connectionId);
      if (!foundConnection) throw new TRPCError({ code: 'NOT_FOUND' });
      await db.updateUser({ defaultConnectionId: connectionId });
    }),
  delete: privateProcedure
    .input(z.object({ connectionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { connectionId } = input;
      const user = ctx.sessionUser;
      const db = await getZeroDB(user.id);
      await db.deleteConnection(connectionId);

      const activeConnection = await getActiveConnection();
      if (connectionId === activeConnection.id) await db.updateUser({ defaultConnectionId: null });
    }),
  getDefault: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.sessionUser) return null;
    const connection = await getActiveConnection();
    return {
      id: connection.id,
      email: connection.email,
      name: connection.name,
      picture: connection.picture,
      createdAt: connection.createdAt,
      providerId: connection.providerId,
    };
  }),

  // IMAP Connection procedures
  discoverImap: privateProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ input }) => {
      const { email } = input;
      const domain = email.split('@')[1];

      // Common IMAP/SMTP settings for popular providers
      const providerSettings: Record<string, any> = {
        'gmail.com': {
          imapHost: 'imap.gmail.com',
          imapPort: 993,
          imapSecure: true,
          smtpHost: 'smtp.gmail.com',
          smtpPort: 587,
          smtpSecure: true,
        },
        'outlook.com': {
          imapHost: 'outlook.office365.com',
          imapPort: 993,
          imapSecure: true,
          smtpHost: 'smtp.office365.com',
          smtpPort: 587,
          smtpSecure: true,
        },
        'hotmail.com': {
          imapHost: 'outlook.office365.com',
          imapPort: 993,
          imapSecure: true,
          smtpHost: 'smtp.office365.com',
          smtpPort: 587,
          smtpSecure: true,
        },
        'yahoo.com': {
          imapHost: 'imap.mail.yahoo.com',
          imapPort: 993,
          imapSecure: true,
          smtpHost: 'smtp.mail.yahoo.com',
          smtpPort: 587,
          smtpSecure: true,
        },
        'icloud.com': {
          imapHost: 'imap.mail.me.com',
          imapPort: 993,
          imapSecure: true,
          smtpHost: 'smtp.mail.me.com',
          smtpPort: 587,
          smtpSecure: true,
        },
      };

      // Check if we have settings for this provider
      if (providerSettings[domain]) {
        return providerSettings[domain];
      }

      // Try common patterns
      return {
        imapHost: `imap.${domain}`,
        imapPort: 993,
        imapSecure: true,
        smtpHost: `smtp.${domain}`,
        smtpPort: 587,
        smtpSecure: true,
      };
    }),

  testImap: privateProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string(),
      imapHost: z.string(),
      imapPort: z.number(),
      imapSecure: z.boolean(),
      smtpHost: z.string(),
      smtpPort: z.number(),
      smtpSecure: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      console.log('[IMAP Test] Validation passed for:', input.email);

      // Note: Actual IMAP connection testing happens in the separate IMAP service (apps/imap-service)
      // This endpoint just validates the input format
      return {
        success: true,
        message: 'Settings validated. Connection will be tested by the IMAP service.',
      };
    }),

  createImap: privateProcedure
    .input(z.object({
      email: z.string().email(),
      password: z.string(),
      imapHost: z.string(),
      imapPort: z.number(),
      imapSecure: z.boolean(),
      smtpHost: z.string(),
      smtpPort: z.number(),
      smtpSecure: z.boolean(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { email, password, imapHost, imapPort, imapSecure, smtpHost, smtpPort, smtpSecure } = input;
      const { sessionUser, c } = ctx;

      console.log('[IMAP Create] Saving connection for:', email);

      // Save credentials to database using direct Postgres connection
      // The separate IMAP service (apps/imap-service) will handle actual connections
      const { db } = createDb(c.env.HYPERDRIVE.connectionString);
      const newConnectionId = crypto.randomUUID();

      const [newConnection] = await db
        .insert(connection)
        .values({
          id: newConnectionId,
          userId: sessionUser.id,
          email,
          providerId: 'imap',
          scope: 'mail',
          name: email,
          config: {
            imap: {
              host: imapHost,
              port: imapPort,
              secure: imapSecure,
            },
            smtp: {
              host: smtpHost,
              port: smtpPort,
              secure: smtpSecure,
            },
            auth: {
              user: email,
              pass: password,
            },
          },
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null, // IMAP passwords don't expire like OAuth tokens
        })
        .returning();

      console.log('[IMAP Create] Connection saved to database:', newConnectionId);

      return {
        id: newConnection.id,
        email: newConnection.email,
        success: true,
        message: 'IMAP connection saved. The IMAP service will sync your emails.',
      };
    }),
});
