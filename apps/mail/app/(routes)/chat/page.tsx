import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  MessageCircle,
  RefreshCw,
  ExternalLink,
  Maximize2,
  Minimize2,
  Settings,
  Loader2,
  AtSign,
} from 'lucide-react';
import { useTRPC } from '@/providers/query-provider';
import { cn } from '@/lib/utils';

const ROCKET_CHAT_URL = 'https://chat.nubo.email';

export default function NuboChatPage() {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [authToken, _setAuthToken] = useState<string | null>(null);

  // Fetch Nubo username
  const { data: usernameData, isLoading: isUsernameLoading } = useQuery(
    trpc.drive.getMyUsername.queryOptions(void 0, {
      retry: false,
    }),
  );

  const nuboUsername = usernameData?.username;
  const hasNuboAccount = !!nuboUsername;

  // Handle iframe load
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);

    // If we have an auth token, try to pass it to the iframe
    if (authToken && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        externalCommand: 'login-with-token',
        token: authToken,
      }, ROCKET_CHAT_URL);
    }
  }, [authToken]);

  // Refresh the iframe
  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    if (iframeRef.current) {
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = currentSrc;
    }
  }, []);

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // Open in new tab
  const openInNewTab = useCallback(() => {
    window.open(ROCKET_CHAT_URL, '_blank');
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Loading state while checking username
  if (isUsernameLoading) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        <div className="border-b p-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/mail/inbox')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Inbox
            </Button>
            <div className="flex items-center gap-2">
              <MessageCircle className="h-6 w-6" />
              <h1 className="text-2xl font-bold">Nubo Chat</h1>
            </div>
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // No Nubo account - redirect to settings
  if (!hasNuboAccount) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        {/* Header */}
        <div className="border-b p-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/mail/inbox')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Inbox
            </Button>
            <div className="flex items-center gap-2">
              <MessageCircle className="h-6 w-6" />
              <h1 className="text-2xl font-bold">Nubo Chat</h1>
            </div>
          </div>
        </div>

        {/* Setup Required Content */}
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
            <AtSign className="h-12 w-12 text-primary" />
          </div>
          <div className="text-center max-w-md">
            <h2 className="text-2xl font-semibold">Set Up Your Nubo Account</h2>
            <p className="mt-2 text-muted-foreground">
              To use Nubo Chat, you need to set up your Nubo username first.
              This will be your identity across all Nubo services.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => navigate('/mail/inbox')}>
              Back to Inbox
            </Button>
            <Button onClick={() => navigate('/settings/nubo-account')}>
              <Settings className="mr-2 h-4 w-4" />
              Set Up Nubo Account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex flex-col bg-background transition-all duration-200",
      isFullscreen ? "fixed inset-0 z-50" : "h-full w-full"
    )}>
      {/* Header */}
      <div className="border-b p-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {!isFullscreen && (
              <Button variant="ghost" size="sm" onClick={() => navigate('/mail/inbox')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Inbox
              </Button>
            )}
            <div className="flex items-center gap-2">
              <MessageCircle className="h-6 w-6" />
              <h1 className="text-2xl font-bold">Nubo Chat</h1>
            </div>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
              {nuboUsername}@nubo.email
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={openInNewTab}>
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Chat iframe container */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Loading Nubo Chat...</p>
            </div>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={`${ROCKET_CHAT_URL}/home`}
          className="h-full w-full border-0"
          onLoad={handleIframeLoad}
          allow="camera; microphone; display-capture; autoplay; clipboard-write"
          title="Nubo Chat"
        />
      </div>
    </div>
  );
}
