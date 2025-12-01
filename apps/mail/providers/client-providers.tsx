import { LoadingProvider } from '@/components/context/loading-context';
import { ChatwootProvider } from '@/providers/chatwoot-provider';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { SidebarProvider } from '@/components/ui/sidebar';
import { PostHogProvider } from '@/lib/posthog-provider';
import { Provider as JotaiProvider } from 'jotai';
import { useState, useEffect, type PropsWithChildren } from 'react';
import Toaster from '@/components/ui/toast';
import { ThemeProvider } from 'next-themes';

// Inner component that uses client-only hooks
function ClientOnlyProviders({ children }: PropsWithChildren) {
  // Dynamically import and use client-only hooks after hydration
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Initialize keyboard layout after mount
    import('@/components/keyboard-layout-indicator').then(({ initKeyboardLayout }) => {
      initKeyboardLayout?.();
    });
  }, []);

  // During SSR or before hydration, render without client-specific behavior
  if (!mounted) {
    return <>{children}</>;
  }

  return <>{children}</>;
}

export function ClientProviders({ children }: PropsWithChildren) {
  return (
    <NuqsAdapter>
      <JotaiProvider>
        <ThemeProvider
          attribute="class"
          enableSystem
          disableTransitionOnChange
          defaultTheme="system"
        >
          <SidebarProvider>
            <PostHogProvider>
              <ChatwootProvider>
                <LoadingProvider>
                  <ClientOnlyProviders>
                    {children}
                  </ClientOnlyProviders>
                  <Toaster />
                </LoadingProvider>
              </ChatwootProvider>
            </PostHogProvider>
          </SidebarProvider>
        </ThemeProvider>
      </JotaiProvider>
    </NuqsAdapter>
  );
}
