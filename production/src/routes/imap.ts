import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { ImapFlow } from 'imapflow';
import { connection } from '../db/schema';
import { createDb } from '../db';
import type { HonoContext } from '../ctx';
import { verifyToken } from '../lib/server-utils';

const imapRouter = new Hono<HonoContext>();

const createImapConnectionSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().positive(),
    secure: z.boolean().default(true),
    name: z.string().optional(),
});

imapRouter.post(
    '/',
    verifyToken,
    zValidator('json', createImapConnectionSchema),
    async (c) => {
        const { email, password, host, port, secure, name } = c.req.valid('json');
        const userId = c.get('userId');

        if (!userId) {
            return c.json({ error: 'Unauthorized' }, 401);
        }

        // Validate IMAP credentials by attempting to connect
        const client = new ImapFlow({
            host,
            port,
            secure,
            auth: {
                user: email,
                pass: password,
            },
            logger: false,
        });

        try {
            await client.connect();
            await client.logout();
        } catch (error) {
            return c.json(
                {
                    error: 'Failed to connect to IMAP server',
                    details: error instanceof Error ? error.message : String(error),
                },
                400,
            );
        }

        const { db } = createDb(c.env.HYPERDRIVE.connectionString);

        // Save connection to DB
        const [newConnection] = await db
            .insert(connection)
            .values({
                id: crypto.randomUUID(),
                userId,
                email,
                providerId: 'imap',
                scope: 'mail', // Default scope for IMAP
                name: name || email,
                config: {
                    host,
                    port,
                    secure,
                    auth: {
                        user: email,
                        pass: password,
                    },
                },
                createdAt: new Date(),
                updatedAt: new Date(),
                expiresAt: null, // IMAP passwords don't typically expire like OAuth tokens
            })
            .returning();

        return c.json(newConnection);
    },
);

export { imapRouter };
