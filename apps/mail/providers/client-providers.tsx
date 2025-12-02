import { LoadingProvider } from '@/components/context/loading-context';
import { ChatwootProvider } from '@/providers/chatwoot-provider';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { SidebarProvider } from '@/components/ui/sidebar';
import { PostHogProvider } from '@/lib/posthog-provider';
import { Provider as JotaiProvider } from 'jotai';
import { useState, useEffect, type PropsWithChildren } from 'react';
import Toaster from '@/components/ui/toast';
import { ThemeProvider } from 'next-themes';

// Declare electron on window for TypeScript
declare global {
  interface Window {
    electron?: {
      isElectron: boolean;
      showNotification: (title: string, options: {
        body?: string;
        icon?: string;
        tag?: string;
        data?: Record<string, unknown>;
      }) => void;
      setBadgeCount: (count: number) => void;
      platform: string;
      getVersion: () => string;
    };
  }
}

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

    // Set up service worker message listener for Electron notifications
    if ('serviceWorker' in navigator) {
      const handleServiceWorkerMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'PUSH_NOTIFICATION') {
          // Check if running in Electron
          if (window.electron?.isElectron) {
            // Forward to Electron's native notification
            window.electron.showNotification(event.data.title || 'New Email', {
              body: event.data.body,
              icon: event.data.icon,
              tag: event.data.tag,
              data: event.data.data,
            });
          }
        }
      };

      navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

      return () => {
        navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
      };
    }
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
