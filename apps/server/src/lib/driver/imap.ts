import type { MailManager, ManagerConfig, IGetThreadResponse, IGetThreadsResponse } from './types';
import type { IOutgoingMessage, ParsedMessage, Label } from '../../types';
import type { ParsedDraft } from './types';
import type { CreateDraftData } from '../schemas';
import { env } from '../../env';
import { createDb } from '../../db';
import { email } from '../../db/schema';
import { eq, and, desc, like } from 'drizzle-orm';
import { Resend } from 'resend';

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
        const { maxResults = 50, pageToken, query } = params;
        const connectionId = (this.config as any).connectionId;

        if (!connectionId) {
            throw new Error('Connection ID not found in config');
        }

        console.log(`[ImapMailManager] Listing threads for ${connectionId}`);

        // Query Postgres for emails
        // Group by threadId to simulate threads
        // For now, just fetch emails and assume 1 email = 1 thread if we don't have thread grouping logic in DB yet
        // Actually email table has threadId.

        const conditions = [eq(email.connectionId, connectionId)];

        if (query) {
            conditions.push(like(email.subject, `%${query}%`));
        }

        // Pagination using offset/limit or cursor?
        // pageToken can be offset for simplicity
        const offset = pageToken ? parseInt(pageToken, 10) : 0;

        const emails = await this.db.query.email.findMany({
            where: and(...conditions),
            orderBy: [desc(email.internalDate)],
            limit: maxResults,
            offset: offset,
        });

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
        if (!env.RESEND_API_KEY) {
            throw new Error('RESEND_API_KEY not configured');
        }
        const resend = new Resend(env.RESEND_API_KEY);

        const attachments = data.attachments.map(att => ({
            filename: att.name,
            content: Buffer.from(att.base64, 'base64'),
        }));

        const fromEmail = data.fromEmail || this.config.auth.email || 'me@nubo.email';

        const { data: resData, error } = await resend.emails.send({
            from: fromEmail,
            to: data.to.map(t => t.email),
            cc: data.cc?.map(t => t.email),
            bcc: data.bcc?.map(t => t.email),
            subject: data.subject,
            html: data.message,
            attachments,
            headers: {
                ...data.headers,
                ...(data.originalMessage ? { 'In-Reply-To': data.originalMessage } : {}),
            }
        });

        if (error) {
            throw new Error(error.message);
        }

        return { id: resData?.id || 'unknown' };
    }

    public async sendDraft(_id: string, data: IOutgoingMessage): Promise<void> {
        await this.create(data);
    }
    public async createDraft(_data: CreateDraftData): Promise<{ id?: string; success?: boolean; error?: string }> { return { id: 'not-implemented', success: false, error: 'Not implemented' }; }
    public async getDraft(_id: string): Promise<ParsedDraft> { throw new Error('Not implemented'); }
    public async listDrafts(_params: { q?: string; maxResults?: number; pageToken?: string }): Promise<{ threads: { id: string; historyId: string | null; $raw: unknown }[]; nextPageToken: string | null }> { return { threads: [], nextPageToken: null }; }
    public async delete(_id: string): Promise<void> { }
    public async deleteDraft(_id: string): Promise<void> { }
    public async count(): Promise<{ label: string; count: number }[]> { return []; }
    public async getTokens(_code: string): Promise<{ tokens: any }> { return { tokens: {} }; }
    public async getUserInfo(): Promise<{ address: string; name: string; photo: string }> { return { address: '', name: '', photo: '' }; }
    public async listHistory(historyId: string): Promise<{ history: any[]; historyId: string }> { return { history: [], historyId }; }
    public async markAsRead(_threadIds: string[]) { }
    public async markAsUnread(_threadIds: string[]) { }
    public normalizeIds(ids: string[]) { return { threadIds: ids }; }
    public async modifyLabels(_id: string[], _options: any) { }
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
