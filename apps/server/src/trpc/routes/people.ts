import { privateProcedure, router } from '../trpc';
import { getZeroAgent, getZeroDB } from '../../lib/server-utils';
import { getContext } from 'hono/context-storage';
import type { HonoContext } from '../../ctx';
import { z } from 'zod';

interface ContactInfo {
  email: string;
  name?: string;
  domain: string;
  threadCount: number;
  messageCount: number;
  lastContactDate: Date;
  firstContactDate: Date;
}

export const peopleRouter = router({
  getAllContacts: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
        minMessages: z.number().default(1),
        sortBy: z.enum(['recent', 'frequent', 'name']).default('recent'),
      })
    )
    .query(async ({ input, ctx }) => {
      const { connectionId, minMessages, sortBy } = input;
      const { sessionUser } = ctx;

      const db = await getZeroDB(sessionUser.id);
      const executionCtx = getContext<HonoContext>().executionCtx;

      // Get connection
      const connection = await db.findUserConnection(connectionId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      const userEmail = connection.email.toLowerCase();

      // Get agent to access database
      const { stub: agent } = await getZeroAgent(connectionId, executionCtx);

      // Query threads from database
      const threads = await agent.db.query.thread.findMany({
        where: (thread: any, { eq }: any) => eq(thread.providerId, connectionId),
        orderBy: (thread: any, { desc }: any) => desc(thread.latestReceivedOn),
        limit: 1000,
      });

      const contactMap = new Map<string, ContactInfo>();

      // Process threads to extract contacts
      for (const thread of threads) {
        if (!thread.latestSender?.email) continue;

        const email = thread.latestSender.email.toLowerCase();

        // Skip user's own email
        if (email === userEmail) continue;

        const domain = email.split('@')[1] || '';
        const msgDate = new Date(thread.latestReceivedOn || Date.now());

        const existingContact = contactMap.get(email);
        if (existingContact) {
          existingContact.threadCount++;
          existingContact.messageCount++;
          if (msgDate > existingContact.lastContactDate) {
            existingContact.lastContactDate = msgDate;
          }
          if (msgDate < existingContact.firstContactDate) {
            existingContact.firstContactDate = msgDate;
          }
        } else {
          contactMap.set(email, {
            email,
            name: thread.latestSender.name || undefined,
            domain,
            threadCount: 1,
            messageCount: 1,
            lastContactDate: msgDate,
            firstContactDate: msgDate,
          });
        }
      }

      // Convert to array and filter
      let contacts = Array.from(contactMap.values()).filter(
        (contact) => contact.messageCount >= minMessages
      );

      // Sort
      if (sortBy === 'recent') {
        contacts.sort((a, b) => b.lastContactDate.getTime() - a.lastContactDate.getTime());
      } else if (sortBy === 'frequent') {
        contacts.sort((a, b) => b.messageCount - a.messageCount);
      } else if (sortBy === 'name') {
        contacts.sort((a, b) => {
          const nameA = a.name || a.email;
          const nameB = b.name || b.email;
          return nameA.localeCompare(nameB);
        });
      }

      return contacts;
    }),

  getContactThreads: privateProcedure
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

      // Search for threads involving this contact
      const threadsResponse = await agent.rawListThreads({
        folder: 'inbox',
        query: email.toLowerCase(),
        maxResults: limit,
        labelIds: [],
        pageToken: '',
      });

      return threadsResponse.threads.map((thread: any) => ({
        threadId: thread.id,
        subject: thread.$raw?.messages?.[0]?.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || 'No Subject',
        snippet: thread.$raw?.snippet || '',
        date: thread.$raw?.messages?.[0]?.internalDate || Date.now(),
        messageCount: thread.$raw?.messages?.length || 1,
      })).sort((a: any, b: any) => Number(b.date) - Number(a.date));
    }),
});
