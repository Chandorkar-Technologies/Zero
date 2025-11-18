import { useTRPC } from '@/providers/query-provider';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Mail } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router';
import type { Outputs } from '@zero/server/trpc';

type Teammate = Outputs['people']['getPeople'][0];

interface TeammateDetailProps {
  teammate: Teammate;
  connectionId: string;
  onBack: () => void;
}

export function TeammateDetail({ teammate, connectionId, onBack }: TeammateDetailProps) {
  const trpc = useTRPC();
  const navigate = useNavigate();

  const { data: threads, isLoading } = useQuery(
    trpc.people.getPersonThreads.queryOptions({
      connectionId,
      email: teammate.email,
      limit: 50,
    })
  );

  const handleThreadClick = (threadId: string) => {
    navigate(`/mail/inbox?threadId=${threadId}`);
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to People
        </Button>

        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-semibold text-primary">
            {teammate.name
              ? teammate.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2)
              : teammate.email.slice(0, 2).toUpperCase()}
          </div>

          <div className="flex-1">
            <h1 className="text-2xl font-semibold">{teammate.name || teammate.email}</h1>
            {teammate.name && (
              <p className="text-muted-foreground">{teammate.email}</p>
            )}
            <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
              <span>{teammate.threadCount} conversations</span>
              <span>{teammate.messageCount} messages</span>
              <span>
                Last contact:{' '}
                {formatDistanceToNow(new Date(teammate.lastContactDate), {
                  addSuffix: true,
                })}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="mb-4 text-lg font-semibold">Email Conversations</h2>

        {!threads || threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Mail className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">No conversations found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {threads.map((thread: any) => (
              <div
                key={thread.threadId}
                className="cursor-pointer rounded-lg border p-4 transition-shadow hover:shadow-md"
                onClick={() => handleThreadClick(thread.threadId)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium">{thread.subject || '(No subject)'}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {thread.snippet}
                    </p>
                    <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{thread.messageCount} messages</span>
                      <span>
                        {formatDistanceToNow(new Date(thread.date), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
