'use client';

import { createContext, useContext, useEffect, useCallback, type PropsWithChildren } from 'react';

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
}

const ChatwootContext = createContext<ChatwootContextType | null>(null);

const CHATWOOT_TOKEN = 'uqDkxPUGDCg3pAaAx9S2CmS6';
const CHATWOOT_BASE_URL = 'https://app.chatwoot.com';

export function ChatwootProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    // Set chatwoot settings before loading the script
    window.chatwootSettings = {
      hideMessageBubble: true, // We'll use our own button
      position: 'right',
      type: 'standard',
    };

    // Check if script is already loaded
    if (document.getElementById('chatwoot-script')) {
      return;
    }

    // Create and load the Chatwoot script
    const script = document.createElement('script');
    script.id = 'chatwoot-script';
    script.src = `${CHATWOOT_BASE_URL}/packs/js/sdk.js`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (window.chatwootSDK) {
        window.chatwootSDK.run({
          websiteToken: CHATWOOT_TOKEN,
          baseUrl: CHATWOOT_BASE_URL,
        });
      }
    };

    document.body.appendChild(script);

    return () => {
      // Cleanup on unmount (optional, usually not needed for chat widgets)
      const existingScript = document.getElementById('chatwoot-script');
      if (existingScript) {
        existingScript.remove();
      }
    };
  }, []);

  const openChat = useCallback(() => {
    if (window.$chatwoot) {
      window.$chatwoot.toggle('open');
    }
  }, []);

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
    <ChatwootContext.Provider value={{ openChat, closeChat, toggleChat }}>
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
