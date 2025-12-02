import type { HonoContext } from '../ctx';
import { env } from '../env';
import { Hono } from 'hono';
import { usageTracking } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { getZeroDB } from '../lib/server-utils';

type RazorpayContext = {
  Variables: {
    customerData: {
      customerId: string;
      customerData: {
        name: string;
        email: string;
      };
    } | null;
  };
} & HonoContext;

// Plan IDs mapping - using actual Razorpay plan IDs
export const RAZORPAY_PLANS = {
  FREE: 'free',
  PRO_MONTHLY: 'plan_RgNh4LjI4yf8x7',
  PRO_ANNUAL: 'plan_RgNhIPe6xvU6xz',
} as const;

// Plan pricing in INR (paise - 1 INR = 100 paise)
export const PLAN_PRICING = {
  [RAZORPAY_PLANS.FREE]: 0,
  [RAZORPAY_PLANS.PRO_MONTHLY]: 39900, // ₹399
  [RAZORPAY_PLANS.PRO_ANNUAL]: 238800, // ₹2388 (₹199/month)
} as const;

// Feature limits
export const FEATURE_LIMITS = {
  [RAZORPAY_PLANS.FREE]: {
    connections: 1,
    chatMessages: 50,
    brainActivity: 0,
  },
  [RAZORPAY_PLANS.PRO_MONTHLY]: {
    connections: 999999,
    chatMessages: 999999,
    brainActivity: 999999,
  },
  [RAZORPAY_PLANS.PRO_ANNUAL]: {
    connections: 999999,
    chatMessages: 999999,
    brainActivity: 999999,
  },
} as const;

// Helper function to call Razorpay API
async function callRazorpayAPI(endpoint: string, method: string, body?: any) {
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

  console.log(`[RAZORPAY API] ${method} ${endpoint}`);
  if (body) {
    console.log('[RAZORPAY API] Request body:', JSON.stringify(body, null, 2));
  }

  const response = await fetch(`https://api.razorpay.com/v1${endpoint}`, {
    method,
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[RAZORPAY API ERROR] ${method} ${endpoint} - Status: ${response.status}`);
    console.error('[RAZORPAY API ERROR] Response:', errorText);
    throw new Error(`Razorpay API error: ${response.status} - ${errorText}`);
  }

  const responseData = await response.json();
  console.log(`[RAZORPAY API] ${method} ${endpoint} - Success`);
  return responseData;
}

// Helper function to verify webhook signature
function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const expectedSignature = crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret + body)
  ).then(hash => {
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  });

  return expectedSignature.then(expected => expected === signature);
}

export const razorpayApi = new Hono<RazorpayContext>()
  .use('*', async (c, next) => {
    const { sessionUser } = c.var;
    c.set(
      'customerData',
      !sessionUser
        ? null
        : {
            customerId: sessionUser.id,
            customerData: {
              name: sessionUser.name,
              email: sessionUser.email,
            },
          },
    );
    await next();
  })
  // Get customer subscription status
  .post('/check', async (c) => {
    const { customerData } = c.var;
    if (!customerData) return c.json({ error: 'No customer ID found' }, 401);

    try {
      const db = await getZeroDB(customerData.customerId);

      // Get user's subscription from database
      let userSubscription = await db.findSubscription();

      if (!userSubscription) {
        // Return free plan by default
        return c.json({
          planId: RAZORPAY_PLANS.FREE,
          status: 'active',
          features: FEATURE_LIMITS[RAZORPAY_PLANS.FREE],
          isPro: false,
        });
      }

      // Auto-sync if subscription is not active but has a Razorpay ID
      // This handles cases where payment succeeded but webhook wasn't received
      if (userSubscription.status !== 'active' && userSubscription.razorpaySubscriptionId) {
        console.log('[RAZORPAY CHECK] Auto-syncing subscription status:', userSubscription.razorpaySubscriptionId);

        try {
          // Fetch latest status from Razorpay
          const razorpaySubscription = await callRazorpayAPI(
            `/subscriptions/${userSubscription.razorpaySubscriptionId}`,
            'GET'
          );

          console.log('[RAZORPAY CHECK] Razorpay status:', razorpaySubscription.status);

          // Update database with latest status
          await db.updateSubscription({
            status: razorpaySubscription.status,
            currentPeriodStart: razorpaySubscription.current_start ? new Date(razorpaySubscription.current_start * 1000) : undefined,
            currentPeriodEnd: razorpaySubscription.current_end ? new Date(razorpaySubscription.current_end * 1000) : undefined,
            updatedAt: new Date(),
          });

          // Refetch updated subscription
          userSubscription = await db.findSubscription();
          console.log('[RAZORPAY CHECK] Subscription auto-synced successfully');
        } catch (syncError) {
          console.error('[RAZORPAY CHECK] Auto-sync failed:', syncError);
          // Continue with existing subscription data if sync fails
        }
      }

      // Check if subscription is active or completed (completed = total_count was set to 1, but payment succeeded)
      const isActive = userSubscription!.status === 'active' || userSubscription!.status === 'completed';
      const isPro =
        isActive &&
        (userSubscription!.planId === RAZORPAY_PLANS.PRO_MONTHLY ||
          userSubscription!.planId === RAZORPAY_PLANS.PRO_ANNUAL);

      return c.json({
        planId: userSubscription!.planId,
        status: userSubscription!.status,
        razorpaySubscriptionId: userSubscription!.razorpaySubscriptionId,
        currentPeriodStart: userSubscription!.currentPeriodStart,
        currentPeriodEnd: userSubscription!.currentPeriodEnd,
        features: FEATURE_LIMITS[userSubscription!.planId as keyof typeof FEATURE_LIMITS] || FEATURE_LIMITS[RAZORPAY_PLANS.FREE],
        isPro,
      });
    } catch (error) {
      console.error('[RAZORPAY] Error checking subscription:', error);
      console.error('[RAZORPAY] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        customerData: customerData?.customerId,
      });
      return c.json({
        error: 'Failed to check subscription',
        details: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  })
  // Create checkout session for subscription
  .post('/attach', async (c) => {
    const { customerData } = c.var;
    const body = await c.req.json<{
      planId: string;
      successUrl?: string;
      cancelUrl?: string;
    }>();

    if (!customerData) return c.json({ error: 'No customer ID found' }, 401);

    try {
      const db = await getZeroDB(customerData.customerId);
      const { planId } = body;

      // Validate plan
      if (!PLAN_PRICING[planId as keyof typeof PLAN_PRICING]) {
        return c.json({ error: 'Invalid plan ID' }, 400);
      }

      console.log('[RAZORPAY] Creating subscription with plan:', planId);

      // Create subscription on Razorpay via API
      // customer_notify: 0 prevents automatic email/SMS notifications
      // We'll use the checkout modal instead
      // total_count is required by Razorpay API - using maximum allowed value (1200 = 100 years for monthly)
      const razorpaySubscription = await callRazorpayAPI('/subscriptions', 'POST', {
        plan_id: planId,
        customer_notify: 0,
        quantity: 1,
        total_count: 1200, // Maximum allowed by Razorpay (100 years for monthly, ~33 years for annual)
        notes: {
          userId: customerData.customerId,
          email: customerData.customerData.email,
        },
      });

      console.log('[RAZORPAY] Subscription created:', razorpaySubscription.id, 'status:', razorpaySubscription.status);

      // Store subscription in database
      await db.insertSubscription({
        id: crypto.randomUUID(),
        userId: customerData.customerId,
        razorpaySubscriptionId: razorpaySubscription.id,
        planId,
        status: 'created',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      console.log('[RAZORPAY] Subscription stored in database');

      // Return subscription details for frontend to handle checkout
      return c.json({
        subscriptionId: razorpaySubscription.id,
        planId,
        status: razorpaySubscription.status,
        keyId: env.RAZORPAY_KEY_ID,
        customerEmail: customerData.customerData.email,
        customerName: customerData.customerData.name,
      });
    } catch (error) {
      console.error('[RAZORPAY] Error creating subscription:', error);
      console.error('[RAZORPAY] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        customerData: customerData?.customerId,
      });
      return c.json({
        error: 'Failed to create subscription',
        details: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  })
  // Sync subscription status from Razorpay (useful when webhooks aren't configured)
  .post('/sync', async (c) => {
    const { customerData } = c.var;
    if (!customerData) return c.json({ error: 'No customer ID found' }, 401);

    try {
      const db = await getZeroDB(customerData.customerId);

      // Get user's subscription from database
      const userSubscription = await db.findSubscription();

      if (!userSubscription || !userSubscription.razorpaySubscriptionId) {
        return c.json({ error: 'No subscription found' }, 404);
      }

      console.log('[RAZORPAY SYNC] Fetching subscription from Razorpay:', userSubscription.razorpaySubscriptionId);

      // Fetch latest status from Razorpay
      const razorpaySubscription = await callRazorpayAPI(
        `/subscriptions/${userSubscription.razorpaySubscriptionId}`,
        'GET'
      );

      console.log('[RAZORPAY SYNC] Razorpay status:', razorpaySubscription.status);

      // Update database with latest status
      await db.updateSubscription({
        status: razorpaySubscription.status,
        currentPeriodStart: razorpaySubscription.current_start ? new Date(razorpaySubscription.current_start * 1000) : undefined,
        currentPeriodEnd: razorpaySubscription.current_end ? new Date(razorpaySubscription.current_end * 1000) : undefined,
        updatedAt: new Date(),
      });

      console.log('[RAZORPAY SYNC] Subscription synced successfully');

      return c.json({
        success: true,
        status: razorpaySubscription.status,
        subscriptionId: razorpaySubscription.id,
      });
    } catch (error) {
      console.error('[RAZORPAY SYNC] Error syncing subscription:', error);
      return c.json({ error: 'Failed to sync subscription' }, 500);
    }
  })
  // Cancel subscription
  .post('/cancel', async (c) => {
    const { customerData } = c.var;
    if (!customerData) return c.json({ error: 'No customer ID found' }, 401);

    try {
      const db = await getZeroDB(customerData.customerId);

      // Get user's subscription from database
      const userSubscription = await db.findSubscription();

      if (!userSubscription || userSubscription.status !== 'active' || !userSubscription.razorpaySubscriptionId) {
        return c.json({ error: 'No active subscription found' }, 404);
      }

      // Cancel on Razorpay via API
      await callRazorpayAPI(
        `/subscriptions/${userSubscription.razorpaySubscriptionId}/cancel`,
        'POST',
        { cancel_at_cycle_end: 0 }
      );

      // Update database
      await db.updateSubscription({
        status: 'cancelled',
      });

      return c.json({ success: true, message: 'Subscription cancelled' });
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      return c.json({ error: 'Failed to cancel subscription' }, 500);
    }
  })
  // Admin endpoint to manually activate subscription
  .post('/admin/activate', async (c) => {
    const body = await c.req.json<{
      userId: string;
      subscriptionId: string;
      planId: string;
    }>();

    const { userId, subscriptionId, planId } = body;

    try {
      console.log('[RAZORPAY ADMIN] Manually activating subscription:', {
        userId,
        subscriptionId,
        planId,
      });

      const db = await getZeroDB(userId);

      // Fetch subscription details from Razorpay
      const razorpaySubscription = await callRazorpayAPI(
        `/subscriptions/${subscriptionId}`,
        'GET'
      );

      console.log('[RAZORPAY ADMIN] Razorpay subscription:', razorpaySubscription);

      // Update subscription by Razorpay ID (will update if exists, safe to call even if doesn't exist)
      await db.updateSubscriptionByRazorpayId(subscriptionId, {
        userId,
        planId,
        status: razorpaySubscription.status === 'completed' ? 'active' : razorpaySubscription.status,
        currentPeriodStart: razorpaySubscription.current_start
          ? new Date(razorpaySubscription.current_start * 1000)
          : new Date(),
        currentPeriodEnd: razorpaySubscription.current_end
          ? new Date(razorpaySubscription.current_end * 1000)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        updatedAt: new Date(),
      });

      console.log('[RAZORPAY ADMIN] Subscription activated successfully');

      return c.json({
        success: true,
        message: 'Subscription activated successfully',
        subscription: {
          userId,
          subscriptionId,
          planId,
          status: 'active',
        },
      });
    } catch (error) {
      console.error('[RAZORPAY ADMIN] Error activating subscription:', error);
      return c.json({
        error: 'Failed to activate subscription',
        details: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  })
  // Debug endpoint to check invoice by ID
  .get('/debug/invoice/:invoiceId', async (c) => {
    const invoiceId = c.req.param('invoiceId');

    try {
      console.log('[RAZORPAY DEBUG] Fetching invoice:', invoiceId);

      const razorpayInvoice = await callRazorpayAPI(
        `/invoices/${invoiceId}`,
        'GET'
      );

      console.log('[RAZORPAY DEBUG] Invoice data:', razorpayInvoice);

      return c.json(razorpayInvoice);
    } catch (error) {
      console.error('[RAZORPAY DEBUG] Error:', error);
      return c.json({
        error: 'Failed to fetch invoice',
        details: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  })
  // Debug endpoint to check payment by ID
  .get('/debug/payment/:paymentId', async (c) => {
    const paymentId = c.req.param('paymentId');

    try {
      console.log('[RAZORPAY DEBUG] Fetching payment:', paymentId);

      const razorpayPayment = await callRazorpayAPI(
        `/payments/${paymentId}`,
        'GET'
      );

      console.log('[RAZORPAY DEBUG] Payment data:', razorpayPayment);

      return c.json(razorpayPayment);
    } catch (error) {
      console.error('[RAZORPAY DEBUG] Error:', error);
      return c.json({
        error: 'Failed to fetch payment',
        details: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  })
  // Debug endpoint to check subscription by ID
  .get('/debug/:subscriptionId', async (c) => {
    const subscriptionId = c.req.param('subscriptionId');

    try {
      console.log('[RAZORPAY DEBUG] Fetching subscription:', subscriptionId);

      const razorpaySubscription = await callRazorpayAPI(
        `/subscriptions/${subscriptionId}`,
        'GET'
      );

      console.log('[RAZORPAY DEBUG] Subscription data:', razorpaySubscription);

      return c.json(razorpaySubscription);
    } catch (error) {
      console.error('[RAZORPAY DEBUG] Error:', error);
      return c.json({
        error: 'Failed to fetch subscription',
        details: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  })
  // Debug endpoint to check current user info
  .get('/debug/me', async (c) => {
    const { customerData } = c.var;

    if (!customerData) {
      return c.json({ error: 'Not logged in' }, 401);
    }

    try {
      const db = await getZeroDB(customerData.customerId);
      const userSubscription = await db.findSubscription();

      console.log('[RAZORPAY DEBUG] Current user info:', {
        userId: customerData.customerId,
        email: customerData.customerData.email,
        name: customerData.customerData.name,
        hasSubscription: !!userSubscription,
        subscription: userSubscription,
      });

      return c.json({
        userId: customerData.customerId,
        email: customerData.customerData.email,
        name: customerData.customerData.name,
        subscription: userSubscription || null,
      });
    } catch (error) {
      console.error('[RAZORPAY DEBUG] Error:', error);
      return c.json({
        error: 'Failed to fetch user info',
        details: error instanceof Error ? error.message : String(error)
      }, 500);
    }
  })
  // Track usage events
  .post('/track', async (c) => {
    const { customerData } = c.var;
    const body = await c.req.json<{
      feature: 'chatMessages' | 'connections' | 'brainActivity';
      count?: number;
    }>();

    if (!customerData) return c.json({ error: 'No customer ID found' }, 401);

    try {
      const zeDb = await getZeroDB(customerData.customerId);
      const db = zeDb.rawDb;
      const { feature, count = 1 } = body;

      // Get user's subscription
      const userSubscription = await zeDb.findSubscription();

      // Get or create usage tracking for this period
      const currentPeriodStart =
        userSubscription?.currentPeriodStart || new Date(new Date().setDate(1));

      const existingUsage = await db.query.usageTracking.findFirst({
        where: and(
          eq(usageTracking.userId, customerData.customerId),
          eq(usageTracking.feature, feature),
          eq(usageTracking.periodStart, currentPeriodStart),
        ),
      });

      if (existingUsage) {
        // Update existing usage
        await db
          .update(usageTracking)
          .set({
            count: existingUsage.count + count,
            updatedAt: new Date(),
          })
          .where(eq(usageTracking.id, existingUsage.id));
      } else {
        // Create new usage record
        await db.insert(usageTracking).values({
          id: crypto.randomUUID(),
          userId: customerData.customerId,
          feature,
          count,
          periodStart: currentPeriodStart,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      return c.json({ success: true });
    } catch (error) {
      console.error('Error tracking usage:', error);
      return c.json({ error: 'Failed to track usage' }, 500);
    }
  })
  // Open billing portal (redirect to Razorpay dashboard)
  .post('/openBillingPortal', async (c) => {
    const { customerData } = c.var;
    if (!customerData) return c.json({ error: 'No customer ID found' }, 401);

    try {
      const db = await getZeroDB(customerData.customerId);

      // Get user's subscription
      const userSubscription = await db.findSubscription();

      if (!userSubscription || !userSubscription.razorpaySubscriptionId) {
        return c.json({ error: 'No subscription found' }, 404);
      }

      // Razorpay doesn't have a hosted billing portal like Stripe
      // Instead, we'll return the subscription details URL
      const portalUrl = `https://dashboard.razorpay.com/subscriptions/${userSubscription.razorpaySubscriptionId}`;

      return c.json({
        url: portalUrl,
        subscriptionId: userSubscription.razorpaySubscriptionId,
      });
    } catch (error) {
      console.error('Error opening billing portal:', error);
      return c.json({ error: 'Failed to open billing portal' }, 500);
    }
  })
  // Webhook handler for Razorpay events
  .post('/webhook', async (c) => {
    const body = await c.req.text();
    const signature = c.req.header('x-razorpay-signature');

    if (!signature) {
      return c.json({ error: 'No signature provided' }, 400);
    }

    try {
      // Verify webhook signature
      const secret = env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_KEY_SECRET;
      const isValid = await verifyWebhookSignature(body, signature, secret);

      if (!isValid) {
        console.error('Invalid webhook signature');
        return c.json({ error: 'Invalid signature' }, 400);
      }

      const event = JSON.parse(body);
      const eventType = event.event;

      console.log('[RAZORPAY WEBHOOK] Received event:', eventType);

      // Handle payment.captured event to immediately activate subscription
      if (eventType === 'payment.captured') {
        const paymentData = event.payload.payment.entity;
        console.log('[RAZORPAY WEBHOOK] Payment captured:', {
          paymentId: paymentData.id,
          email: paymentData.email,
          invoiceId: paymentData.invoice_id,
        });

        // Fetch invoice to get subscription ID
        if (paymentData.invoice_id) {
          try {
            const invoice = await callRazorpayAPI(`/invoices/${paymentData.invoice_id}`, 'GET');
            const subscriptionId = invoice.subscription_id;

            if (subscriptionId) {
              console.log('[RAZORPAY WEBHOOK] Found subscription:', subscriptionId);

              // Fetch subscription to get userId from notes
              const razorpaySubscription = await callRazorpayAPI(`/subscriptions/${subscriptionId}`, 'GET');
              const userId = razorpaySubscription.notes?.userId;

              if (userId) {
                console.log('[RAZORPAY WEBHOOK] Activating subscription for user:', userId);
                const db = await getZeroDB(userId);

                // Update subscription status to active
                await db.updateSubscriptionByRazorpayId(subscriptionId, {
                  status: 'active',
                  currentPeriodStart: razorpaySubscription.current_start
                    ? new Date(razorpaySubscription.current_start * 1000)
                    : new Date(),
                  currentPeriodEnd: razorpaySubscription.current_end
                    ? new Date(razorpaySubscription.current_end * 1000)
                    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                  updatedAt: new Date(),
                });

                console.log('[RAZORPAY WEBHOOK] Subscription activated successfully');
              }
            }
          } catch (paymentError) {
            console.error('[RAZORPAY WEBHOOK] Error processing payment.captured:', paymentError);
          }
        }

        return c.json({ received: true });
      }

      // Handle subscription events
      const subscriptionData = event.payload.subscription?.entity;
      if (!subscriptionData) {
        console.log('[RAZORPAY WEBHOOK] Not a subscription event, skipping');
        return c.json({ received: true });
      }

      // Extract userId from subscription notes
      const userId = subscriptionData.notes?.userId;
      if (!userId) {
        console.error('[RAZORPAY WEBHOOK] No userId in subscription notes');
        return c.json({ error: 'No userId found' }, 400);
      }

      const db = await getZeroDB(userId);

      // Handle different event types
      switch (eventType) {
        case 'subscription.activated':
        case 'subscription.charged':
          await handleSubscriptionActivated(subscriptionData, db);
          break;

        case 'subscription.cancelled':
          await handleSubscriptionCancelled(subscriptionData, db);
          break;

        case 'subscription.completed':
          await handleSubscriptionCompleted(subscriptionData, db);
          break;

        case 'subscription.paused':
        case 'subscription.halted':
          await handleSubscriptionPaused(subscriptionData, db);
          break;

        default:
          console.log('[RAZORPAY WEBHOOK] Unhandled event:', eventType);
      }

      console.log('[RAZORPAY WEBHOOK] Successfully processed event:', eventType);
      return c.json({ received: true });
    } catch (error) {
      console.error('[RAZORPAY WEBHOOK] Error processing webhook:', error);
      return c.json({ error: 'Webhook processing failed' }, 500);
    }
  })
  // Get pricing table (for compatibility with Autumn frontend)
  .get('/components/pricing_table', async (c) => {
    const { customerData } = c.var;

    try {
      // Get user's current subscription if authenticated
      let currentPlanId = RAZORPAY_PLANS.FREE;

      if (customerData) {
        const db = await getZeroDB(customerData.customerId);
        const userSubscription = await db.findSubscription();

        if (userSubscription && userSubscription.status === 'active') {
          currentPlanId = userSubscription.planId;
        }
      }

      return c.json({
        plans: [
          {
            id: RAZORPAY_PLANS.FREE,
            name: 'Free',
            price: 0,
            currency: 'INR',
            interval: 'month',
            features: FEATURE_LIMITS[RAZORPAY_PLANS.FREE],
            current: currentPlanId === RAZORPAY_PLANS.FREE,
          },
          {
            id: RAZORPAY_PLANS.PRO_MONTHLY,
            name: 'Nubo Pro Monthly',
            price: 399,
            currency: 'INR',
            interval: 'month',
            features: FEATURE_LIMITS[RAZORPAY_PLANS.PRO_MONTHLY],
            current: currentPlanId === RAZORPAY_PLANS.PRO_MONTHLY,
          },
          {
            id: RAZORPAY_PLANS.PRO_ANNUAL,
            name: 'Nubo Pro Annual',
            price: 199,
            currency: 'INR',
            interval: 'month',
            billed: 'annually',
            annualPrice: 2388,
            features: FEATURE_LIMITS[RAZORPAY_PLANS.PRO_ANNUAL],
            current: currentPlanId === RAZORPAY_PLANS.PRO_ANNUAL,
          },
        ],
      });
    } catch (error) {
      console.error('Error fetching pricing table:', error);
      return c.json({ error: 'Failed to fetch pricing' }, 500);
    }
  });

// Helper functions for webhook handling
async function handleSubscriptionActivated(subscriptionData: any, db: any) {
  try {
    await db.updateSubscriptionByRazorpayId(subscriptionData.id, {
      status: 'active',
      currentPeriodStart: new Date(subscriptionData.current_start * 1000),
      currentPeriodEnd: new Date(subscriptionData.current_end * 1000),
    });

    console.log('Subscription activated:', subscriptionData.id);
  } catch (error) {
    console.error('Error handling subscription activation:', error);
  }
}

async function handleSubscriptionCancelled(subscriptionData: any, db: any) {
  try {
    await db.updateSubscriptionByRazorpayId(subscriptionData.id, {
      status: 'cancelled',
    });

    console.log('Subscription cancelled:', subscriptionData.id);
  } catch (error) {
    console.error('Error handling subscription cancellation:', error);
  }
}

async function handleSubscriptionCompleted(subscriptionData: any, db: any) {
  try {
    await db.updateSubscriptionByRazorpayId(subscriptionData.id, {
      status: 'completed',
    });

    console.log('Subscription completed:', subscriptionData.id);
  } catch (error) {
    console.error('Error handling subscription completion:', error);
  }
}

async function handleSubscriptionPaused(subscriptionData: any, db: any) {
  try {
    await db.updateSubscriptionByRazorpayId(subscriptionData.id, {
      status: 'paused',
    });

    console.log('Subscription paused:', subscriptionData.id);
  } catch (error) {
    console.error('Error handling subscription pause:', error);
  }
}
