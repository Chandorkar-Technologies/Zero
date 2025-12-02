import type { MailManager, ManagerConfig, IGetThreadResponse, IGetThreadsResponse } from './types';
import type { IOutgoingMessage, ParsedMessage, Label } from '../../types';
import type { ParsedDraft } from './types';
import type { CreateDraftData } from '../schemas';
import { env } from '../../env';
import { createDb } from '../../db';
import { email } from '../../db/schema';
import { eq, and, desc, like } from 'drizzle-orm';

export class ImapMailManager implements MailManager {
    private db: ReturnType<typeof createDb>['db'];
    private conn: ReturnType<typeof createDb>['conn'];

    constructor(public config: ManagerConfig, private bucket?: R2Bucket) {
        if (!this.bucket && env.THREADS_BUCKET) {
            this.bucket = env.THREADS_BUCKET;
        }
        const { db, conn } = createDb(env.HYPERDRIVE.connectionString);
        this.db = db;
        this.conn = conn;
    }

    private getBucket(): R2Bucket {
        if (!this.bucket) {
            if (env.THREADS_BUCKET) return env.THREADS_BUCKET;
            throw new Error('R2 Bucket not provided for ImapMailManager');
        }
        return this.bucket;
    }

    public getScope(): string {
        return 'imap';
    }

    public async list(params: {
        folder: string;
        query?: string;
        maxResults?: number;
        labelIds?: string[];
        pageToken?: string;
    }): Promise<IGetThreadsResponse> {
        const { folder, maxResults = 50, pageToken, query } = params;
        const connectionId = (this.config as any).connectionId;

        if (!connectionId) {
            throw new Error('Connection ID not found in config');
        }

        console.log(`[ImapMailManager] Listing threads for ${connectionId}, folder: ${folder}`);

        // IMAP drafts are not stored in the database - return empty list
        if (folder === 'draft') {
            console.log(`[ImapMailManager] Draft folder requested - IMAP drafts not supported, returning empty`);
            return { threads: [], nextPageToken: null };
        }

        // Query Postgres for emails
        // Group by threadId to simulate threads

        const conditions = [eq(email.connectionId, connectionId)];

        if (query) {
            conditions.push(like(email.subject, `%${query}%`));
        }

        // Pagination using offset/limit or cursor?
        // pageToken can be offset for simplicity
        const offset = pageToken ? parseInt(pageToken, 10) : 0;

        // Fetch emails with folder filtering done after retrieval
        // Labels are stored in jsonb, so we filter in memory
        let allEmails = await this.db.query.email.findMany({
            where: and(...conditions),
            orderBy: [desc(email.internalDate)],
            // Fetch more to account for filtering
            limit: maxResults * 3,
            offset: offset,
        });

        // Map folder to expected labels
        const folderToLabel: Record<string, string> = {
            'inbox': 'INBOX',
            'sent': 'SENT',
            'spam': 'SPAM',
            'bin': 'TRASH',
            'archive': 'ARCHIVE',
            'snoozed': 'SNOOZED',
        };

        const expectedLabel = folderToLabel[folder];

        // Filter emails by folder label
        if (expectedLabel) {
            console.log(`[ImapMailManager] Filtering by label: ${expectedLabel}`);
            allEmails = allEmails.filter(e => {
                const labels = (e.labels as string[]) || [];
                return labels.includes(expectedLabel);
            });
        }

        // Take only maxResults after filtering
        const emails = allEmails.slice(0, maxResults);

        const threads: { id: string; historyId: string | null; $raw?: unknown }[] = emails.map(e => ({
            id: e.threadId,
            historyId: null,
            $raw: e
        }));

        // Deduplicate by threadId if multiple emails per thread
        const uniqueThreads = Array.from(new Map(threads.map(t => [t.id, t])).values());

        return {
            threads: uniqueThreads,
            nextPageToken: emails.length === maxResults ? String(offset + maxResults) : null,
        };
    }

    public async get(id: string): Promise<IGetThreadResponse> {
        const connectionId = (this.config as any).connectionId;
        console.log('[IMAP Driver get] connectionId:', connectionId, 'threadId:', id);

        // Fetch all emails for this thread from Postgres
        const emails = await this.db.query.email.findMany({
            where: and(
                eq(email.connectionId, connectionId),
                eq(email.threadId, id)
            ),
            orderBy: [desc(email.internalDate)],
        });

        console.log(`[IMAP Driver get] Found ${emails.length} emails for thread ${id}`);
        if (emails.length > 0) {
            console.log(`[IMAP Driver get] First email isRead=${emails[0]?.isRead}, isStarred=${emails[0]?.isStarred}`);
        }

        if (emails.length === 0) {
            return {
                messages: [],
                hasUnread: false,
                totalReplies: 0,
                labels: [],
            };
        }

        const bucket = this.getBucket();
        const messages: ParsedMessage[] = [];

        for (const e of emails) {
            let body = '';

            // For local development, use bodyHtml from database
            if (e.bodyHtml) {
                console.log(`[IMAP Driver] Using bodyHtml from database for email ${e.id}`);
                body = e.bodyHtml;
            }
            // Fall back to R2 if no bodyHtml (production mode)
            else if (e.bodyR2Key) {
                try {
                    console.log(`[IMAP Driver] Fetching from R2: ${e.bodyR2Key}`);
                    let obj = await bucket.get(e.bodyR2Key);

                    // Fallback: Try without connection ID prefix if not found
                    if (!obj && e.bodyR2Key.includes('/')) {
                        const fallbackKey = e.bodyR2Key.split('/')[1];
                        console.log(`[IMAP Driver] Trying fallback key: ${fallbackKey}`);
                        obj = await bucket.get(fallbackKey);
                    }

                    if (obj) {
                        const jsonText = await obj.text();
                        console.log(`[IMAP Driver] Got JSON, length: ${jsonText.length}`);
                        const emailData = JSON.parse(jsonText);
                        // Extract body from payload.body in the stored JSON structure
                        body = emailData?.payload?.body || '';
                        console.log(`[IMAP Driver] Extracted body from R2, length: ${body.length}`);
                    } else {
                        console.log(`[IMAP Driver] R2 object not found for key: ${e.bodyR2Key}`);
                    }
                } catch (err) {
                    console.error(`[IMAP Driver] Failed to fetch body from R2 for key ${e.bodyR2Key}`, err);
                }
            } else {
                console.log(`[IMAP Driver] No bodyHtml or bodyR2Key for email ${e.id}`);
            }

            const from = e.from as { name?: string; address: string };
            const to = (e.to as { name?: string; address: string }[]) || [];
            const cc = (e.cc as { name?: string; address: string }[]) || [];
            const bcc = (e.bcc as { name?: string; address: string }[]) || [];
            const replyTo = e.replyTo as { name?: string; address: string } | undefined;

            messages.push({
                id: e.id,
                threadId: e.threadId,
                title: e.subject || '',
                subject: e.subject || '',
                receivedOn: e.internalDate.toISOString(),
                unread: !e.isRead,
                tags: [],
                sender: { name: from.name || '', email: from.address },
                to: to.map(t => ({ name: t.name || '', email: t.address })),
                cc: cc.map(t => ({ name: t.name || '', email: t.address })),
                bcc: bcc.map(t => ({ name: t.name || '', email: t.address })),
                replyTo: replyTo ? replyTo.address : undefined,
                messageId: e.messageId,
                references: e.references || undefined,
                inReplyTo: e.inReplyTo || undefined,
                body: body,
                processedHtml: body,
                decodedBody: body,
                blobUrl: '',
                attachments: [], // TODO: Implement attachments
                tls: false,
                isDraft: false,
            });
        }

        // Sort messages by date (oldest first usually for thread view?)
        // Actually getThread usually returns chronological order
        messages.sort((a, b) => new Date(a.receivedOn).getTime() - new Date(b.receivedOn).getTime());

        const latest = messages[messages.length - 1];

        return {
            messages,
            latest,
            hasUnread: messages.some(m => m.unread),
            totalReplies: messages.length,
            labels: [], // TODO: Map labels
            connectionId,
        };
    }

    // Stubs for other methods
    public async getMessageAttachments(_id: string) { return []; }
    public async create(data: IOutgoingMessage): Promise<{ id: string }> {
        const imapConfig = this.config.imapConfig;

        // Check if we have SMTP configuration
        if (!imapConfig?.smtp || !imapConfig?.auth) {
            throw new Error('SMTP configuration not found for this IMAP connection. Please reconfigure your email account with SMTP settings.');
        }

        const { auth } = imapConfig;
        const fromEmail = data.fromEmail || this.config.auth.email || auth.user;

// Get SMTP service configuration from environment
        const smtpServiceUrl = env.SMTP_SERVICE_URL;
        const smtpServiceApiKey = env.SMTP_SERVICE_API_KEY;
        const { smtp } = imapConfig;

        if (!smtpServiceUrl || !smtpServiceApiKey) {
            throw new Error('SMTP service not configured. Please set SMTP_SERVICE_URL and SMTP_SERVICE_API_KEY environment variables.');
        }

        console.log(`[IMAP Driver] Sending email via SMTP service to ${smtpServiceUrl}`);
        console.log(`[IMAP Driver] SMTP config: ${smtp.host}:${smtp.port} (secure: ${smtp.secure})`);

        try {
            // Prepare attachments as base64
            const attachments = data.attachments.map(att => ({
                filename: att.name,
                content: att.base64, // Already base64 encoded
                contentType: att.type || 'application/octet-stream',
            }));

            // Call the SMTP service HTTP endpoint
            const response = await fetch(`${smtpServiceUrl}/send`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${smtpServiceApiKey}`,
                },
                body: JSON.stringify({
                    smtp: {
                        host: smtp.host,
                        port: smtp.port,
                        secure: smtp.secure,
                        auth: {
                            user: auth.user,
                            pass: auth.pass,
                        },
                    },
                    email: {
                        from: fromEmail,
                        to: data.to.map(t => t.email),
                        cc: data.cc?.map(t => t.email),
                        bcc: data.bcc?.map(t => t.email),
                        subject: data.subject,
                        html: data.message,
                        inReplyTo: data.originalMessage,
                        references: data.headers?.References,
                        attachments: attachments.length > 0 ? attachments : undefined,
                    },
                    apiKey: smtpServiceApiKey, // Also in body for additional validation
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Unknown error' })) as { message?: string };
                throw new Error(`SMTP service error: ${errorData.message || response.statusText}`);
            }

            const result = await response.json() as { success: boolean; messageId?: string; error?: string };

            if (!result.success) {
                throw new Error(result.error || 'Failed to send email');
            }

            const messageId = result.messageId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@nubo.email`;
            console.log(`[IMAP Driver] Email sent via SMTP service: ${messageId}`);
            return { id: messageId };
        } catch (error) {
            console.error('[IMAP Driver] Failed to send email via SMTP service:', error);
            throw new Error(`Failed to send email via SMTP: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public async sendDraft(_id: string, data: IOutgoingMessage): Promise<void> {
        await this.create(data);
    }

    public async createDraft(_data: CreateDraftData): Promise<{ id?: string; success?: boolean; error?: string }> {
        // IMAP doesn't support server-side drafts in the same way as Gmail
        // Drafts would need to be stored in the database or a special IMAP folder
        return { id: 'not-implemented', success: false, error: 'IMAP drafts are not yet supported. Please use Gmail or Outlook for draft functionality.' };
    }

    public async getDraft(_id: string): Promise<ParsedDraft> {
        // IMAP drafts are not yet implemented
        // Return an empty draft structure instead of throwing
        return {
            id: _id,
            to: [],
            subject: '',
            content: '',
            cc: [],
            bcc: [],
        };
    }

    public async listDrafts(_params: { q?: string; maxResults?: number; pageToken?: string }): Promise<{ threads: { id: string; historyId: string | null; $raw: unknown }[]; nextPageToken: string | null }> {
        // IMAP drafts are not yet implemented - return empty list
        return { threads: [], nextPageToken: null };
    }

    public async delete(id: string): Promise<void> {
        const connectionId = this.config.connectionId;
        if (!connectionId) {
            throw new Error('Connection ID not found in config');
        }

        console.log(`[IMAP Driver] Deleting thread ${id} for connection ${connectionId}`);

        // Delete all emails in this thread from the database
        await this.db
            .delete(email)
            .where(and(
                eq(email.connectionId, connectionId),
                eq(email.threadId, id)
            ));

        console.log(`[IMAP Driver] Thread ${id} deleted successfully`);
    }

    public async deleteDraft(_id: string): Promise<void> {
        // IMAP drafts are not implemented, but don't throw - just log
        console.log(`[IMAP Driver] deleteDraft called for ${_id} - not implemented`);
    }

    public async count(): Promise<{ label: string; count: number }[]> {
        const connectionId = this.config.connectionId;
        if (!connectionId) return [];

        // Count unread emails for inbox
        const unreadEmails = await this.db.query.email.findMany({
            where: and(
                eq(email.connectionId, connectionId),
                eq(email.isRead, false)
            ),
        });

        return [{ label: 'inbox', count: unreadEmails.length }];
    }

    public async getTokens(_code: string): Promise<{ tokens: any }> { return { tokens: {} }; }

    public async getUserInfo(): Promise<{ address: string; name: string; photo: string }> {
        return {
            address: this.config.auth.email,
            name: this.config.auth.email.split('@')[0],
            photo: '',
        };
    }

    public async listHistory(historyId: string): Promise<{ history: any[]; historyId: string }> { return { history: [], historyId }; }

    public async markAsRead(threadIds: string[]) {
        const connectionId = this.config.connectionId;
        if (!connectionId) {
            throw new Error('Connection ID not found in config');
        }

        console.log(`[IMAP Driver] Marking threads as read: ${threadIds.join(', ')}`);

        // Update all emails in these threads to isRead = true
        for (const threadId of threadIds) {
            await this.db
                .update(email)
                .set({ isRead: true, updatedAt: new Date() })
                .where(and(
                    eq(email.connectionId, connectionId),
                    eq(email.threadId, threadId)
                ));
        }

        console.log(`[IMAP Driver] Threads marked as read successfully`);
    }

    public async markAsUnread(threadIds: string[]) {
        const connectionId = this.config.connectionId;
        if (!connectionId) {
            throw new Error('Connection ID not found in config');
        }

        console.log(`[IMAP Driver] Marking threads as unread: ${threadIds.join(', ')}`);

        // Update all emails in these threads to isRead = false
        for (const threadId of threadIds) {
            await this.db
                .update(email)
                .set({ isRead: false, updatedAt: new Date() })
                .where(and(
                    eq(email.connectionId, connectionId),
                    eq(email.threadId, threadId)
                ));
        }

        console.log(`[IMAP Driver] Threads marked as unread successfully`);
    }

    public normalizeIds(ids: string[]) { return { threadIds: ids }; }

    public async modifyLabels(threadIds: string[], options: { addLabels: string[]; removeLabels: string[] }) {
        const connectionId = this.config.connectionId;
        if (!connectionId) {
            throw new Error('Connection ID not found in config');
        }

        console.log(`[IMAP Driver] Modifying labels for threads: ${threadIds.join(', ')}`);

        // Handle TRASH label - delete the thread
        if (options.addLabels.includes('TRASH')) {
            for (const threadId of threadIds) {
                await this.delete(threadId);
            }
            return;
        }

        // Handle UNREAD label
        if (options.addLabels.includes('UNREAD')) {
            await this.markAsUnread(threadIds);
        }
        if (options.removeLabels.includes('UNREAD')) {
            await this.markAsRead(threadIds);
        }

        // For other labels, update the labels field in the database
        for (const threadId of threadIds) {
            const emails = await this.db.query.email.findMany({
                where: and(
                    eq(email.connectionId, connectionId),
                    eq(email.threadId, threadId)
                ),
            });

            for (const e of emails) {
                let currentLabels = (e.labels as string[]) || [];

                // Add new labels
                for (const label of options.addLabels) {
                    if (!currentLabels.includes(label)) {
                        currentLabels.push(label);
                    }
                }

                // Remove labels
                currentLabels = currentLabels.filter(l => !options.removeLabels.includes(l));

                await this.db
                    .update(email)
                    .set({ labels: currentLabels, updatedAt: new Date() })
                    .where(eq(email.id, e.id));
            }
        }
    }

    public async getAttachment(_messageId: string, _attachmentId: string) { return undefined; }
    public async getUserLabels(): Promise<Label[]> { return []; }
    public async getLabel(_id: string): Promise<Label> { throw new Error('Not implemented'); }
    public async createLabel(_label: any) { }
    public async updateLabel(_id: string, _label: any) { }
    public async deleteLabel(_id: string) { }
    public async getEmailAliases() { return []; }
    public async revokeToken(_token: string) { return true; }
    public async deleteAllSpam() { return { success: true, message: 'Not implemented', count: 0 }; }
    public async getRawEmail(_id: string) { return ''; }
}
