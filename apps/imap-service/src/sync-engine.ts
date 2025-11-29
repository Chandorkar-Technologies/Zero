import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { DB } from './db.js';
import { Store } from './store.js';
import type { Logger } from 'pino';

export class SyncEngine {
    constructor(
        private db: DB,
        private store: Store,
        private logger: Logger
    ) { }

    async run() {
        this.logger.info('SyncEngine running...');
        const connections = await this.db.getImapConnections();
        this.logger.info(`Found ${connections.length} IMAP connections`);

        for (const conn of connections) {
            await this.syncConnection(conn);
        }
    }

    private async syncConnection(conn: any) {
        this.logger.info(`Syncing connection ${conn.id} (${conn.email})`);

        const config = conn.config;
        if (!config) {
            this.logger.warn(`Skipping connection ${conn.id} - no config`);
            return;
        }

        const client = new ImapFlow({
            host: config.imap.host,
            port: config.imap.port,
            secure: config.imap.secure,
            auth: {
                user: config.auth.user,
                pass: config.auth.pass,
            },
            logger: false, // Disable internal logger to avoid noise
        });

        try {
            await client.connect();
            this.logger.info('Connected to IMAP server');

            const lock = await client.getMailboxLock('INBOX');
            try {
                // Get current mailbox status
                const mailboxStatus = client.mailbox;
                if (!mailboxStatus) {
                    this.logger.error(`Failed to get mailbox status for connection ${conn.id}`);
                    lock.release();
                    await client.logout();
                    return;
                }
                const currentUidValidity = Number(mailboxStatus.uidValidity ?? 0);

                // Get saved sync state
                const syncState = await this.db.getSyncState(conn.id);
                let startUid = 1;

                // Check if uidValidity changed (mailbox was recreated)
                if (syncState) {
                    if (syncState.uidValidity !== currentUidValidity) {
                        // UIDVALIDITY changed - mailbox was recreated, need full resync
                        this.logger.warn(`UIDVALIDITY changed for ${conn.id} (was ${syncState.uidValidity}, now ${currentUidValidity}). Performing full resync.`);
                        await this.db.resetSyncState(conn.id);
                        startUid = 1;
                    } else {
                        // Resume from last synced UID + 1
                        startUid = syncState.lastSyncedUid + 1;
                        this.logger.info(`Resuming sync from UID ${startUid} for connection ${conn.id}`);
                    }
                } else {
                    this.logger.info(`First sync for connection ${conn.id}, starting from UID 1`);
                }

                // Fetch only new messages (from startUid to the latest)
                const fetchRange = `${startUid}:*`;
                let maxSyncedUid = syncState?.lastSyncedUid ?? 0;
                let syncedCount = 0;

                this.logger.info(`Fetching messages in range ${fetchRange}`);

                for await (const message of client.fetch(fetchRange, { envelope: true, source: true, uid: true })) {
                    // Skip messages we've already synced (can happen if startUid is greater than any existing UID)
                    if (message.uid <= (syncState?.lastSyncedUid ?? 0)) {
                        continue;
                    }

                    if (!message.source) {
                        continue;
                    }

                    const parsed: ParsedMail = await simpleParser(message.source);

                    if (!message.envelope?.date) {
                        continue;
                    }

                    const threadId = message.uid.toString(); // Simple thread ID for now
                    const messageId = message.envelope.messageId || `${threadId}@${config.imap.host}`;

                    // 1. Save body to R2
                    const emailBodyData = {
                        id: message.uid.toString(),
                        threadId: threadId,
                        snippet: parsed.text?.substring(0, 100),
                        payload: {
                            headers: (Array.from(parsed.headers || new Map()) as [string, any][]).map(([key, value]) => ({
                                name: key,
                                value,
                            })),
                            body: parsed.html || parsed.textAsHtml || parsed.text,
                        },
                    };

                    const bodyR2Key = await this.store.saveEmail(conn.id, threadId, emailBodyData);

                    // Extract and save attachments
                    const attachments = [];
                    for (let idx = 0; idx < (parsed.attachments || []).length; idx++) {
                        const att = parsed.attachments![idx];
                        const attachmentId = `${conn.id}-${message.uid}-att-${idx}`;
                        const filename = att.filename || `attachment-${idx}`;
                        const contentType = att.contentType || 'application/octet-stream';

                        // Save attachment content to R2
                        let r2Key: string | null = null;
                        if (att.content) {
                            try {
                                r2Key = await this.store.saveAttachment(
                                    conn.id,
                                    `${conn.id}-${message.uid}`,
                                    attachmentId,
                                    att.content,
                                    contentType
                                );
                                this.logger.info(`Saved attachment ${attachmentId} to R2: ${r2Key}`);
                            } catch (error) {
                                this.logger.error(error, `Failed to save attachment ${attachmentId} to R2`);
                            }
                        }

                        attachments.push({
                            id: attachmentId,
                            filename,
                            contentType,
                            size: att.size || 0,
                            contentId: att.contentId || null,
                            r2Key,
                        });
                    }

                    // 2. Save metadata to Postgres
                    // Use a deterministic ID based on connectionId and UID to prevent duplicates
                    const emailMetadata = {
                        id: `${conn.id}-${message.uid}`,
                        threadId: threadId,
                        connectionId: conn.id,
                        messageId: messageId,
                        inReplyTo: message.envelope.inReplyTo,
                        references: null, // TODO: Parse References header from parsed.headers
                        subject: message.envelope.subject,
                        from: message.envelope.from?.[0] || { name: 'Unknown', address: 'unknown' },
                        to: message.envelope.to || [],
                        cc: message.envelope.cc || [],
                        bcc: message.envelope.bcc || [],
                        replyTo: message.envelope.replyTo || [],
                        snippet: parsed.text?.substring(0, 100),
                        bodyR2Key: bodyR2Key,
                        bodyHtml: parsed.html || parsed.textAsHtml || parsed.text, // Store body in DB for local dev
                        internalDate: message.envelope.date.getTime(),
                        isRead: message.flags?.has('\\Seen') ?? false,
                        isStarred: message.flags?.has('\\Flagged') ?? false,
                        labels: ['INBOX'], // Default label
                        attachments: attachments,
                    };

                    await this.db.saveEmailMetadata(emailMetadata);

                    // Track the highest UID we've synced
                    if (message.uid > maxSyncedUid) {
                        maxSyncedUid = message.uid;
                    }
                    syncedCount++;

                    this.logger.info(`Saved email UID ${message.uid}`);
                }

                // Update sync state with the highest UID we processed
                if (maxSyncedUid > 0) {
                    try {
                        await this.db.updateSyncState(conn.id, maxSyncedUid, currentUidValidity);
                        this.logger.info(`Updated sync state: lastSyncedUid=${maxSyncedUid}, uidValidity=${currentUidValidity}`);
                    } catch (syncStateError) {
                        this.logger.error(syncStateError, 'Failed to update sync state');
                    }
                } else if (syncState === null && currentUidValidity > 0) {
                    // First run but no emails were synced - still save the uidValidity so we don't do a full resync next time
                    try {
                        await this.db.updateSyncState(conn.id, 0, currentUidValidity);
                        this.logger.info(`Initialized sync state with uidValidity=${currentUidValidity}`);
                    } catch (syncStateError) {
                        this.logger.error(syncStateError, 'Failed to initialize sync state');
                    }
                }

                if (syncedCount === 0) {
                    this.logger.info(`No new messages to sync for connection ${conn.id}`);
                } else {
                    this.logger.info(`Synced ${syncedCount} new messages for connection ${conn.id}`);
                }
            } finally {
                lock.release();
            }

            await client.logout();
        } catch (error) {
            this.logger.error(error, `Failed to sync connection ${conn.id}`);
        }
    }
}
