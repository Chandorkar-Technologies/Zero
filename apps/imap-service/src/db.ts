import pg from 'pg';
// We might need to define schema locally or import if possible.
// For this MVP, we'll use raw SQL or simple query builder usage.

export interface ImapSyncState {
    connectionId: string;
    lastSyncedUid: number;
    uidValidity: number;
    lastSyncedAt: Date;
}

export class DB {
    private pool: pg.Pool;

    constructor(connectionString: string) {
        this.pool = new pg.Pool({
            connectionString,
        });
        // Ensure required columns/tables exist
        this.ensureSchema();
    }

    private async ensureSchema() {
        const client = await this.pool.connect();
        try {
            // Add bodyHtml column if it doesn't exist (for local development)
            await client.query(`
                ALTER TABLE "mail0_email"
                ADD COLUMN IF NOT EXISTS "body_html" text;
            `);
            console.log('[DB] Ensured body_html column exists');

            // Add attachments column if it doesn't exist
            await client.query(`
                ALTER TABLE "mail0_email"
                ADD COLUMN IF NOT EXISTS "attachments" jsonb;
            `);
            console.log('[DB] Ensured attachments column exists');

            // Create IMAP sync state table if it doesn't exist
            await client.query(`
                CREATE TABLE IF NOT EXISTS "mail0_imap_sync_state" (
                    "connection_id" text PRIMARY KEY,
                    "last_synced_uid" integer NOT NULL DEFAULT 0,
                    "uid_validity" integer NOT NULL DEFAULT 0,
                    "last_synced_at" timestamp NOT NULL DEFAULT NOW()
                );
            `);
            console.log('[DB] Ensured imap_sync_state table exists');
        } catch (err) {
            console.error('[DB] Failed to ensure schema', err);
        } finally {
            client.release();
        }
    }

    async getImapConnections() {
        const client = await this.pool.connect();
        try {
            const res = await client.query(`
                SELECT * FROM "mail0_connection"
                WHERE "provider_id" = 'imap'
            `);
            return res.rows;
        } finally {
            client.release();
        }
    }

    async getSyncState(connectionId: string): Promise<ImapSyncState | null> {
        const client = await this.pool.connect();
        try {
            const res = await client.query(
                `SELECT * FROM "mail0_imap_sync_state" WHERE "connection_id" = $1`,
                [connectionId]
            );
            if (res.rows.length === 0) {
                return null;
            }
            const row = res.rows[0];
            return {
                connectionId: row.connection_id,
                lastSyncedUid: row.last_synced_uid,
                uidValidity: row.uid_validity,
                lastSyncedAt: row.last_synced_at,
            };
        } finally {
            client.release();
        }
    }

    async updateSyncState(connectionId: string, lastSyncedUid: number, uidValidity: number): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query(`
                INSERT INTO "mail0_imap_sync_state" ("connection_id", "last_synced_uid", "uid_validity", "last_synced_at")
                VALUES ($1, $2, $3, NOW())
                ON CONFLICT ("connection_id") DO UPDATE SET
                    "last_synced_uid" = EXCLUDED."last_synced_uid",
                    "uid_validity" = EXCLUDED."uid_validity",
                    "last_synced_at" = NOW()
            `, [connectionId, lastSyncedUid, uidValidity]);
        } finally {
            client.release();
        }
    }

    async resetSyncState(connectionId: string): Promise<void> {
        const client = await this.pool.connect();
        try {
            // Delete all emails for this connection and reset sync state
            await client.query(`DELETE FROM "mail0_email" WHERE "connection_id" = $1`, [connectionId]);
            await client.query(`DELETE FROM "mail0_imap_sync_state" WHERE "connection_id" = $1`, [connectionId]);
            console.log(`[DB] Reset sync state for connection ${connectionId}`);
        } finally {
            client.release();
        }
    }

    async getConnectionById(connectionId: string) {
        const client = await this.pool.connect();
        try {
            const res = await client.query(
                `SELECT * FROM "mail0_connection" WHERE "id" = $1`,
                [connectionId]
            );
            return res.rows[0] || null;
        } finally {
            client.release();
        }
    }

    async saveEmailMetadata(email: any) {
        const client = await this.pool.connect();
        try {
            // Upsert email metadata
            // Using ON CONFLICT to avoid duplicates if we process the same email twice
            await client.query(`
                INSERT INTO "mail0_email" (
                    "id", "thread_id", "connection_id", "message_id",
                    "in_reply_to", "references", "subject", "from", "to",
                    "cc", "bcc", "reply_to", "snippet", "body_r2_key", "body_html",
                    "internal_date", "is_read", "is_starred", "labels", "attachments",
                    "created_at", "updated_at"
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8, $9,
                    $10, $11, $12, $13, $14, $15,
                    $16, $17, $18, $19, $20,
                    NOW(), NOW()
                )
                ON CONFLICT ("id") DO UPDATE SET
                    "is_read" = EXCLUDED."is_read",
                    "is_starred" = EXCLUDED."is_starred",
                    "labels" = EXCLUDED."labels",
                    "body_html" = EXCLUDED."body_html",
                    "attachments" = EXCLUDED."attachments",
                    "updated_at" = NOW()
            `, [
                email.id, email.threadId, email.connectionId, email.messageId,
                email.inReplyTo, email.references, email.subject, JSON.stringify(email.from), JSON.stringify(email.to),
                JSON.stringify(email.cc), JSON.stringify(email.bcc), JSON.stringify(email.replyTo), email.snippet, email.bodyR2Key, email.bodyHtml,
                new Date(email.internalDate), email.isRead, email.isStarred, JSON.stringify(email.labels), JSON.stringify(email.attachments || [])
            ]);
        } finally {
            client.release();
        }
    }
}
