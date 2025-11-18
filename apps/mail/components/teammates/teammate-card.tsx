import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { Mail, MessageSquare, TrendingUp } from 'lucide-react';
import type { Outputs } from '@zero/server/trpc';

type Teammate = Outputs['teammates']['getTeammates'][0];

interface TeammateCardProps {
  teammate: Teammate;
  onClick?: () => void;
}

export function TeammateCard({ teammate, onClick }: TeammateCardProps) {
  const initials = teammate.name
    ? teammate.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : teammate.email.slice(0, 2).toUpperCase();

  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-600 dark:text-green-400';
    if (score >= 50) return 'text-blue-600 dark:text-blue-400';
    return 'text-gray-600 dark:text-gray-400';
  };

  return (
    <Card
      className="cursor-pointer p-4 transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        <Avatar className="h-12 w-12">
          <AvatarFallback className="bg-primary/10 text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-semibold">
                {teammate.name || teammate.email}
              </h3>
              {teammate.name && (
                <p className="truncate text-sm text-muted-foreground">
                  {teammate.email}
                </p>
              )}
            </div>

            {teammate.score >= 50 && (
              <Badge variant="secondary" className="shrink-0">
                <TrendingUp className="mr-1 h-3 w-3" />
                Active
              </Badge>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <MessageSquare className="h-4 w-4" />
              <span>{teammate.threadCount} threads</span>
            </div>

            <div className="flex items-center gap-1">
              <Mail className="h-4 w-4" />
              <span>{teammate.messageCount} messages</span>
            </div>

            {teammate.domain && (
              <Badge variant="outline" className="text-xs">
                @{teammate.domain}
              </Badge>
            )}
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Last contact:{' '}
            {formatDistanceToNow(new Date(teammate.lastContactDate), {
              addSuffix: true,
            })}
          </p>
        </div>

        <div className="shrink-0">
          <div
            className={`text-2xl font-bold tabular-nums ${getScoreColor(teammate.score)}`}
            title={`Teammate score: ${teammate.score}/100`}
          >
            {teammate.score}
          </div>
        </div>
      </div>
    </Card>
  );
}
