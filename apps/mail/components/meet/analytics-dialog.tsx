import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/providers/query-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Clock, MessageSquare, VideoIcon, TrendingUp } from 'lucide-react';

interface AnalyticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  meetingTitle: string;
}

export function AnalyticsDialog({
  open,
  onOpenChange,
  meetingId,
  meetingTitle,
}: AnalyticsDialogProps) {
  const trpc = useTRPC();

  const { data: analytics, isLoading } = useQuery({
    ...trpc.meet.getAnalytics.queryOptions({
      meetingId,
    }),
    enabled: open,
  });

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Meeting Analytics</DialogTitle>
          <DialogDescription>{meetingTitle}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : analytics ? (
          <div className="space-y-4">
            {/* Overview stats */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Participants</CardDescription>
                  <CardTitle className="text-3xl">{analytics.totalParticipants}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Duration</CardDescription>
                  <CardTitle className="text-3xl">
                    {Math.floor(analytics.duration / 60)}m
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Messages</CardDescription>
                  <CardTitle className="text-3xl">{analytics.totalMessages}</CardTitle>
                </CardHeader>
                <CardContent>
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Recordings</CardDescription>
                  <CardTitle className="text-3xl">{analytics.recordings.length}</CardTitle>
                </CardHeader>
                <CardContent>
                  <VideoIcon className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </div>

            {/* Engagement metrics */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Engagement Metrics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground">Average Duration</span>
                      <span className="font-medium">
                        {formatDuration(analytics.averageParticipantDuration)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{
                          width: formatPercentage(
                            analytics.averageParticipantDuration / analytics.duration
                          ),
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-muted-foreground">Message Rate</span>
                      <span className="font-medium">
                        {(analytics.totalMessages / (analytics.duration / 60)).toFixed(1)} /min
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-green-500"
                        style={{
                          width: formatPercentage(
                            Math.min(analytics.totalMessages / analytics.totalParticipants / 10, 1)
                          ),
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Peak Participants</span>
                    <span className="font-medium">{analytics.peakParticipants}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Maximum concurrent participants during the meeting
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Participants list */}
            <Card>
              <CardHeader>
                <CardTitle>Participants ({analytics.participants.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analytics.participants.map((participant) => (
                    <div
                      key={participant.id || participant.name}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Users className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-medium">{participant.name}</p>
                          {participant.isHost && (
                            <Badge variant="secondary" className="mt-1">
                              Host
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right text-sm text-muted-foreground">
                        <p>{formatDuration(participant.duration)}</p>
                        <p className="text-xs">
                          {participant.messageCount} message{participant.messageCount !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Recordings */}
            {analytics.recordings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Recordings ({analytics.recordings.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {analytics.recordings.map((recording) => (
                      <div
                        key={recording.id || recording.createdAt}
                        className="flex items-center justify-between p-3 rounded-lg border"
                      >
                        <div className="flex items-center gap-3">
                          <VideoIcon className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium">Recording</p>
                            <p className="text-sm text-muted-foreground">
                              {formatDuration(recording.duration)} • {(recording.size / 1024 / 1024).toFixed(1)} MB
                            </p>
                          </div>
                        </div>
                        <Badge>{new Date(recording.createdAt).toLocaleDateString()}</Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center">
            <p className="text-muted-foreground">No analytics available</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
