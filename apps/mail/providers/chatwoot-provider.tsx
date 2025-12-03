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

const CHATWOOT_TOKEN = 'uqDkxPUGDCg3pAaAx9S2CmS6';
const CHATWOOT_BASE_URL = 'https://app.chatwoot.com';

const SUPPORT_EMAIL = 'support@nubo.email';

export function ChatwootProvider({ children }: PropsWithChildren) {
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    // Set chatwoot settings before loading the script
    // Note: Using type: 'expanded_bubble' ensures the widget can be toggled programmatically
    window.chatwootSettings = {
      hideMessageBubble: true, // We'll use our own button
      position: 'right',
      type: 'expanded_bubble',
    };

    // Listen for chatwoot ready event
    const handleChatwootReady = () => {
      console.log('[Chatwoot] Widget is ready');
      console.log('[Chatwoot] $chatwoot object:', window.$chatwoot);
      console.log('[Chatwoot] $chatwoot methods:', window.$chatwoot ? Object.keys(window.$chatwoot) : 'N/A');
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
        console.log('[Chatwoot] SDK initialized');
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

    const openEmailFallback = () => {
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=Support%20Request`;
      toast.info('Opening email client', {
        description: `Sending support request to ${SUPPORT_EMAIL}`,
      });
    };

    // If we know it failed to load, show fallback immediately
    if (loadError) {
      openEmailFallback();
      return;
    }

    const tryToggle = () => {
      if (window.$chatwoot && typeof window.$chatwoot.toggle === 'function') {
        try {
          console.log('[Chatwoot] Calling toggle("open")');
          window.$chatwoot.toggle('open');
          return true;
        } catch (err) {
          console.error('[Chatwoot] Error calling toggle:', err);
          return false;
        }
      }
      return false;
    };

    if (tryToggle()) {
      console.log('[Chatwoot] Successfully called toggle');
      return;
    }

    console.warn('[Chatwoot] $chatwoot not available yet, retrying...');
    toast.loading('Connecting to support...', { id: 'chatwoot-loading' });

    // Retry with increasing delays
    const tryOpen = (attempt: number) => {
      if (attempt > 5) {
        console.error('[Chatwoot] Failed to open after 5 attempts');
        toast.dismiss('chatwoot-loading');
        openEmailFallback();
        setLoadError(true);
        return;
      }
      setTimeout(() => {
        if (tryToggle()) {
          console.log('[Chatwoot] Opening chat widget (attempt', attempt, ')');
          toast.dismiss('chatwoot-loading');
        } else {
          tryOpen(attempt + 1);
        }
      }, 500 * attempt);
    };
    tryOpen(1);
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
