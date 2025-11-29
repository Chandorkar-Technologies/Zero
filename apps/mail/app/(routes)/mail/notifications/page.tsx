import { useTRPC } from '@/providers/query-provider';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Bell, AtSign, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Outputs } from '@zero/server/trpc';
import { useActiveConnection } from '@/hooks/use-connections';

type Notification = Outputs['notifications']['getNotifications'][0];

export default function NotificationsPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'all' | 'mention' | 'important' | 'action_item'>(
    'all'
  );

  // Get all connections first
  const { data: connectionsData } = useQuery(trpc.connections.list.queryOptions());
  const connections = connectionsData?.connections;

  // Get active connection to determine which one to use
  const { data: activeConnection, isLoading: isLoadingActive } = useActiveConnection();

  // Use active connection if available, otherwise fall back to first connection
  const connectionId = activeConnection?.id || connections?.[0]?.id;

  // Get all notifications
  const { data: notifications, isLoading } = useQuery({
    ...trpc.notifications.getNotifications.queryOptions({
      connectionId: connectionId!,
      limit: 100,
    }),
    enabled: !!connectionId,
  });

  // Get notification counts
  const { data: counts } = useQuery({
    ...trpc.notifications.getNotificationCounts.queryOptions({
      connectionId: connectionId!,
    }),
    enabled: !!connectionId,
  });

  const filteredNotifications =
    activeTab === 'all'
      ? notifications
      : notifications?.filter((n) => n.type === activeTab);

  const handleNotificationClick = (notification: Notification) => {
    navigate(`/mail/inbox?threadId=${notification.threadId}`);
  };

  const getNotificationIcon = (type: Notification['type']) => {
    switch (type) {
      case 'mention':
        return <AtSign className="h-5 w-5 text-blue-600 dark:text-blue-400" />;
      case 'important':
        return <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />;
      case 'action_item':
        return <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />;
    }
  };

  const getTypeLabel = (type: Notification['type']) => {
    switch (type) {
      case 'mention':
        return 'Mention';
      case 'important':
        return 'Important';
      case 'action_item':
        return 'Action Required';
    }
  };

  const getTypeBadgeVariant = (type: Notification['type']) => {
    switch (type) {
      case 'mention':
        return 'default';
      case 'important':
        return 'destructive';
      case 'action_item':
        return 'secondary';
    }
  };

  if (isLoading || isLoadingActive || !connectionId) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!connections || connections.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Bell className="h-16 w-16 text-muted-foreground" />
        <div className="text-center">
          <h2 className="text-2xl font-semibold">No Email Connection</h2>
          <p className="text-muted-foreground">
            Connect an email account to see notifications
          </p>
        </div>
      </div>
    );
  }

  if (!notifications || notifications.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Bell className="h-16 w-16 text-muted-foreground" />
        <div className="text-center">
          <h2 className="text-2xl font-semibold">No Notifications</h2>
          <p className="text-muted-foreground">You're all caught up!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4 sm:p-6">
        <h1 className="mb-2 sm:mb-4 text-xl sm:text-2xl font-semibold">Notifications</h1>
        <p className="mb-3 sm:mb-4 text-sm sm:text-base text-muted-foreground">
          Mentions, important emails, and action items
        </p>

        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="all" className="text-xs sm:text-sm">
              All
              {counts && <Badge variant="secondary" className="ml-1 sm:ml-2 text-xs">{counts.total}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="mention" className="text-xs sm:text-sm">
              <span className="hidden sm:inline">Mentions</span>
              <span className="sm:hidden">@</span>
              {counts && counts.mentions > 0 && (
                <Badge variant="secondary" className="ml-1 sm:ml-2 text-xs">{counts.mentions}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="important" className="text-xs sm:text-sm">
              <span className="hidden sm:inline">Important</span>
              <span className="sm:hidden">!</span>
              {counts && counts.important > 0 && (
                <Badge variant="secondary" className="ml-1 sm:ml-2 text-xs">{counts.important}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="action_item" className="text-xs sm:text-sm">
              <span className="hidden sm:inline">Action Items</span>
              <span className="sm:hidden">Tasks</span>
              {counts && counts.actionItems > 0 && (
                <Badge variant="secondary" className="ml-1 sm:ml-2 text-xs">{counts.actionItems}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="space-y-2 sm:space-y-3">
          {filteredNotifications && filteredNotifications.length > 0 ? (
            filteredNotifications.map((notification) => (
              <div
                key={notification.id}
                className="cursor-pointer rounded-lg border p-4 transition-shadow hover:shadow-md"
                onClick={() => handleNotificationClick(notification)}
              >
                <div className="flex items-start gap-4">
                  <div className="shrink-0">{getNotificationIcon(notification.type)}</div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={getTypeBadgeVariant(notification.type) as any}>
                            {getTypeLabel(notification.type)}
                          </Badge>
                        </div>
                        <h3 className="mt-2 font-medium">{notification.title}</h3>
                        {notification.from && (
                          <p className="text-sm text-muted-foreground">
                            From: {notification.from.name || notification.from.address}
                          </p>
                        )}
                      </div>

                      <p className="shrink-0 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(notification.date), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>

                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {notification.snippet}
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">No notifications in this category</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
