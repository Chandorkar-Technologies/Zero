'use client';

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useTRPC } from '@/providers/query-provider';
import { useMutation } from '@tanstack/react-query';
import { useMeetingRoom } from '@/hooks/use-meeting-room';
import { VideoGrid } from '@/components/meet/video-grid';
import { MeetingControls } from '@/components/meet/meeting-controls';
import { MeetingChat } from '@/components/meet/meeting-chat';
import { ParticipantsSidebar } from '@/components/meet/participants-sidebar';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function MeetingRoomPage() {
  const params = useParams();
  const navigate = useNavigate();
  const trpc = useTRPC();

  const roomId = params.roomId as string;

  const [showChat, setShowChat] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [joinData, setJoinData] = useState<{
    participantId: string;
    wsUrl: string;
  } | null>(null);

  // Join meeting mutation
  const joinMutation = useMutation(trpc.meet.join.mutationOptions());

  useEffect(() => {
    // Join the meeting
    const joinMeeting = async () => {
      try {
        const result = await joinMutation.mutateAsync({
          roomId,
        });

        setJoinData(result);
      } catch (error: any) {
        toast({
          title: 'Failed to join meeting',
          description: error.message || 'An error occurred',
          variant: 'destructive',
        });
        navigate('/mail/inbox');
      }
    };

    joinMeeting();
  }, [roomId]);

  // Initialize meeting room hook once we have join data
  const {
    connected,
    participants,
    messages,
    isRecording,
    localStream,
    audioEnabled,
    videoEnabled,
    screenSharing,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    sendMessage,
    sendEmoji,
    toggleRecording,
  } = useMeetingRoom(
    joinData?.wsUrl || '',
    joinData?.participantId || ''
  );

  const handleLeave = () => {
    // Close streams and navigate away
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    navigate('/mail/inbox');
  };

  if (!joinData) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
          <p className="mt-4 text-lg font-medium">Joining meeting...</p>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
          <p className="mt-4 text-lg font-medium">Connecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-950">
      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Video grid */}
        <div className="flex-1">
          <VideoGrid
            participants={participants}
            localStream={localStream}
            currentParticipantId={joinData.participantId}
          />
        </div>

        {/* Chat sidebar */}
        {showChat && (
          <MeetingChat
            messages={messages}
            onSendMessage={sendMessage}
            onSendEmoji={sendEmoji}
            onClose={() => setShowChat(false)}
          />
        )}

        {/* Participants sidebar */}
        {showParticipants && (
          <ParticipantsSidebar
            participants={participants}
            onClose={() => setShowParticipants(false)}
          />
        )}
      </div>

      {/* Controls */}
      <MeetingControls
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        screenSharing={screenSharing}
        isRecording={isRecording}
        participantCount={participants.length}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleScreenShare={toggleScreenShare}
        onToggleRecording={toggleRecording}
        onToggleChat={() => setShowChat(!showChat)}
        onToggleParticipants={() => setShowParticipants(!showParticipants)}
        onLeave={handleLeave}
      />
    </div>
  );
}
