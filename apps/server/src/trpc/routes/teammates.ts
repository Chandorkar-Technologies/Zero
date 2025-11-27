import { privateProcedure, router } from '../trpc';
import { getZeroAgent } from '../../lib/server-utils';
import { z } from 'zod';
import { getContext } from 'hono/context-storage';
import type { HonoContext } from '../../ctx';
import { connection, email as emailSchema } from '../../db/schema';
import { eq as eqOp, and as andOp, desc as descOp } from 'drizzle-orm';

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

// Helper function to process emails into teammates
function processEmailsToTeammates(
  emails: Array<{ id: string; threadId: string; from: any; internalDate: Date }>,
  userEmail: string,
  userDomain: string,
  minThreads: number
): TeammateContact[] {
  const contactMap = new Map<string, TeammateContact>();
  const threadMap = new Map<string, Set<string>>(); // threadId -> Set of unique emails

  // Process emails to extract teammates
  for (const email of emails) {
    const from = email.from as { name?: string; address?: string; email?: string };
    const fromAddress = from?.address || from?.email;
    if (!fromAddress) continue;

    const emailAddress = fromAddress.toLowerCase();

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

  return Array.from(contactMap.values())
    .filter((contact) => contact.isTeammate)
    .sort((a, b) => b.score - a.score);
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
        const { sessionUser } = ctx;

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

        // Check if this is an IMAP connection - query from local database
        if (foundConnection.providerId === 'imap') {
          console.log('[getPeople] IMAP connection - querying from PostgreSQL...');

          const emails = await ctx.db
            .select({
              id: emailSchema.id,
              threadId: emailSchema.threadId,
              from: emailSchema.from,
              internalDate: emailSchema.internalDate,
            })
            .from(emailSchema)
            .where(eqOp(emailSchema.connectionId, connectionId))
            .orderBy(descOp(emailSchema.internalDate))
            .limit(1000);

          console.log('[getPeople] Found IMAP emails:', emails.length);

          const processedEmails = emails.map(e => ({
            id: e.id,
            threadId: e.threadId,
            from: e.from,
            internalDate: e.internalDate,
          }));

          return processEmailsToTeammates(processedEmails, userEmail, userDomain, minThreads);
        }

        // For Google/Outlook connections, use the Durable Object agent
        console.log('[getPeople] OAuth connection - querying from Durable Object...');
        const executionCtx = getContext<HonoContext>().executionCtx;
        const { stub: agent } = await getZeroAgent(connectionId, executionCtx);

        // Query threads from agent's database
        const threads = await agent.db.query.threads.findMany({
          where: (thread: any, { eq: eqFn }: any) => eqFn(thread.providerId, connectionId),
          orderBy: (thread: any, { desc: descFn }: any) => descFn(thread.latestReceivedOn),
          limit: 500,
        });

        console.log('[getPeople] Found threads from agent:', threads.length);

        // Convert threads to email-like format for processing
        const emailsFromThreads = threads.map((thread: any) => ({
          id: thread.id,
          threadId: thread.id,
          from: {
            name: thread.latestSender?.name,
            email: thread.latestSender?.email,
            address: thread.latestSender?.email,
          },
          internalDate: new Date(thread.latestReceivedOn || Date.now()),
        }));

        return processEmailsToTeammates(emailsFromThreads, userEmail, userDomain, minThreads);
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
      const { connectionId, email: targetEmailInput, limit } = input;
      const { sessionUser } = ctx;

      console.log('[getPersonThreads] Querying for email:', targetEmailInput);

      // Query connection directly from PostgreSQL database
      const [foundConnection] = await ctx.db
        .select()
        .from(connection)
        .where(andOp(eqOp(connection.id, connectionId), eqOp(connection.userId, sessionUser.id)))
        .limit(1);

      if (!foundConnection) {
        console.log('[getPersonThreads] Connection not found:', connectionId);
        throw new Error('Connection not found');
      }

      const targetEmail = targetEmailInput.toLowerCase();

      // Check if this is an IMAP connection - query from local database
      if (foundConnection.providerId === 'imap') {
        console.log('[getPersonThreads] IMAP connection - querying from PostgreSQL...');

        const allEmails = await ctx.db
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
          .where(eqOp(emailSchema.connectionId, connectionId))
          .orderBy(descOp(emailSchema.internalDate))
          .limit(500);

        console.log('[getPersonThreads] Queried emails:', allEmails.length);

        // Filter emails where the person is in from, to, or cc
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

        for (const emailItem of emails) {
          if (!threadMap.has(emailItem.threadId)) {
            threadMap.set(emailItem.threadId, {
              subject: emailItem.subject || '(No subject)',
              snippet: emailItem.snippet || '',
              date: emailItem.internalDate,
              messageCount: 1,
            });
          } else {
            const thread = threadMap.get(emailItem.threadId)!;
            thread.messageCount++;
            if (emailItem.internalDate > thread.date) {
              thread.date = emailItem.internalDate;
            }
          }
        }

        return Array.from(threadMap.entries())
          .map(([threadId, data]) => ({ threadId, ...data }))
          .sort((a, b) => b.date.getTime() - a.date.getTime())
          .slice(0, limit);
      }

      // For Google/Outlook connections, use the Durable Object agent
      console.log('[getPersonThreads] OAuth connection - querying from Durable Object...');
      const executionCtx = getContext<HonoContext>().executionCtx;
      const { stub: agent } = await getZeroAgent(connectionId, executionCtx);

      // Query threads from agent's database
      const threads = await agent.db.query.threads.findMany({
        where: (thread: any, { eq: eqFn }: any) => eqFn(thread.providerId, connectionId),
        orderBy: (thread: any, { desc: descFn }: any) => descFn(thread.latestReceivedOn),
        limit: 500,
      });

      console.log('[getPersonThreads] Found threads from agent:', threads.length);

      // Filter threads by sender email
      const filteredThreads = threads.filter((thread: any) => {
        const senderEmail = thread.latestSender?.email?.toLowerCase();
        return senderEmail === targetEmail;
      });

      console.log('[getPersonThreads] Filtered to:', filteredThreads.length);

      // Map to output format
      return filteredThreads
        .map((thread: any) => ({
          threadId: thread.id,
          subject: thread.subject || '(No subject)',
          snippet: thread.snippet || '',
          date: new Date(thread.latestReceivedOn || Date.now()),
          messageCount: thread.messageCount || 1,
        }))
        .slice(0, limit);
    }),
});
