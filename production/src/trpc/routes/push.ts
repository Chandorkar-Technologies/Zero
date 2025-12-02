import { privateProcedure, publicProcedure, router } from '../trpc';
import { pushSubscription } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../env';

export const pushRouter = router({
  // Get VAPID public key for client-side subscription
  getVapidPublicKey: publicProcedure.query(() => {
    return {
      publicKey: env.VAPID_PUBLIC_KEY || null,
    };
  }),

  // Subscribe to push notifications
  subscribe: privateProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
        p256dh: z.string(),
        auth: z.string(),
        userAgent: z.string().optional(),
        deviceName: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser, db } = ctx;

      // Check if subscription already exists for this endpoint
      const existing = await db
        .select()
        .from(pushSubscription)
        .where(
          and(
            eq(pushSubscription.userId, sessionUser.id),
            eq(pushSubscription.endpoint, input.endpoint),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        // Update existing subscription
        await db
          .update(pushSubscription)
          .set({
            p256dh: input.p256dh,
            auth: input.auth,
            userAgent: input.userAgent,
            deviceName: input.deviceName,
            lastUsedAt: new Date(),
          })
          .where(eq(pushSubscription.id, existing[0].id));

        return { success: true, subscriptionId: existing[0].id };
      }

      // Create new subscription
      const subscriptionId = crypto.randomUUID();
      await db.insert(pushSubscription).values({
        id: subscriptionId,
        userId: sessionUser.id,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
        deviceName: input.deviceName,
      });

      return { success: true, subscriptionId };
    }),

  // Unsubscribe from push notifications
  unsubscribe: privateProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser, db } = ctx;

      await db
        .delete(pushSubscription)
        .where(
          and(
            eq(pushSubscription.userId, sessionUser.id),
            eq(pushSubscription.endpoint, input.endpoint),
          ),
        );

      return { success: true };
    }),

  // Get all subscriptions for the current user
  getSubscriptions: privateProcedure.query(async ({ ctx }) => {
    const { sessionUser, db } = ctx;

    const subscriptions = await db
      .select({
        id: pushSubscription.id,
        endpoint: pushSubscription.endpoint,
        deviceName: pushSubscription.deviceName,
        userAgent: pushSubscription.userAgent,
        notifyNewEmails: pushSubscription.notifyNewEmails,
        notifyMentions: pushSubscription.notifyMentions,
        notifyImportant: pushSubscription.notifyImportant,
        createdAt: pushSubscription.createdAt,
        lastUsedAt: pushSubscription.lastUsedAt,
      })
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, sessionUser.id));

    return subscriptions;
  }),

  // Update notification preferences for a subscription
  updatePreferences: privateProcedure
    .input(
      z.object({
        subscriptionId: z.string(),
        notifyNewEmails: z.boolean().optional(),
        notifyMentions: z.boolean().optional(),
        notifyImportant: z.boolean().optional(),
        deviceName: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser, db } = ctx;
      const { subscriptionId, ...updates } = input;

      // Verify subscription belongs to user
      const [subscription] = await db
        .select()
        .from(pushSubscription)
        .where(
          and(
            eq(pushSubscription.id, subscriptionId),
            eq(pushSubscription.userId, sessionUser.id),
          ),
        )
        .limit(1);

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      // Build update object with only provided values
      const updateData: Record<string, unknown> = {};
      if (updates.notifyNewEmails !== undefined) {
        updateData.notifyNewEmails = updates.notifyNewEmails;
      }
      if (updates.notifyMentions !== undefined) {
        updateData.notifyMentions = updates.notifyMentions;
      }
      if (updates.notifyImportant !== undefined) {
        updateData.notifyImportant = updates.notifyImportant;
      }
      if (updates.deviceName !== undefined) {
        updateData.deviceName = updates.deviceName;
      }

      if (Object.keys(updateData).length > 0) {
        await db
          .update(pushSubscription)
          .set(updateData)
          .where(eq(pushSubscription.id, subscriptionId));
      }

      return { success: true };
    }),

  // Delete a specific subscription
  deleteSubscription: privateProcedure
    .input(
      z.object({
        subscriptionId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { sessionUser, db } = ctx;

      await db
        .delete(pushSubscription)
        .where(
          and(
            eq(pushSubscription.id, input.subscriptionId),
            eq(pushSubscription.userId, sessionUser.id),
          ),
        );

      return { success: true };
    }),
});
