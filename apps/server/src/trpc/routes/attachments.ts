import { privateProcedure, router } from '../trpc';
import { z } from 'zod';
import { email, connection } from '../../db/schema';
import { eq, sql, and, isNotNull } from 'drizzle-orm';
import { env } from '../../env';

interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
  r2Key?: string | null;
}

interface AttachmentWithEmail {
  id: string;
  filename: string;
  mimeType: string; // Changed from contentType to match frontend
  size: number;
  contentId: string | null;
  r2Key: string | null;
  threadId: string; // Changed from emailId to match frontend
  subject: string | null;
  from: { name?: string; address: string };
  date: Date; // Changed from internalDate to match frontend
}

function categorizeAttachment(contentType: string): 'images' | 'documents' | 'spreadsheets' | 'other' {
  if (contentType.startsWith('image/')) return 'images';
  if (
    contentType.includes('pdf') ||
    contentType.includes('word') ||
    contentType.includes('document') ||
    contentType.includes('text/')
  )
    return 'documents';
  if (contentType.includes('spreadsheet') || contentType.includes('excel') || contentType.includes('csv'))
    return 'spreadsheets';
  return 'other';
}

export const attachmentsRouter = router({
  getAllAttachments: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
        fileType: z.enum(['all', 'images', 'documents', 'spreadsheets', 'other']).default('all'),
        limit: z.number().default(100),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { connectionId, fileType, limit } = input;

      // Query emails that have attachments (non-null and non-empty array)
      const emails = await ctx.db
        .select({
          id: email.id,
          subject: email.subject,
          from: email.from,
          internalDate: email.internalDate,
          attachments: email.attachments,
        })
        .from(email)
        .where(
          and(
            eq(email.connectionId, connectionId),
            isNotNull(email.attachments),
            sql`jsonb_array_length(${email.attachments}) > 0`,
          ),
        )
        .orderBy(sql`${email.internalDate} DESC`)
        .limit(limit * 2); // Fetch more since we'll filter by fileType

      // Flatten attachments from all emails
      const allAttachments: AttachmentWithEmail[] = [];
      for (const e of emails) {
        const attachments = (e.attachments as Attachment[]) || [];
        for (const att of attachments) {
          const category = categorizeAttachment(att.contentType);

          // Filter by fileType if specified
          if (fileType !== 'all' && category !== fileType) continue;

          allAttachments.push({
            id: att.id,
            filename: att.filename,
            mimeType: att.contentType, // Map contentType to mimeType
            size: att.size,
            contentId: att.contentId,
            r2Key: att.r2Key || null,
            threadId: e.id, // Map emailId to threadId for frontend
            subject: e.subject,
            from: e.from as { name?: string; address: string },
            date: e.internalDate, // Map internalDate to date for frontend
          });
        }
      }

      // Return limited results
      return allAttachments.slice(0, limit);
    }),

  getAttachmentStats: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { connectionId } = input;

      // Query all emails with attachments (non-null and non-empty array)
      const emails = await ctx.db
        .select({
          attachments: email.attachments,
        })
        .from(email)
        .where(
          and(
            eq(email.connectionId, connectionId),
            isNotNull(email.attachments),
            sql`jsonb_array_length(${email.attachments}) > 0`,
          ),
        );

      const stats = {
        total: 0,
        images: 0,
        documents: 0,
        spreadsheets: 0,
        other: 0,
        totalSize: 0,
      };

      for (const e of emails) {
        const attachments = (e.attachments as Attachment[]) || [];
        for (const att of attachments) {
          stats.total++;
          stats.totalSize += att.size || 0;

          const category = categorizeAttachment(att.contentType);
          stats[category]++;
        }
      }

      return stats;
    }),

  getAttachmentContent: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
        attachmentId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { connectionId, attachmentId } = input;
      const { sessionUser } = ctx;

      // Verify the user owns this connection
      const [foundConnection] = await ctx.db
        .select()
        .from(connection)
        .where(and(eq(connection.id, connectionId), eq(connection.userId, sessionUser.id)))
        .limit(1);

      if (!foundConnection) {
        throw new Error('Connection not found');
      }

      // Find the email containing this attachment
      const emails = await ctx.db
        .select({
          attachments: email.attachments,
        })
        .from(email)
        .where(
          and(
            eq(email.connectionId, connectionId),
            isNotNull(email.attachments),
            sql`${email.attachments}::jsonb @> ${JSON.stringify([{ id: attachmentId }])}::jsonb`,
          ),
        )
        .limit(1);

      if (!emails.length) {
        throw new Error('Attachment not found');
      }

      const attachments = (emails[0].attachments as Attachment[]) || [];
      const attachment = attachments.find((a) => a.id === attachmentId);

      if (!attachment) {
        throw new Error('Attachment not found');
      }

      if (!attachment.r2Key) {
        throw new Error('Attachment content not available - missing r2Key');
      }

      // Fetch content from R2
      const bucket = env.THREADS_BUCKET;
      const object = await bucket.get(attachment.r2Key);

      if (!object) {
        throw new Error('Attachment content not found in storage');
      }

      const arrayBuffer = await object.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');

      return {
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
        content: base64, // Base64 encoded content
      };
    }),
});
