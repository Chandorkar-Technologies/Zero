import { Button } from '@/components/ui/button';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  MessageSquare,
  Circle,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface MeetingControlsProps {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  isRecording: boolean;
  participantCount: number;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onToggleRecording: () => void;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onLeave: () => void;
}

export function MeetingControls({
  audioEnabled,
  videoEnabled,
  screenSharing,
  isRecording,
  participantCount,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onToggleRecording,
  onToggleChat,
  onToggleParticipants,
  onLeave,
}: MeetingControlsProps) {
  return (
    <div className="flex items-center justify-between border-t bg-background p-4">
      {/* Left side - Recording indicator */}
      <div className="flex items-center gap-2">
        {isRecording && (
          <div className="flex items-center gap-2 rounded-full bg-red-100 px-3 py-1.5 text-sm font-medium text-red-600 dark:bg-red-950 dark:text-red-400">
            <Circle className="h-3 w-3 fill-current animate-pulse" />
            Recording
          </div>
        )}
      </div>

      {/* Center - Main controls */}
      <div className="flex items-center gap-2">
        <Button
          variant={audioEnabled ? 'default' : 'destructive'}
          size="lg"
          className="h-12 w-12 rounded-full p-0"
          onClick={onToggleAudio}
          title={audioEnabled ? 'Mute' : 'Unmute'}
        >
          {audioEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </Button>

        <Button
          variant={videoEnabled ? 'default' : 'destructive'}
          size="lg"
          className="h-12 w-12 rounded-full p-0"
          onClick={onToggleVideo}
          title={videoEnabled ? 'Stop video' : 'Start video'}
        >
          {videoEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </Button>

        <Button
          variant={screenSharing ? 'default' : 'outline'}
          size="lg"
          className={cn('h-12 w-12 rounded-full p-0', screenSharing && 'bg-blue-600 hover:bg-blue-700')}
          onClick={onToggleScreenShare}
          title={screenSharing ? 'Stop sharing' : 'Share screen'}
        >
          {screenSharing ? <MonitorOff className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
        </Button>

        <Button
          variant="destructive"
          size="lg"
          className="h-12 rounded-full px-6"
          onClick={onLeave}
        >
          <PhoneOff className="mr-2 h-5 w-5" />
          Leave
        </Button>
      </div>

      {/* Right side - Additional controls */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="lg"
          className="h-12 w-12 rounded-full p-0"
          onClick={onToggleParticipants}
          title="Participants"
        >
          <Users className="h-5 w-5" />
          {participantCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              {participantCount}
            </span>
          )}
        </Button>

        <Button
          variant="outline"
          size="lg"
          className="h-12 w-12 rounded-full p-0"
          onClick={onToggleChat}
          title="Chat"
        >
          <MessageSquare className="h-5 w-5" />
        </Button>

        <Button
          variant={isRecording ? 'destructive' : 'outline'}
          size="lg"
          className="h-12 w-12 rounded-full p-0"
          onClick={onToggleRecording}
          title={isRecording ? 'Stop recording' : 'Start recording'}
        >
          <Circle className={cn('h-5 w-5', isRecording && 'fill-current')} />
        </Button>
      </div>
    </div>
  );
}
