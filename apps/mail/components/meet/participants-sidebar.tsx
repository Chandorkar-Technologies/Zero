import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, Mic, MicOff, Video, VideoOff, Monitor, Crown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Participant {
  id: string;
  userId?: string;
  name: string;
  email?: string;
  isGuest: boolean;
  joinedAt: number;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
}

interface ParticipantsSidebarProps {
  participants: Participant[];
  hostId?: string;
  onClose: () => void;
}

export function ParticipantsSidebar({ participants, hostId, onClose }: ParticipantsSidebarProps) {
  return (
    <div className="flex h-full w-80 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b p-4">
        <h3 className="font-semibold">Participants ({participants.length})</h3>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Participants list */}
      <ScrollArea className="flex-1">
        <div className="divide-y">
          {participants.map((participant) => {
            const isHost = hostId && participant.userId === hostId;

            return (
              <div key={participant.id} className="p-4">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {participant.name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2)}
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Name and role */}
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{participant.name}</p>
                      {isHost && (
                        <Crown className="h-4 w-4 shrink-0 text-yellow-600" title="Host" />
                      )}
                      {participant.isGuest && (
                        <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                          Guest
                        </span>
                      )}
                    </div>

                    {/* Email if available */}
                    {participant.email && (
                      <p className="truncate text-sm text-muted-foreground">{participant.email}</p>
                    )}

                    {/* Status indicators */}
                    <div className="mt-2 flex items-center gap-3">
                      {/* Audio status */}
                      <div className="flex items-center gap-1.5">
                        {participant.audioEnabled ? (
                          <Mic className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <MicOff className="h-3.5 w-3.5 text-red-500" />
                        )}
                        <span className="text-xs text-muted-foreground">
                          {participant.audioEnabled ? 'Audio on' : 'Muted'}
                        </span>
                      </div>

                      {/* Video status */}
                      <div className="flex items-center gap-1.5">
                        {participant.videoEnabled ? (
                          <Video className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <VideoOff className="h-3.5 w-3.5 text-red-500" />
                        )}
                        <span className="text-xs text-muted-foreground">
                          {participant.videoEnabled ? 'Video on' : 'Video off'}
                        </span>
                      </div>

                      {/* Screen sharing indicator */}
                      {participant.screenSharing && (
                        <div className="flex items-center gap-1.5">
                          <Monitor className="h-3.5 w-3.5 text-blue-600" />
                          <span className="text-xs text-muted-foreground">Sharing</span>
                        </div>
                      )}
                    </div>

                    {/* Join time */}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Joined {formatDistanceToNow(new Date(participant.joinedAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
