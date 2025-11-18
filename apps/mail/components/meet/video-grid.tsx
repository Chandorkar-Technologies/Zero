import { useEffect, useRef } from 'react';
import { Mic, MicOff, VideoOff, Monitor } from 'lucide-react';

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
  stream?: MediaStream;
}

interface VideoGridProps {
  participants: Participant[];
  localStream: MediaStream | null;
  currentParticipantId: string;
}

export function VideoGrid({ participants, localStream, currentParticipantId }: VideoGridProps) {
  return (
    <div className="grid h-full w-full gap-2 p-4" style={{
      gridTemplateColumns: getGridColumns(participants.length + 1),
      gridTemplateRows: getGridRows(participants.length + 1)
    }}>
      {/* Local video */}
      <VideoTile
        stream={localStream}
        participant={{
          id: currentParticipantId,
          name: 'You',
          audioEnabled: true,
          videoEnabled: true,
          screenSharing: false,
          isGuest: false,
          joinedAt: Date.now(),
        }}
        isLocal
      />

      {/* Remote participants */}
      {participants
        .filter((p) => p.id !== currentParticipantId)
        .map((participant) => (
          <VideoTile key={participant.id} stream={participant.stream} participant={participant} />
        ))}
    </div>
  );
}

interface VideoTileProps {
  stream?: MediaStream | null;
  participant: Participant;
  isLocal?: boolean;
}

function VideoTile({ stream, participant, isLocal = false }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative overflow-hidden rounded-lg bg-gray-900">
      {stream && participant.videoEnabled ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="h-full w-full object-cover"
          style={{ transform: isLocal ? 'scaleX(-1)' : 'none' }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-3xl font-semibold text-primary-foreground">
            {participant.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .slice(0, 2)}
          </div>
        </div>
      )}

      {/* Participant info overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">
              {participant.name}
              {isLocal && ' (You)'}
            </span>
            {participant.screenSharing && (
              <Monitor className="h-4 w-4 text-white" />
            )}
          </div>

          <div className="flex items-center gap-2">
            {participant.audioEnabled ? (
              <Mic className="h-4 w-4 text-white" />
            ) : (
              <MicOff className="h-4 w-4 text-red-500" />
            )}
            {!participant.videoEnabled && (
              <VideoOff className="h-4 w-4 text-red-500" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getGridColumns(count: number): string {
  if (count === 1) return 'repeat(1, 1fr)';
  if (count === 2) return 'repeat(2, 1fr)';
  if (count <= 4) return 'repeat(2, 1fr)';
  if (count <= 6) return 'repeat(3, 1fr)';
  if (count <= 9) return 'repeat(3, 1fr)';
  return 'repeat(4, 1fr)';
}

function getGridRows(count: number): string {
  if (count === 1) return 'repeat(1, 1fr)';
  if (count === 2) return 'repeat(1, 1fr)';
  if (count <= 4) return 'repeat(2, 1fr)';
  if (count <= 6) return 'repeat(2, 1fr)';
  if (count <= 9) return 'repeat(3, 1fr)';
  return 'repeat(4, 1fr)';
}
