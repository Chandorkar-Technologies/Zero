import { privateProcedure, router } from '../trpc';
import { z } from 'zod';
import { connection } from '../../db/schema';
import { eq as eqOp, and as andOp } from 'drizzle-orm';

interface TeammateContact {
  email: string;
  name?: string;
  domain: string;
  threadCount: number;
  messageCount: number;
  lastContactDate: Date;
  isTeammate: boolean;
  score: number;
}

export const peopleRouter = router({
  getPeople: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
        minThreads: z.number().default(3),
      })
    )
    .query(async ({ input, ctx }) => {
      try {
        const { connectionId, minThreads } = input;
        const { sessionUser, c } = ctx;

        console.log('[getPeople] Called with connectionId:', connectionId, 'minThreads:', minThreads);

        // Query connection directly from PostgreSQL database
        const [foundConnection] = await ctx.db
          .select()
          .from(connection)
          .where(andOp(eqOp(connection.id, connectionId), eqOp(connection.userId, sessionUser.id)))
          .limit(1);

        if (!foundConnection) {
          console.log('[getPeople] Connection not found:', connectionId);
          throw new Error('Connection not found');
        }

        const userEmail = foundConnection.email.toLowerCase();
        const userDomain = userEmail.split('@')[1] || '';

        // Import schemas and query helpers for email queries
        const { email: emailSchema } = await import('../../db/schema');
        const { eq, desc: descFn, sql } = await import('drizzle-orm');

        console.log('[getPeople] Querying emails from database...');
        console.log('[getPeople] Looking for connectionId:', connectionId);

        // First check total emails in database
        const totalCount = await c.var.db
          .select({ count: sql<number>`count(*)` })
          .from(emailSchema);
        console.log('[getPeople] Total emails in database:', totalCount[0]?.count);

        // Check emails for all connections
        const allConnectionEmails = await c.var.db
          .select({
            connectionId: emailSchema.connectionId,
            count: sql<number>`count(*)`
          })
          .from(emailSchema)
          .groupBy(emailSchema.connectionId);
        console.log('[getPeople] Emails per connection:', allConnectionEmails);

        const emails = await c.var.db
          .select({
            id: emailSchema.id,
            threadId: emailSchema.threadId,
            from: emailSchema.from,
            internalDate: emailSchema.internalDate,
            subject: emailSchema.subject,
          })
          .from(emailSchema)
          .where(eq(emailSchema.connectionId, connectionId))
          .orderBy(descFn(emailSchema.internalDate))
          .limit(1000)
          .then(results => results.map(e => ({
            id: e.id,
            threadId: e.threadId,
            from: JSON.parse(JSON.stringify(e.from)),
            internalDate: e.internalDate,
            subject: e.subject,
          })));

        console.log('[getPeople] Found emails for this connection:', emails.length);

        const contactMap = new Map<string, TeammateContact>();
        const threadMap = new Map<string, Set<string>>(); // threadId -> Set of unique emails

        // Process emails to extract teammates
        for (const email of emails) {
          const from = email.from as { name?: string; address: string };
          if (!from?.address) continue;

          const emailAddress = from.address.toLowerCase();

          // Skip user's own email
          if (emailAddress === userEmail) continue;

          const domain = emailAddress.split('@')[1] || '';
          const messageDate = email.internalDate;

          // Track unique threads
          if (!threadMap.has(email.threadId)) {
            threadMap.set(email.threadId, new Set());
          }
          threadMap.get(email.threadId)!.add(emailAddress);

          const existingContact = contactMap.get(emailAddress);
          if (existingContact) {
            existingContact.messageCount++;
            if (messageDate > existingContact.lastContactDate) {
              existingContact.lastContactDate = messageDate;
            }
          } else {
            contactMap.set(emailAddress, {
              email: emailAddress,
              name: from.name || undefined,
              domain,
              threadCount: 0, // Will calculate after
              messageCount: 1,
              lastContactDate: messageDate,
              isTeammate: false,
              score: 0,
            });
          }
        }

        // Calculate thread counts
        for (const [_threadId, emailsInThread] of threadMap.entries()) {
          for (const emailAddress of emailsInThread) {
            const contact = contactMap.get(emailAddress);
            if (contact) {
              contact.threadCount++;
            }
          }
        }

        // Calculate scores
        const publicDomains = new Set(['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'icloud.com']);

        for (const [_email, contact] of contactMap.entries()) {
          let score = 0;

          // Same domain = 50 points
          if (contact.domain === userDomain && !publicDomains.has(userDomain)) {
            score += 50;
          }

          // Thread count (up to 30 points)
          score += Math.min(contact.threadCount * 2, 30);

          // Message count (up to 15 points)
          score += Math.min(contact.messageCount, 15);

          // Recency (up to 5 points)
          const daysSinceLastContact = Math.floor(
            (Date.now() - contact.lastContactDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysSinceLastContact <= 30) {
            score += 5;
          } else if (daysSinceLastContact <= 90) {
            score += 2;
          }

          contact.score = score;
          contact.isTeammate = score >= 40 || (contact.threadCount >= minThreads && score >= 20);
        }

        const teammates = Array.from(contactMap.values())
          .filter((contact) => contact.isTeammate)
          .sort((a, b) => b.score - a.score);

        console.log('[getPeople] Total contacts found:', contactMap.size);
        console.log('[getPeople] Teammates after filtering:', teammates.length);

        return teammates;
      } catch (error) {
        console.error('[getPeople] Error:', error);
        throw error;
      }
    }),

  getPersonThreads: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
        email: z.string(),
        limit: z.number().default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      const { connectionId, email, limit } = input;
      const { c } = ctx;

      console.log('[getPersonThreads] Querying for email:', email);

      // Use the database from context
      const { email: emailSchema } = await import('../../db/schema');
      const { eq, desc: descFn } = await import('drizzle-orm');

      const allEmails = await c.var.db
        .select({
          id: emailSchema.id,
          threadId: emailSchema.threadId,
          subject: emailSchema.subject,
          snippet: emailSchema.snippet,
          internalDate: emailSchema.internalDate,
          from: emailSchema.from,
          to: emailSchema.to,
          cc: emailSchema.cc,
        })
        .from(emailSchema)
        .where(eq(emailSchema.connectionId, connectionId))
        .orderBy(descFn(emailSchema.internalDate))
        .limit(500)
        .then(results => results.map(e => ({
          id: e.id,
          threadId: e.threadId,
          subject: e.subject,
          snippet: e.snippet,
          internalDate: e.internalDate,
          from: JSON.parse(JSON.stringify(e.from)),
          to: JSON.parse(JSON.stringify(e.to)),
          cc: JSON.parse(JSON.stringify(e.cc)),
        })));

      console.log('[getPersonThreads] Queried emails:', allEmails.length);

      // Filter emails where the person is in from, to, or cc
      const targetEmail = email.toLowerCase();
      const emails = allEmails.filter((e) => {
        const from = e.from as { name?: string; address: string } | null;
        const to = (e.to as { name?: string; address: string }[]) || [];
        const cc = (e.cc as { name?: string; address: string }[]) || [];

        return (
          from?.address?.toLowerCase() === targetEmail ||
          to.some((t) => t.address?.toLowerCase() === targetEmail) ||
          cc.some((c) => c.address?.toLowerCase() === targetEmail)
        );
      });

      console.log('[getPersonThreads] Filtered to:', emails.length);

      // Group by thread and get latest email for each thread
      const threadMap = new Map<string, { subject: string; snippet: string; date: Date; messageCount: number }>();

      for (const email of emails) {
        if (!threadMap.has(email.threadId)) {
          threadMap.set(email.threadId, {
            subject: email.subject || '(No subject)',
            snippet: email.snippet || '',
            date: email.internalDate,
            messageCount: 1,
          });
        } else {
          const thread = threadMap.get(email.threadId)!;
          thread.messageCount++;
          // Keep the latest date
          if (email.internalDate > thread.date) {
            thread.date = email.internalDate;
          }
        }
      }

      const threads = Array.from(threadMap.entries())
        .map(([threadId, data]) => ({
          threadId,
          ...data,
        }))
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, limit);

      console.log('[getPersonThreads] Returning threads:', threads.length);

      return threads;
    }),
});
