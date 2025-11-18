import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { signOut } from '@/lib/auth-client';
import { useEffect } from 'react';

type FeatureState = {
  total: number;
  remaining: number;
  unlimited: boolean;
  enabled: boolean;
  usage: number;
  nextResetAt: number | null;
  interval: string;
  included_usage: number;
};

type Features = {
  chatMessages: FeatureState;
  connections: FeatureState;
  brainActivity: FeatureState;
};

type SubscriptionResponse = {
  planId: string;
  status: string;
  razorpaySubscriptionId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  features: {
    connections: number;
    chatMessages: number;
    brainActivity: number;
  };
  isPro: boolean;
};

const DEFAULT_FEATURES: Features = {
  chatMessages: {
    total: 0,
    remaining: 0,
    unlimited: false,
    enabled: false,
    usage: 0,
    nextResetAt: null,
    interval: '',
    included_usage: 0,
  },
  connections: {
    total: 1,
    remaining: 1,
    unlimited: false,
    enabled: true,
    usage: 0,
    nextResetAt: null,
    interval: 'month',
    included_usage: 1,
  },
  brainActivity: {
    total: 0,
    remaining: 0,
    unlimited: false,
    enabled: false,
    usage: 0,
    nextResetAt: null,
    interval: '',
    included_usage: 0,
  },
};

const getBackendUrl = () => {
  if (typeof window === 'undefined') return '';
  return import.meta.env.VITE_PUBLIC_BACKEND_URL || 'http://localhost:8787';
};

// Fetch subscription status
const fetchSubscription = async (): Promise<SubscriptionResponse> => {
  const response = await fetch(`${getBackendUrl()}/api/razorpay/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Unauthorized');
    }
    throw new Error('Failed to fetch subscription');
  }

  return response.json();
};

// Attach subscription
const attachSubscription = async (data: {
  planId: string;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<{
  subscriptionId: string;
  keyId: string;
  customerEmail: string;
  customerName: string;
}> => {
  const response = await fetch(`${getBackendUrl()}/api/razorpay/attach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to create subscription');
  }

  const result = await response.json();

  console.log('[RAZORPAY] Subscription created:', {
    subscriptionId: result.subscriptionId,
    keyId: result.keyId?.substring(0, 10) + '...',
    customerName: result.customerName,
    customerEmail: result.customerEmail,
  });

  // Load Razorpay script and open checkout
  const script = document.createElement('script');
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.async = true;
  document.body.appendChild(script);

  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load Razorpay script'));
  });

  // Open Razorpay checkout
  const options = {
    key: result.keyId,
    subscription_id: result.subscriptionId,
    name: 'Nubo Pro',
    description: 'Nubo Pro Subscription',
    image: 'https://nubo.email/logo-512.png',
    prefill: {
      name: result.customerName,
      email: result.customerEmail,
    },
    readonly: {
      email: true,
      name: true,
    },
    theme: {
      color: '#B183FF',
    },
    handler: async function (_response: any) {
      // Payment successful - sync subscription status before redirecting
      console.log('[RAZORPAY] Payment successful, syncing subscription...');

      try {
        // Call sync endpoint to immediately activate subscription
        const syncResponse = await fetch(`${getBackendUrl()}/api/razorpay/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });

        if (syncResponse.ok) {
          console.log('[RAZORPAY] Subscription synced successfully');
        } else {
          console.error('[RAZORPAY] Sync failed, but continuing...', await syncResponse.text());
        }
      } catch (syncError) {
        console.error('[RAZORPAY] Sync error:', syncError);
        // Continue anyway - auto-sync will handle it on next page load
      }

      // Redirect to success URL
      window.location.href = data.successUrl || `${window.location.origin}/mail/inbox?success=true`;
    },
    modal: {
      ondismiss: function () {
        console.log('[RAZORPAY] Checkout form closed');
      },
      escape: true,
      backdropclose: false,
      confirm_close: false,
    },
    config: {
      display: {
        hide: [{ method: 'wallet' }],
        preferences: { show_default_blocks: true },
      },
    },
  };

  console.log('[RAZORPAY] Opening checkout with options:', {
    ...options,
    key: options.key?.substring(0, 10) + '...',
  });

  try {
    const rzp = new (window as any).Razorpay(options);
    rzp.on('payment.failed', function (response: any) {
      console.error('[RAZORPAY] Payment failed:', response.error);
    });
    rzp.open();
  } catch (error) {
    console.error('[RAZORPAY] Error opening checkout:', error);
    throw error;
  }

  return result;
};

// Track usage
const trackUsage = async (data: {
  feature: 'chatMessages' | 'connections' | 'brainActivity';
  count?: number;
}): Promise<{ success: boolean }> => {
  const response = await fetch(`${getBackendUrl()}/api/razorpay/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to track usage');
  }

  return response.json();
};

// Open billing portal
const openBillingPortal = async (data?: {
  return_url?: string;
}): Promise<{
  url: string;
  subscriptionId: string;
}> => {
  const response = await fetch(`${getBackendUrl()}/api/razorpay/openBillingPortal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data || {}),
  });

  if (!response.ok) {
    throw new Error('Failed to open billing portal');
  }

  const result = await response.json();

  // Open in new window
  if (result.url) {
    window.open(result.url, '_blank');
  }

  return result;
};

export const useBilling = () => {
  const queryClient = useQueryClient();

  const {
    data: subscription,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['subscription'],
    queryFn: fetchSubscription,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  // Sign out on unauthorized error
  useEffect(() => {
    if (error && error.message === 'Unauthorized') {
      signOut();
    }
  }, [error]);

  const attachMutation = useMutation({
    mutationFn: attachSubscription,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });

  const trackMutation = useMutation({
    mutationFn: trackUsage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });

  const openBillingPortalMutation = useMutation({
    mutationFn: openBillingPortal,
  });

  const isPro = subscription?.isPro ?? false;

  // Transform subscription data into feature states
  const features: Features = (() => {
    if (!subscription?.features) return DEFAULT_FEATURES;

    const nextResetAt = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).getTime()
      : null;

    return {
      chatMessages: {
        total: subscription.features.chatMessages,
        remaining: subscription.features.chatMessages,
        unlimited: subscription.features.chatMessages === Infinity,
        enabled: subscription.features.chatMessages > 0 || subscription.features.chatMessages === Infinity,
        usage: 0, // This would need to be fetched from usage tracking
        nextResetAt,
        interval: subscription.planId === 'pro_annual' ? 'year' : 'month',
        included_usage: subscription.features.chatMessages,
      },
      connections: {
        total: subscription.features.connections,
        remaining: subscription.features.connections,
        unlimited: subscription.features.connections === Infinity,
        enabled: subscription.features.connections > 0 || subscription.features.connections === Infinity,
        usage: 0, // This would need to be fetched from usage tracking
        nextResetAt,
        interval: subscription.planId === 'pro_annual' ? 'year' : 'month',
        included_usage: subscription.features.connections,
      },
      brainActivity: {
        total: subscription.features.brainActivity,
        remaining: subscription.features.brainActivity,
        unlimited: subscription.features.brainActivity === Infinity,
        enabled: subscription.features.brainActivity > 0 || subscription.features.brainActivity === Infinity,
        usage: 0, // This would need to be fetched from usage tracking
        nextResetAt,
        interval: subscription.planId === 'pro_annual' ? 'year' : 'month',
        included_usage: subscription.features.brainActivity,
      },
    };
  })();

  return {
    isLoading,
    customer: subscription ? { id: subscription.planId, ...subscription } : null,
    refetch,
    attach: (data: { productId: string; successUrl?: string; cancelUrl?: string }) =>
      attachMutation.mutateAsync({
        planId: data.productId,
        successUrl: data.successUrl,
        cancelUrl: data.cancelUrl,
      }),
    track: (data: { feature_id: string; count?: number }) => {
      const featureMap: Record<string, 'chatMessages' | 'connections' | 'brainActivity'> = {
        'chat-messages': 'chatMessages',
        'connections': 'connections',
        'brain-activity': 'brainActivity',
      };

      const feature = featureMap[data.feature_id];
      if (!feature) {
        console.error('Unknown feature ID:', data.feature_id);
        return Promise.resolve({ success: false });
      }

      return trackMutation.mutateAsync({
        feature,
        count: data.count,
      });
    },
    openBillingPortal: (data?: { return_url?: string }) =>
      openBillingPortalMutation.mutateAsync(data),
    isPro,
    ...features,
  };
};
