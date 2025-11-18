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
import { Badge } from '@/components/ui/badge';
import { Mail, X, Loader2, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  meetingTitle: string;
  joinUrl: string;
}

export function InviteDialog({
  open,
  onOpenChange,
  meetingId,
  meetingTitle,
  joinUrl,
}: InviteDialogProps) {
  const trpc = useTRPC();
  const [emails, setEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [message, setMessage] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(false);

  const sendInviteMutation = useMutation(trpc.meet.sendEmailInvitation.mutationOptions());

  const handleAddEmail = () => {
    const email = emailInput.trim().toLowerCase();

    // Basic email validation
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Invalid email', {
        description: 'Please enter a valid email address',
      });
      return;
    }

    if (emails.includes(email)) {
      toast.error('Duplicate email', {
        description: 'This email has already been added',
      });
      return;
    }

    setEmails([...emails, email]);
    setEmailInput('');
  };

  const handleRemoveEmail = (email: string) => {
    setEmails(emails.filter((e) => e !== email));
  };

  const handleSendInvites = async () => {
    if (emails.length === 0) {
      toast.error('No recipients', {
        description: 'Please add at least one email address',
      });
      return;
    }

    try {
      await sendInviteMutation.mutateAsync({
        meetingId,
        emails,
        message: message.trim() || undefined,
      });

      toast.success('Invitations sent', {
        description: `Sent ${emails.length} invitation${emails.length > 1 ? 's' : ''}`,
      });

      // Reset and close
      setEmails([]);
      setEmailInput('');
      setMessage('');
      onOpenChange(false);
    } catch (error: any) {
      toast.error('Failed to send invitations', {
        description: error.message || 'An error occurred',
      });
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopiedUrl(true);
      toast.success('Link copied', {
        description: 'Meeting link copied to clipboard',
      });
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      toast.error('Failed to copy', {
        description: 'Could not copy link to clipboard',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite to Meeting</DialogTitle>
          <DialogDescription>{meetingTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Meeting link */}
          <div className="space-y-2">
            <Label>Meeting Link</Label>
            <div className="flex gap-2">
              <Input value={joinUrl} readOnly className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyUrl}
                className="shrink-0"
              >
                {copiedUrl ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Email input */}
          <div className="space-y-2">
            <Label>Invite by Email</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="email@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddEmail();
                  }
                }}
                className="flex-1"
              />
              <Button onClick={handleAddEmail} variant="outline" size="sm">
                Add
              </Button>
            </div>

            {/* Email badges */}
            {emails.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {emails.map((email) => (
                  <Badge key={email} variant="secondary" className="gap-1">
                    {email}
                    <button
                      onClick={() => handleRemoveEmail(email)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Custom message */}
          <div className="space-y-2">
            <Label>Custom Message (Optional)</Label>
            <Textarea
              placeholder="Add a personal message to the invitation..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSendInvites}
            disabled={emails.length === 0 || sendInviteMutation.isPending}
          >
            {sendInviteMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                Send {emails.length > 0 && `(${emails.length})`}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
