import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SettingsCard } from '@/components/settings/settings-card';
import { useTRPC, trpcClient } from '@/providers/query-provider';
import { AtSign, MessageCircle, HardDrive, Video, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export default function NuboAccountPage() {
  const trpc = useTRPC();

  // Username state and handlers
  const [newUsername, setNewUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);

  // Fetch current username
  const {
    data: usernameData,
    refetch: refetchUsername,
    isLoading: isUsernameLoading,
  } = useQuery(
    trpc.drive.getMyUsername.queryOptions(void 0, {
      retry: false,
    }),
  );

  // Set initial username value when data loads
  useEffect(() => {
    if (usernameData?.username) {
      setNewUsername(usernameData.username);
    }
  }, [usernameData?.username]);

  // Check username availability with debounce
  useEffect(() => {
    if (!newUsername || newUsername === usernameData?.username) {
      setUsernameAvailable(null);
      return;
    }

    const timer = setTimeout(async () => {
      if (newUsername.length < 3) {
        setUsernameAvailable(false);
        return;
      }
      setCheckingUsername(true);
      try {
        const result = await trpcClient.drive.checkUsername.query({ username: newUsername });
        setUsernameAvailable(result.available);
      } catch {
        setUsernameAvailable(false);
      } finally {
        setCheckingUsername(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [newUsername, usernameData?.username]);

  const handleSaveUsername = async () => {
    if (!newUsername || newUsername.length < 3 || !usernameAvailable) return;
    setSavingUsername(true);
    try {
      await trpcClient.drive.setUsername.mutate({ username: newUsername });
      await refetchUsername();
      toast.success('Username set successfully! You can now use Nubo Chat and other services.');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to set username';
      toast.error(errorMessage);
    } finally {
      setSavingUsername(false);
    }
  };

  const hasUsername = !!usernameData?.username;

  return (
    <div className="grid gap-6">
      {/* Nubo Username Card */}
      <SettingsCard
        title="Nubo Username"
        description="Your unique Nubo identity used across all Nubo services."
        footer={
          !hasUsername && newUsername && usernameAvailable ? (
            <Button onClick={handleSaveUsername} disabled={savingUsername}>
              {savingUsername ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Setting up...
                </>
              ) : (
                'Set Username'
              )}
            </Button>
          ) : null
        }
      >
        <div className="space-y-4">
          {isUsernameLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading username...
            </div>
          ) : hasUsername ? (
            <div className="rounded-lg border bg-gradient-to-r from-primary/5 to-primary/10 p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <AtSign className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{usernameData.username}</p>
                  <p className="text-sm text-muted-foreground">@nubo.email</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <Check className="h-4 w-4" />
                <span>Your Nubo account is active</span>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  Set up your Nubo username to access Nubo Chat, share files on Nubo Drive, and more.
                  This will be your permanent identity across all Nubo services.
                </p>
              </div>
              <div className="flex flex-col gap-2 max-w-md">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) =>
                        setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                      }
                      placeholder="username"
                      className="w-full pl-9 pr-24 h-10 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      maxLength={30}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      @nubo.email
                    </span>
                  </div>
                </div>
                {newUsername && newUsername.length >= 3 && (
                  <p
                    className={cn(
                      'text-xs flex items-center gap-1',
                      usernameAvailable === true
                        ? 'text-green-600'
                        : usernameAvailable === false
                          ? 'text-red-600'
                          : 'text-muted-foreground',
                    )}
                  >
                    {checkingUsername ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Checking availability...
                      </>
                    ) : usernameAvailable === true ? (
                      <>
                        <Check className="h-3 w-3" />
                        Username is available!
                      </>
                    ) : usernameAvailable === false ? (
                      'Username is not available'
                    ) : (
                      ''
                    )}
                  </p>
                )}
                {newUsername && newUsername.length < 3 && (
                  <p className="text-xs text-muted-foreground">
                    Username must be at least 3 characters
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Connected Services */}
      <SettingsCard
        title="Nubo Services"
        description="Services connected to your Nubo account."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <ServiceCard
            icon={MessageCircle}
            title="Nubo Chat"
            description="Chat with other Nubo users"
            href="/chat"
            enabled={hasUsername}
          />
          <ServiceCard
            icon={HardDrive}
            title="Nubo Drive"
            description="Store and share files"
            href="/drive"
            enabled={true}
          />
          <ServiceCard
            icon={Video}
            title="Nubo Meet"
            description="Video meetings"
            href="/meet"
            enabled={true}
          />
        </div>
      </SettingsCard>
    </div>
  );
}

function ServiceCard({
  icon: Icon,
  title,
  description,
  href,
  enabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
  enabled: boolean;
}) {
  return (
    <a
      href={enabled ? href : undefined}
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-4 transition-colors',
        enabled
          ? 'hover:bg-muted/50 cursor-pointer'
          : 'opacity-50 cursor-not-allowed',
      )}
      onClick={(e) => !enabled && e.preventDefault()}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg',
            enabled ? 'bg-primary/10' : 'bg-muted',
          )}
        >
          <Icon className={cn('h-5 w-5', enabled ? 'text-primary' : 'text-muted-foreground')} />
        </div>
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {!enabled && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Requires Nubo username
        </p>
      )}
    </a>
  );
}
