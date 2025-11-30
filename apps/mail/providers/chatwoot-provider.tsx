'use client';

import { createContext, useContext, useEffect, useCallback, useState, type PropsWithChildren } from 'react';
import { toast } from 'sonner';

declare global {
  interface Window {
    chatwootSettings?: {
      hideMessageBubble?: boolean;
      position?: 'left' | 'right';
      locale?: string;
      type?: 'standard' | 'expanded_bubble';
    };
    chatwootSDK?: {
      run: (config: { websiteToken: string; baseUrl: string }) => void;
    };
    $chatwoot?: {
      toggle: (state?: 'open' | 'close') => void;
      setUser: (id: string, data: { email?: string; name?: string }) => void;
      reset: () => void;
    };
  }
}

interface ChatwootContextType {
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  isReady: boolean;
}

const ChatwootContext = createContext<ChatwootContextType | null>(null);

// Get Chatwoot config from environment variables
// To fix: Go to app.chatwoot.com → Settings → Inboxes → Your Website Inbox → Copy Website Token
const CHATWOOT_TOKEN = import.meta.env.VITE_CHATWOOT_TOKEN || '';
const CHATWOOT_BASE_URL = import.meta.env.VITE_CHATWOOT_BASE_URL || 'https://app.chatwoot.com';

const SUPPORT_EMAIL = 'support@nubo.email';

export function ChatwootProvider({ children }: PropsWithChildren) {
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    // Skip initialization if no token is configured
    if (!CHATWOOT_TOKEN) {
      console.warn('[Chatwoot] No website token configured. Set VITE_CHATWOOT_TOKEN environment variable.');
      setLoadError(true);
      return;
    }

    // Set chatwoot settings before loading the script
    window.chatwootSettings = {
      hideMessageBubble: true, // We'll use our own button
      position: 'right',
      type: 'standard',
    };

    // Listen for chatwoot ready event
    const handleChatwootReady = () => {
      console.log('[Chatwoot] Widget is ready');
      setIsReady(true);
    };

    window.addEventListener('chatwoot:ready', handleChatwootReady);

    // Check if script is already loaded
    if (document.getElementById('chatwoot-script')) {
      // If script exists and $chatwoot is available, it's ready
      if (window.$chatwoot) {
        setIsReady(true);
      }
      return () => {
        window.removeEventListener('chatwoot:ready', handleChatwootReady);
      };
    }

    // Create and load the Chatwoot script
    const script = document.createElement('script');
    script.id = 'chatwoot-script';
    script.src = `${CHATWOOT_BASE_URL}/packs/js/sdk.js`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      console.log('[Chatwoot] SDK script loaded');
      if (window.chatwootSDK) {
        window.chatwootSDK.run({
          websiteToken: CHATWOOT_TOKEN,
          baseUrl: CHATWOOT_BASE_URL,
        });
        console.log('[Chatwoot] SDK initialized with token:', CHATWOOT_TOKEN.substring(0, 8) + '...');
      }
    };

    script.onerror = (error) => {
      console.error('[Chatwoot] Failed to load SDK:', error);
      setLoadError(true);
    };

    document.body.appendChild(script);

    return () => {
      window.removeEventListener('chatwoot:ready', handleChatwootReady);
    };
  }, []);

  const openChat = useCallback(() => {
    console.log('[Chatwoot] openChat called, isReady:', isReady, '$chatwoot:', !!window.$chatwoot, 'loadError:', loadError);

    // If we know it failed to load, show fallback immediately
    if (loadError) {
      toast.info('Live chat is unavailable', {
        description: `Please email us at ${SUPPORT_EMAIL}`,
        action: {
          label: 'Send Email',
          onClick: () => window.open(`mailto:${SUPPORT_EMAIL}?subject=Support%20Request`, '_blank'),
        },
      });
      return;
    }

    if (window.$chatwoot) {
      console.log('[Chatwoot] Opening chat widget');
      window.$chatwoot.toggle('open');
    } else {
      console.warn('[Chatwoot] $chatwoot not available yet, retrying...');
      toast.loading('Connecting to support...', { id: 'chatwoot-loading' });

      // Retry with increasing delays
      const tryOpen = (attempt: number) => {
        if (attempt > 5) {
          console.error('[Chatwoot] Failed to open after 5 attempts');
          toast.dismiss('chatwoot-loading');
          toast.info('Live chat is unavailable', {
            description: `Please email us at ${SUPPORT_EMAIL}`,
            action: {
              label: 'Send Email',
              onClick: () => window.open(`mailto:${SUPPORT_EMAIL}?subject=Support%20Request`, '_blank'),
            },
          });
          setLoadError(true);
          return;
        }
        setTimeout(() => {
          if (window.$chatwoot) {
            console.log('[Chatwoot] Opening chat widget (attempt', attempt, ')');
            toast.dismiss('chatwoot-loading');
            window.$chatwoot.toggle('open');
          } else {
            tryOpen(attempt + 1);
          }
        }, 500 * attempt);
      };
      tryOpen(1);
    }
  }, [isReady, loadError]);

  const closeChat = useCallback(() => {
    if (window.$chatwoot) {
      window.$chatwoot.toggle('close');
    }
  }, []);

  const toggleChat = useCallback(() => {
    if (window.$chatwoot) {
      window.$chatwoot.toggle();
    }
  }, []);

  return (
    <ChatwootContext.Provider value={{ openChat, closeChat, toggleChat, isReady }}>
      {children}
    </ChatwootContext.Provider>
  );
}

export function useChatwoot() {
  const context = useContext(ChatwootContext);
  if (!context) {
    throw new Error('useChatwoot must be used within a ChatwootProvider');
  }
  return context;
}
