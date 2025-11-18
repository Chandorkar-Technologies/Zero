import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTRPC } from '@/providers/query-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Copy, Check } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface CreateMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateMeetingDialog({ open, onOpenChange, onSuccess }: CreateMeetingDialogProps) {
  const trpc = useTRPC();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scheduledDate, setScheduledDate] = useState<Date>();
  const [requiresAuth, setRequiresAuth] = useState(true);
  const [allowChat, setAllowChat] = useState(true);
  const [allowScreenShare, setAllowScreenShare] = useState(true);
  const [createdMeeting, setCreatedMeeting] = useState<{
    joinUrl: string;
    roomId: string;
  } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const createMutation = useMutation(trpc.meet.create.mutationOptions());

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error('Title required', {
        description: 'Please enter a meeting title',
      });
      return;
    }

    try {
      const result = await createMutation.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        scheduledFor: scheduledDate,
        requiresAuth,
        allowChat,
        allowScreenShare,
        allowFileShare: true,
        isRecording: false,
      });

      setCreatedMeeting(result);
      onSuccess?.();

      toast.success('Meeting created', {
        description: scheduledDate
          ? `Meeting scheduled for ${format(scheduledDate, 'PPP p')}`
          : 'Meeting is ready to join',
      });
    } catch (error: any) {
      toast.error('Failed to create meeting', {
        description: error.message || 'An error occurred',
      });
    }
  };

  const handleCopyUrl = async () => {
    if (createdMeeting) {
      await navigator.clipboard.writeText(createdMeeting.joinUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);

      toast({
        title: 'Link copied',
        description: 'Meeting link copied to clipboard',
      });
    }
  };

  const handleClose = () => {
    setTitle('');
    setDescription('');
    setScheduledDate(undefined);
    setRequiresAuth(true);
    setAllowChat(true);
    setAllowScreenShare(true);
    setCreatedMeeting(null);
    setCopiedUrl(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[525px]">
        {createdMeeting ? (
          <>
            <DialogHeader>
              <DialogTitle>Meeting created</DialogTitle>
              <DialogDescription>
                Share this link with participants to join the meeting
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="flex gap-2">
                <Input value={createdMeeting.joinUrl} readOnly className="flex-1" />
                <Button variant="outline" size="icon" onClick={handleCopyUrl}>
                  {copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>

              <Button className="w-full" onClick={handleClose}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create new meeting</DialogTitle>
              <DialogDescription>
                Set up an instant or scheduled video meeting
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="title">Meeting title *</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Team standup"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Discuss project updates"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Schedule for later (optional)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !scheduledDate && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {scheduledDate ? format(scheduledDate, 'PPP p') : 'Start meeting now'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={scheduledDate}
                      onSelect={setScheduledDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="requiresAuth" className="cursor-pointer">
                    Require authentication
                  </Label>
                  <Switch
                    id="requiresAuth"
                    checked={requiresAuth}
                    onCheckedChange={setRequiresAuth}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="allowChat" className="cursor-pointer">
                    Allow in-call chat
                  </Label>
                  <Switch id="allowChat" checked={allowChat} onCheckedChange={setAllowChat} />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="allowScreenShare" className="cursor-pointer">
                    Allow screen sharing
                  </Label>
                  <Switch
                    id="allowScreenShare"
                    checked={allowScreenShare}
                    onCheckedChange={setAllowScreenShare}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create meeting'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
