import { privateProcedure, router } from '../trpc';
import { getZeroAgent, getZeroDB } from '../../lib/server-utils';
import { getContext } from 'hono/context-storage';
import type { HonoContext } from '../../ctx';
import { z } from 'zod';

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
      const { connectionId, minThreads } = input;
      const { sessionUser } = ctx;

      const db = await getZeroDB(sessionUser.id);
      const executionCtx = getContext<HonoContext>().executionCtx;

      // Get connection info
      const connection = await db.findUserConnection(connectionId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      const userEmail = connection.email.toLowerCase();
      const userDomain = userEmail.split('@')[1] || '';

      // Get agent to access database
      const { stub: agent } = await getZeroAgent(connectionId, executionCtx);

      // Query threads from database
      const threads = await agent.db.query.thread.findMany({
        where: (thread: any, { eq }: any) => eq(thread.providerId, connectionId),
        orderBy: (thread: any, { desc }: any) => desc(thread.latestReceivedOn),
        limit: 500,
      });

      const contactMap = new Map<string, TeammateContact>();

      // Process threads to extract teammates
      for (const thread of threads) {
        if (!thread.latestSender?.email) continue;

        const email = thread.latestSender.email.toLowerCase();

        // Skip user's own email
        if (email === userEmail) continue;

        const domain = email.split('@')[1] || '';
        const receivedDate = new Date(thread.latestReceivedOn || Date.now());

        const existingContact = contactMap.get(email);
        if (existingContact) {
          existingContact.threadCount++;
          existingContact.messageCount++;
          if (receivedDate > existingContact.lastContactDate) {
            existingContact.lastContactDate = receivedDate;
          }
        } else {
          contactMap.set(email, {
            email,
            name: thread.latestSender.name || undefined,
            domain,
            threadCount: 1,
            messageCount: 1,
            lastContactDate: receivedDate,
            isTeammate: false,
            score: 0,
          });
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

      return teammates;
    }),

  getPersonThreads: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
        email: z.string(),
        limit: z.number().default(50),
      })
    )
    .query(async ({ input }) => {
      const { connectionId, email, limit } = input;

      const executionCtx = getContext<HonoContext>().executionCtx;
      const { stub: agent } = await getZeroAgent(connectionId, executionCtx);

      // Search for threads involving this contact using Gmail search
      const threadsResponse = await agent.rawListThreads({
        folder: 'inbox',
        query: email.toLowerCase(),
        maxResults: limit,
        labelIds: [],
        pageToken: '',
      });

      // Helper to strip HTML tags and decode entities
      const stripHtml = (html: string): string => {
        return html
          .replace(/<[^>]*>/g, '') // Remove HTML tags
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ') // Normalize whitespace
          .trim();
      };

      return threadsResponse.threads.map((thread: any) => {
        // Extract subject from headers
        const headers = thread.$raw?.messages?.[0]?.payload?.headers || [];
        const subjectHeader = headers.find((h: any) => h.name?.toLowerCase() === 'subject');
        const subject = subjectHeader?.value || '(No subject)';

        // Clean snippet
        const rawSnippet = thread.$raw?.snippet || '';
        const snippet = stripHtml(rawSnippet);

        return {
          threadId: thread.id,
          subject,
          snippet,
          date: thread.$raw?.messages?.[0]?.internalDate || Date.now(),
          messageCount: thread.$raw?.messages?.length || 1,
        };
      }).sort((a: any, b: any) => Number(b.date) - Number(a.date));
    }),
});
