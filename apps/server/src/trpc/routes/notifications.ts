import { privateProcedure, router } from '../trpc';
import { getZeroAgent } from '../../lib/server-utils';
import { z } from 'zod';
import { getContext } from 'hono/context-storage';
import type { HonoContext } from '../../ctx';
import { email, connection } from '../../db/schema';
import { eq, desc, and } from 'drizzle-orm';

interface Notification {
  id: string;
  threadId: string;
  messageId: string;
  type: 'mention' | 'important' | 'action_item';
  title: string;
  snippet: string;
  from: any;
  date: Date;
  read: boolean;
  connectionId: string;
}

// Keywords for detecting notification types
const importantKeywords = ['urgent', 'asap', 'important', 'critical', 'deadline', 'priority'];
const actionKeywords = ['please', 'could you', 'can you', 'action required', 'review', 'approve'];

// Helper to process emails into notifications
function processEmailsToNotifications(
  emails: any[],
  connectionId: string,
  types: Array<'mention' | 'important' | 'action_item'> | undefined,
  limit: number,
): Notification[] {
  const notifications: Notification[] = [];
  const processedEmails = new Set<string>();

  for (const e of emails) {
    if (processedEmails.has(e.id)) continue;
    processedEmails.add(e.id);

    const subject = (e.subject || '').toLowerCase();
    const snippet = e.snippet || '';

    const notificationTypes: Array<'mention' | 'important' | 'action_item'> = [];

    // Check for important keywords
    if (!types || types.includes('important')) {
      if (importantKeywords.some((keyword) => subject.includes(keyword))) {
        notificationTypes.push('important');
      }
    }

    // Check for action items
    if (!types || types.includes('action_item')) {
      if (actionKeywords.some((keyword) => subject.includes(keyword))) {
        notificationTypes.push('action_item');
      }
    }

    // Create notifications
    for (const type of notificationTypes) {
      notifications.push({
        id: `${e.id}-${type}`,
        threadId: e.threadId || e.id,
        messageId: e.messageId || e.id,
        type,
        title: e.subject || '(No subject)',
        snippet,
        from: e.from || { name: 'Unknown', address: '' },
        date: new Date(e.internalDate || Date.now()),
        read: e.isRead || false,
        connectionId,
      });
    }

    if (notifications.length >= limit) {
      break;
    }
  }

  return notifications.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);
}

// Helper to count notifications from emails
function countNotifications(emails: any[]): {
  mentions: number;
  important: number;
  actionItems: number;
} {
  let mentionCount = 0;
  let importantCount = 0;
  let actionItemCount = 0;

  const processedEmails = new Set<string>();

  for (const e of emails) {
    if (processedEmails.has(e.id)) continue;
    processedEmails.add(e.id);

    const subject = (e.subject || '').toLowerCase();

    // Count important
    if (importantKeywords.some((keyword) => subject.includes(keyword))) {
      importantCount++;
    }

    // Count action items
    if (actionKeywords.some((keyword) => subject.includes(keyword))) {
      actionItemCount++;
    }
  }

  return {
    mentions: mentionCount,
    important: importantCount,
    actionItems: actionItemCount,
  };
}

export const notificationsRouter = router({
  getNotifications: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
        types: z.array(z.enum(['mention', 'important', 'action_item'])).optional(),
        limit: z.number().default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { connectionId, types, limit } = input;
      const { sessionUser } = ctx;

      // Query connection directly from PostgreSQL database
      const [foundConnection] = await ctx.db
        .select()
        .from(connection)
        .where(and(eq(connection.id, connectionId), eq(connection.userId, sessionUser.id)))
        .limit(1);

      if (!foundConnection) {
        throw new Error('Connection not found');
      }

      // Check if this is an IMAP connection - query from local database
      if (foundConnection.providerId === 'imap') {
        // Query emails from local PostgreSQL database
        const emails = await ctx.db
          .select({
            id: email.id,
            threadId: email.threadId,
            messageId: email.messageId,
            subject: email.subject,
            snippet: email.snippet,
            from: email.from,
            internalDate: email.internalDate,
            isRead: email.isRead,
          })
          .from(email)
          .where(eq(email.connectionId, connectionId))
          .orderBy(desc(email.internalDate))
          .limit(200);

        return processEmailsToNotifications(emails, connectionId, types, limit);
      }

      // For Google/Outlook connections, use the Durable Object agent
      const executionCtx = getContext<HonoContext>().executionCtx;
      const { stub: agent } = await getZeroAgent(connectionId, executionCtx);

      // Call the exposed RPC method on the Durable Object stub
      const threads = await agent.getThreadsForPeople({ limit: 200 });

      const notifications: Notification[] = [];
      const processedThreads = new Set<string>();

      // Process threads to find notifications
      for (const thread of threads) {
        if (processedThreads.has(thread.id)) continue;
        processedThreads.add(thread.id);

        const subject = (thread.subject || '').toLowerCase();
        const snippet = thread.snippet || '';

        const notificationTypes: Array<'mention' | 'important' | 'action_item'> = [];

        // Check for important keywords
        if (!types || types.includes('important')) {
          if (importantKeywords.some((keyword) => subject.includes(keyword))) {
            notificationTypes.push('important');
          }
        }

        // Check for action items
        if (!types || types.includes('action_item')) {
          if (actionKeywords.some((keyword) => subject.includes(keyword))) {
            notificationTypes.push('action_item');
          }
        }

        // Create notifications
        for (const type of notificationTypes) {
          notifications.push({
            id: `${thread.id}-${type}`,
            threadId: thread.id,
            messageId: thread.latestId || thread.id,
            type,
            title: thread.subject || '(No subject)',
            snippet,
            from: {
              name: thread.latestSender?.name,
              address: thread.latestSender?.email || '',
            },
            date: new Date(thread.latestReceivedOn || Date.now()),
            read: false,
            connectionId,
          });
        }

        if (notifications.length >= limit) {
          break;
        }
      }

      return notifications.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, limit);
    }),

  getNotificationCounts: privateProcedure
    .input(
      z.object({
        connectionId: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { connectionId } = input;
      const { sessionUser } = ctx;

      // Query connection directly from PostgreSQL database
      const [foundConnection] = await ctx.db
        .select()
        .from(connection)
        .where(and(eq(connection.id, connectionId), eq(connection.userId, sessionUser.id)))
        .limit(1);

      if (!foundConnection) {
        throw new Error('Connection not found');
      }

      // Check if this is an IMAP connection - query from local database
      if (foundConnection.providerId === 'imap') {
        // Query emails from local PostgreSQL database
        const emails = await ctx.db
          .select({
            id: email.id,
            subject: email.subject,
          })
          .from(email)
          .where(eq(email.connectionId, connectionId))
          .orderBy(desc(email.internalDate))
          .limit(200);

        const counts = countNotifications(emails);
        return {
          mentions: counts.mentions,
          important: counts.important,
          actionItems: counts.actionItems,
          total: counts.mentions + counts.important + counts.actionItems,
        };
      }

      // For Google/Outlook connections, use the Durable Object agent
      let mentionCount = 0;
      let importantCount = 0;
      let actionItemCount = 0;

      const executionCtx = getContext<HonoContext>().executionCtx;
      const { stub: agent } = await getZeroAgent(connectionId, executionCtx);

      // Call the exposed RPC method on the Durable Object stub
      const threads = await agent.getThreadsForPeople({ limit: 200 });

      const processedThreads = new Set<string>();

      for (const thread of threads) {
        if (processedThreads.has(thread.id)) continue;
        processedThreads.add(thread.id);

        const subject = (thread.subject || '').toLowerCase();

        // Count important
        if (importantKeywords.some((keyword) => subject.includes(keyword))) {
          importantCount++;
        }

        // Count action items
        if (actionKeywords.some((keyword) => subject.includes(keyword))) {
          actionItemCount++;
        }
      }

      return {
        mentions: mentionCount,
        important: importantCount,
        actionItems: actionItemCount,
        total: mentionCount + importantCount + actionItemCount,
      };
    }),
});
