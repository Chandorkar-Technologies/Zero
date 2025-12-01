// app/providers.tsx
'use client';

import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { useSession } from '@/lib/auth-client';
import { useEffect, useState } from 'react';
import posthog from 'posthog-js';

// Inner component that uses client-only hooks
function PostHogProviderInner({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  useEffect(() => {
    if (!import.meta.env.VITE_PUBLIC_POSTHOG_KEY) return;
    try {
      posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string, {
        api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
        capture_pageview: true,
      });
    } catch (error) {
      console.error('Error initializing PostHog:', error);
    }
  }, []);

  useEffect(() => {
    if (session?.user) {
      posthog.identify(session.user.id, {
        email: session.user.email,
        name: session.user.name,
      });
    }
  }, [session]);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // During SSR, render children without PostHog wrapper
  if (!mounted) {
    return <>{children}</>;
  }

  return <PostHogProviderInner>{children}</PostHogProviderInner>;
}
