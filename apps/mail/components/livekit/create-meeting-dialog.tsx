import { useState } from 'react';
import { useTRPC } from '@/providers/query-provider';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, X, Mail, Plus } from 'lucide-react';

interface CreateMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMeetingCreated: (meetingId: string) => void;
}

export function CreateMeetingDialog({
  open,
  onOpenChange,
  onMeetingCreated,
}: CreateMeetingDialogProps) {
  const trpc = useTRPC();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [invitees, setInvitees] = useState<string[]>([]);
  const [inviteeInput, setInviteeInput] = useState('');

  const { mutateAsync: createMeeting, isPending } = useMutation(
    trpc.livekit.create.mutationOptions(),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      toast.error('Please enter a meeting title');
      return;
    }

    if (isScheduled && (!scheduledDate || !scheduledTime)) {
      toast.error('Please select date and time for scheduled meeting');
      return;
    }

    try {
      let scheduledFor: Date | undefined;
      if (isScheduled && scheduledDate && scheduledTime) {
        scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);
        if (scheduledFor <= new Date()) {
          toast.error('Scheduled time must be in the future');
          return;
        }
      }

      const result = await createMeeting({
        title,
        description: description || undefined,
        recordingEnabled,
        scheduledFor,
        invitees: isScheduled && invitees.length > 0 ? invitees : undefined,
      });

      const inviteMsg = result.invitesSent > 0 ? ` Invites sent to ${result.invitesSent} participant(s).` : '';
      toast.success(isScheduled ? `Meeting scheduled successfully.${inviteMsg}` : 'Meeting created successfully');

      if (!isScheduled) {
        onMeetingCreated(result.meetingId);
      } else {
        onOpenChange(false);
      }

      // Reset form
      setTitle('');
      setDescription('');
      setRecordingEnabled(false);
      setIsScheduled(false);
      setScheduledDate('');
      setScheduledTime('');
      setInvitees([]);
      setInviteeInput('');
    } catch (error) {
      console.error('Failed to create meeting:', error);
      toast.error('Failed to create meeting');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Meeting</DialogTitle>
            <DialogDescription>
              {isScheduled
                ? 'Schedule a meeting for later'
                : "Set up a new video meeting. You'll join immediately after creation."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Meeting Title *</Label>
              <Input
                id="title"
                placeholder="Team Standup"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Optional description for the meeting"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="schedule">Schedule for Later</Label>
                <p className="text-sm text-muted-foreground">
                  Set a date and time for the meeting
                </p>
              </div>
              <Switch
                id="schedule"
                checked={isScheduled}
                onCheckedChange={setIsScheduled}
              />
            </div>

            {isScheduled && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="date">Date *</Label>
                    <Input
                      id="date"
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      required={isScheduled}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="time">Time *</Label>
                    <Input
                      id="time"
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      required={isScheduled}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="invitees">
                    <Mail className="mr-1 inline h-4 w-4" />
                    Invite Participants (optional)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="invitees"
                      type="email"
                      placeholder="email@example.com"
                      value={inviteeInput}
                      onChange={(e) => setInviteeInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const email = inviteeInput.trim().toLowerCase();
                          if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !invitees.includes(email)) {
                            setInvitees([...invitees, email]);
                            setInviteeInput('');
                          }
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        const email = inviteeInput.trim().toLowerCase();
                        if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !invitees.includes(email)) {
                          setInvitees([...invitees, email]);
                          setInviteeInput('');
                        }
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {invitees.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {invitees.map((email) => (
                        <Badge key={email} variant="secondary" className="px-2 py-1">
                          {email}
                          <button
                            type="button"
                            className="ml-2 hover:text-destructive"
                            onClick={() => setInvitees(invitees.filter((e) => e !== email))}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Press Enter or click + to add. Invites with calendar event will be sent.
                  </p>
                </div>
              </>
            )}

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="recording">Enable Recording</Label>
                <p className="text-sm text-muted-foreground">
                  Record this meeting for later playback
                </p>
              </div>
              <Switch
                id="recording"
                checked={recordingEnabled}
                onCheckedChange={setRecordingEnabled}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isScheduled ? 'Schedule Meeting' : 'Create & Join'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
