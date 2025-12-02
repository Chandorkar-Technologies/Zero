/**
 * Web Push implementation for Cloudflare Workers
 * Uses @block65/webcrypto-web-push library for proper encryption
 */

import { buildPushPayload, type PushSubscription as WebPushSubscription } from '@block65/webcrypto-web-push';
import { env } from '../env';

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string; icon?: string }>;
}

/**
 * Send a push notification
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  console.log('[WebPush] sendPushNotification called');

  try {
    const vapidPublicKey = env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = env.VAPID_PRIVATE_KEY;

    console.log('[WebPush] VAPID public key present:', !!vapidPublicKey, 'length:', vapidPublicKey?.length);
    console.log('[WebPush] VAPID private key present:', !!vapidPrivateKey, 'length:', vapidPrivateKey?.length);

    if (!vapidPublicKey) {
      console.log('[WebPush] VAPID_PUBLIC_KEY not configured');
      return { success: false, error: 'VAPID_PUBLIC_KEY not configured' };
    }

    if (!vapidPrivateKey) {
      console.log('[WebPush] VAPID_PRIVATE_KEY not configured');
      return { success: false, error: 'VAPID_PRIVATE_KEY not configured' };
    }

    console.log('[WebPush] Subscription endpoint:', subscription.endpoint);
    console.log('[WebPush] Subscription p256dh length:', subscription.keys.p256dh?.length);
    console.log('[WebPush] Subscription auth length:', subscription.keys.auth?.length);

    // Convert subscription to the format expected by the library
    const webPushSubscription: WebPushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    };

    console.log('[WebPush] Building push payload...');

    // Build the push payload using the library
    const { headers, body } = await buildPushPayload(
      {
        data: JSON.stringify(payload),
        options: {
          ttl: 86400, // 24 hours
          urgency: 'normal',
        },
      },
      webPushSubscription,
      {
        subject: 'mailto:noreply@nubo.email',
        publicKey: vapidPublicKey,
        privateKey: vapidPrivateKey,
      }
    );

    // Use the endpoint from the subscription we passed in
    const endpoint = subscription.endpoint;
    console.log('[WebPush] Payload built, sending to:', endpoint);

    // Send the request
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
    });

    console.log('[WebPush] Response status:', response.status);

    if (response.status === 201 || response.status === 200) {
      console.log('[WebPush] Success!');
      return { success: true, statusCode: response.status };
    }

    // Handle common error cases
    if (response.status === 404 || response.status === 410) {
      // Subscription expired or invalid - should be deleted
      console.log('[WebPush] Subscription expired');
      return { success: false, statusCode: response.status, error: 'subscription_expired' };
    }

    const errorText = await response.text();
    console.log('[WebPush] Error response:', errorText);
    return { success: false, statusCode: response.status, error: errorText };
  } catch (error) {
    console.error('[WebPush] Error sending notification:', error);
    console.error('[WebPush] Error stack:', error instanceof Error ? error.stack : 'No stack');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Send push notifications to all of a user's subscriptions
 */
export async function sendPushToUser(
  subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload
): Promise<{ sent: number; failed: number; expired: string[] }> {
  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      sendPushNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
    )
  );

  let sent = 0;
  let failed = 0;
  const expired: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value.success) {
        sent++;
      } else {
        failed++;
        if (result.value.error === 'subscription_expired') {
          expired.push(subscriptions[index].endpoint);
        }
      }
    } else {
      failed++;
    }
  });

  return { sent, failed, expired };
}
