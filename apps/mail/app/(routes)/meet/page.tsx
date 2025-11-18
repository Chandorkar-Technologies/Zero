'use client';

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTRPC } from '@/providers/query-provider';
import { useQuery } from '@tanstack/react-query';
import { CreateMeetingDialog } from '@/components/meet/create-meeting-dialog';
import { RecordingPlayer } from '@/components/meet/recording-player';
import { InviteDialog } from '@/components/meet/invite-dialog';
import { AnalyticsDialog } from '@/components/meet/analytics-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Video,
  Plus,
  Calendar,
  Users,
  Clock,
  Play,
  ExternalLink,
  Loader2,
  VideoIcon,
  UserPlus,
  BarChart3,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

export default function MeetingsPage() {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<'scheduled' | 'active' | 'ended'>('scheduled');
  const [selectedRecording, setSelectedRecording] = useState<{
    meetingId: string;
    title: string;
  } | null>(null);
  const [inviteMeeting, setInviteMeeting] = useState<{
    id: string;
    title: string;
    joinUrl: string;
  } | null>(null);
  const [analyticsMeeting, setAnalyticsMeeting] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const { data: meetings, isLoading, refetch } = useQuery(
    trpc.meet.list.queryOptions({
      status: activeTab,
      limit: 50,
    })
  );

  // Fetch recording URL when dialog opens
  const { data: recordingData } = useQuery({
    ...trpc.meet.getRecordingUrl.queryOptions({
      meetingId: selectedRecording?.meetingId || '',
    }),
    enabled: !!selectedRecording?.meetingId,
  });

  const handleJoinMeeting = (roomId: string) => {
    navigate(`/meet/${roomId}`);
  };

  const handleViewRecording = (meetingId: string, title: string) => {
    setSelectedRecording({ meetingId, title });
  };

  const handleInviteToMeeting = (id: string, title: string, roomId: string) => {
    const joinUrl = `${window.location.origin}/meet/${roomId}`;
    setInviteMeeting({ id, title, joinUrl });
  };

  const handleViewAnalytics = (id: string, title: string) => {
    setAnalyticsMeeting({ id, title });
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="border-b bg-background px-6 py-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">Nubo Meet</h1>
            <p className="text-sm text-muted-foreground">
              Video meetings with your team, clients, and collaborators
            </p>
          </div>

          <Button
            onClick={() => setShowCreateDialog(true)}
            size="lg"
            className="w-full md:w-auto"
          >
            <Plus className="mr-2 h-4 w-4" />
            New meeting
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)} className="mt-6">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="scheduled" className="gap-2">
              <Calendar className="h-4 w-4" />
              Scheduled
            </TabsTrigger>
            <TabsTrigger value="active" className="gap-2">
              <Play className="h-4 w-4" />
              Active
            </TabsTrigger>
            <TabsTrigger value="ended" className="gap-2">
              <Clock className="h-4 w-4" />
              Past
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-muted/30 p-6">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !meetings || meetings.length === 0 ? (
          <div className="flex h-[calc(100vh-240px)] flex-col items-center justify-center text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted">
              <Video className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="mt-6 text-xl font-semibold">
              {activeTab === 'scheduled' && 'No scheduled meetings'}
              {activeTab === 'active' && 'No active meetings'}
              {activeTab === 'ended' && 'No past meetings'}
            </h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              {activeTab === 'scheduled' && 'Create a new meeting to get started'}
              {activeTab === 'active' && 'All your active meetings will appear here'}
              {activeTab === 'ended' && 'Your meeting history will appear here'}
            </p>
            {activeTab === 'scheduled' && (
              <Button onClick={() => setShowCreateDialog(true)} size="lg" className="mt-6">
                <Plus className="mr-2 h-4 w-4" />
                Create meeting
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {meetings.map((meeting) => (
              <Card
                key={meeting.id}
                className="group overflow-hidden transition-shadow hover:shadow-lg"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <CardTitle className="line-clamp-1 text-lg">{meeting.title}</CardTitle>
                      <CardDescription className="line-clamp-2 text-xs">
                        {meeting.description || 'No description'}
                      </CardDescription>
                    </div>

                    <Badge
                      variant={meeting.status === 'active' ? 'default' : 'secondary'}
                      className="shrink-0"
                    >
                      {meeting.status}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {meeting.scheduledFor && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {format(new Date(meeting.scheduledFor), 'PPP p')}
                      </span>
                    </div>
                  )}

                  {meeting.startedAt && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {meeting.status === 'active'
                          ? `Started ${formatDistanceToNow(new Date(meeting.startedAt), { addSuffix: true })}`
                          : `Duration: ${Math.floor((meeting.duration || 0) / 60)} minutes`}
                      </span>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5 shrink-0" />
                    <span>{meeting.maxParticipants} max participants</span>
                  </div>

                  {meeting.isRecording && (
                    <Badge variant="destructive" className="w-fit text-xs">
                      Recording
                    </Badge>
                  )}

                  <div className="flex flex-col gap-2 border-t pt-3">
                    <div className="flex gap-2">
                      {meeting.status === 'active' || meeting.status === 'scheduled' ? (
                        <Button
                          className="flex-1"
                          onClick={() => handleJoinMeeting(meeting.roomId)}
                        >
                          <Play className="mr-2 h-4 w-4" />
                          Join
                        </Button>
                      ) : meeting.isRecording ? (
                        <>
                          <Button
                            variant="outline"
                            className="flex-1"
                            onClick={() => handleViewRecording(meeting.id, meeting.title)}
                          >
                            <VideoIcon className="mr-2 h-4 w-4" />
                            Recording
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleViewAnalytics(meeting.id, meeting.title)}
                          >
                            <BarChart3 className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" className="flex-1" disabled>
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Ended
                        </Button>
                      )}

                      {(meeting.status === 'scheduled' || meeting.status === 'active') && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleInviteToMeeting(meeting.id, meeting.title, meeting.roomId)}
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create meeting dialog */}
      <CreateMeetingDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={() => {
          refetch();
        }}
      />

      {/* Recording player dialog */}
      <Dialog open={!!selectedRecording} onOpenChange={() => setSelectedRecording(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedRecording?.title}</DialogTitle>
          </DialogHeader>
          {recordingData && (
            <RecordingPlayer
              url={recordingData.url}
              title={selectedRecording?.title || 'Recording'}
              duration={recordingData.duration}
              fileSize={recordingData.size}
            />
          )}
          {!recordingData && (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Invite dialog */}
      {inviteMeeting && (
        <InviteDialog
          open={!!inviteMeeting}
          onOpenChange={() => setInviteMeeting(null)}
          meetingId={inviteMeeting.id}
          meetingTitle={inviteMeeting.title}
          joinUrl={inviteMeeting.joinUrl}
        />
      )}

      {/* Analytics dialog */}
      {analyticsMeeting && (
        <AnalyticsDialog
          open={!!analyticsMeeting}
          onOpenChange={() => setAnalyticsMeeting(null)}
          meetingId={analyticsMeeting.id}
          meetingTitle={analyticsMeeting.title}
        />
      )}
    </div>
  );
}
