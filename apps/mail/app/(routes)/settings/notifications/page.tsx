'use client';

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsCard } from '@/components/settings/settings-card';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTRPC } from '@/providers/query-provider';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { useForm } from 'react-hook-form';
import { Bell, BellOff, Smartphone, Trash2, Loader2, Send } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import * as z from 'zod';

const formSchema = z.object({
  newMailNotifications: z.enum(['none', 'important', 'all']),
  marketingCommunications: z.boolean(),
});

// Helper to check if push notifications are supported
function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Helper to get device name from user agent
function getDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS Device';
  if (/Android/i.test(ua)) return 'Android Device';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'Unknown Device';
}

export default function NotificationsPage() {
  const [isSaving, setIsSaving] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);

  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Get VAPID public key
  const { data: vapidData } = useQuery(trpc.push.getVapidPublicKey.queryOptions());

  // Get existing subscriptions
  const { data: subscriptions } = useQuery(
    trpc.push.getSubscriptions.queryOptions(),
  );

  // Subscribe mutation
  const subscribeMutation = useMutation(
    trpc.push.subscribe.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.push.getSubscriptions.queryKey() });
        toast.success('Push notifications enabled');
      },
      onError: (error) => {
        toast.error(`Failed to enable notifications: ${error.message}`);
      },
    }),
  );

  // Unsubscribe mutation
  const unsubscribeMutation = useMutation(
    trpc.push.unsubscribe.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.push.getSubscriptions.queryKey() });
        toast.success('Push notifications disabled');
      },
      onError: (error) => {
        toast.error(`Failed to disable notifications: ${error.message}`);
      },
    }),
  );

  // Delete subscription mutation
  const deleteSubscriptionMutation = useMutation(
    trpc.push.deleteSubscription.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.push.getSubscriptions.queryKey() });
        toast.success('Device removed');
      },
      onError: (error) => {
        toast.error(`Failed to remove device: ${error.message}`);
      },
    }),
  );

  // Send test notification mutation
  const sendTestNotificationMutation = useMutation(
    trpc.push.sendTestNotification.mutationOptions({
      onSuccess: () => {
        toast.success('Test notification sent! Check your notifications.');
      },
      onError: (error) => {
        toast.error(`Failed to send test notification: ${error.message}`);
      },
    }),
  );

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      newMailNotifications: 'all',
      marketingCommunications: true, // Enable marketing communications by default
    },
  });

  // Check current push permission and subscription on mount
  useEffect(() => {
    if (isPushSupported()) {
      setPushPermission(Notification.permission);

      // Check current subscription
      navigator.serviceWorker.ready.then(async (registration) => {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          setCurrentEndpoint(subscription.endpoint);
        }
      });
    }
  }, []);

  // Register service worker and subscribe to push
  async function enablePushNotifications() {
    if (!isPushSupported()) {
      toast.error('Push notifications are not supported in this browser');
      return;
    }

    if (!vapidData?.publicKey) {
      toast.error('Push notifications are not configured on the server');
      return;
    }

    setIsSubscribing(true);

    try {
      // Request notification permission
      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission !== 'granted') {
        toast.error('Notification permission denied');
        setIsSubscribing(false);
        return;
      }

      // Register service worker
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // Convert VAPID public key to Uint8Array
      const padding = '='.repeat((4 - (vapidData.publicKey.length % 4)) % 4);
      const base64 = (vapidData.publicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = atob(base64);
      const applicationServerKey = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        applicationServerKey[i] = rawData.charCodeAt(i);
      }

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      const subscriptionJson = subscription.toJSON();
      if (!subscriptionJson.endpoint || !subscriptionJson.keys?.p256dh || !subscriptionJson.keys?.auth) {
        throw new Error('Invalid subscription');
      }

      // Save subscription to server
      await subscribeMutation.mutateAsync({
        endpoint: subscriptionJson.endpoint,
        p256dh: subscriptionJson.keys.p256dh,
        auth: subscriptionJson.keys.auth,
        userAgent: navigator.userAgent,
        deviceName: getDeviceName(),
      });

      setCurrentEndpoint(subscriptionJson.endpoint);
    } catch (error) {
      console.error('Failed to enable push notifications:', error);
      toast.error('Failed to enable push notifications');
    } finally {
      setIsSubscribing(false);
    }
  }

  // Disable push notifications for current device
  async function disablePushNotifications() {
    if (!isPushSupported()) return;

    setIsSubscribing(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        await unsubscribeMutation.mutateAsync({ endpoint: subscription.endpoint });
        setCurrentEndpoint(null);
      }
    } catch (error) {
      console.error('Failed to disable push notifications:', error);
      toast.error('Failed to disable push notifications');
    } finally {
      setIsSubscribing(false);
    }
  }

  function onSubmit() {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      toast.success('Notification preferences saved');
    }, 1000);
  }

  const isCurrentDeviceSubscribed = currentEndpoint && subscriptions?.some(
    (sub) => sub.endpoint === currentEndpoint
  );

  return (
    <div className="grid gap-6">
      {/* Push Notifications Card */}
      <SettingsCard
        title="Push Notifications"
        description="Receive push notifications on this device when you get new emails."
      >
        <div className="space-y-4">
          {!isPushSupported() ? (
            <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-950">
              <BellOff className="h-5 w-5 text-yellow-600" />
              <p className="text-sm text-yellow-600">
                Push notifications are not supported in this browser.
              </p>
            </div>
          ) : pushPermission === 'denied' ? (
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
              <BellOff className="h-5 w-5 text-red-600" />
              <div>
                <p className="text-sm font-medium text-red-600">Notifications blocked</p>
                <p className="text-sm text-red-500">
                  You have blocked notifications for this site. Please enable them in your browser settings.
                </p>
              </div>
            </div>
          ) : isCurrentDeviceSubscribed ? (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <Bell className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium">Push notifications enabled</p>
                  <p className="text-sm text-muted-foreground">
                    You will receive notifications on this device
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={disablePushNotifications}
                disabled={isSubscribing}
              >
                {isSubscribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Disable'
                )}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <BellOff className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Push notifications disabled</p>
                  <p className="text-sm text-muted-foreground">
                    Enable to receive notifications on this device
                  </p>
                </div>
              </div>
              <Button
                variant="default"
                size="sm"
                onClick={enablePushNotifications}
                disabled={isSubscribing || !vapidData?.publicKey}
              >
                {isSubscribing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Enable'
                )}
              </Button>
            </div>
          )}

          {/* List of subscribed devices */}
          {subscriptions && subscriptions.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-3 text-sm font-medium">Subscribed Devices</h4>
              <div className="space-y-2">
                {subscriptions.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="flex items-center gap-3">
                      <Smartphone className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          {sub.deviceName || 'Unknown Device'}
                          {sub.endpoint === currentEndpoint && (
                            <span className="ml-2 text-xs text-green-600">(This device)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Added {sub.createdAt ? new Date(sub.createdAt).toLocaleDateString() : 'Unknown'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => sendTestNotificationMutation.mutate({ subscriptionId: sub.id })}
                        disabled={sendTestNotificationMutation.isPending}
                        title="Send test notification"
                      >
                        {sendTestNotificationMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteSubscriptionMutation.mutate({ subscriptionId: sub.id })}
                        disabled={deleteSubscriptionMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SettingsCard>

      {/* Email Notifications Card */}
      <SettingsCard
        title="Email Notifications"
        description="Choose what notifications you want to receive."
        footer={
          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => form.reset()}>
              Reset to Defaults
            </Button>
            <Button type="submit" form="notifications-form" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        }
      >
        <Form {...form}>
          <form
            id="notifications-form"
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6"
          >
            <FormField
              control={form.control}
              name="newMailNotifications"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Mail Notifications</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-[240px]">
                        <Bell className="mr-2 h-4 w-4" />
                        <SelectValue placeholder="Select notification level" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="important">Important Only</SelectItem>
                      <SelectItem value="all">All Messages</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Choose which messages you want to receive notifications for
                  </FormDescription>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="marketingCommunications"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Marketing Communications</FormLabel>
                    <FormDescription>Receive updates about new features</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
          </form>
        </Form>
      </SettingsCard>
    </div>
  );
}
