import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useTRPC } from '@/providers/query-provider';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

interface ImapFormData {
  email: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

interface AddImapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const AddImapDialog = ({ open, onOpenChange }: AddImapDialogProps) => {
  const trpc = useTRPC();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const [formData, setFormData] = useState<ImapFormData>({
    email: '',
    password: '',
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: true,
  });

  const { mutateAsync: discoverImap } = useMutation(trpc.connections.discoverImap.mutationOptions());
  const { mutateAsync: testImap } = useMutation(trpc.connections.testImap.mutationOptions());
  const { mutateAsync: createImap } = useMutation(trpc.connections.createImap.mutationOptions());

  const handleEmailBlur = async () => {
    if (!formData.email) return;

    setIsDiscovering(true);
    try {
      const config = await discoverImap({ email: formData.email });
      setFormData((prev) => ({
        ...prev,
        imapHost: config.imapHost,
        imapPort: config.imapPort,
        imapSecure: config.imapSecure,
        smtpHost: config.smtpHost,
        smtpPort: config.smtpPort,
        smtpSecure: config.smtpSecure,
      }));
      toast.success('Auto-discovered email settings');
    } catch (error) {
      console.error('Failed to discover email settings:', error);
      toast.error('Could not auto-discover settings. Please enter manually.');
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleTest = async () => {
    // Validate required fields
    if (!formData.email || !formData.password) {
      toast.error('Please enter email and password');
      return;
    }

    if (!formData.imapHost || !formData.smtpHost) {
      toast.error('Please enter IMAP and SMTP server settings');
      setShowAdvanced(true);
      return;
    }

    setIsTesting(true);
    try {
      const result = await testImap(formData);
      if (result.success) {
        toast.success(result.message || 'Connection test successful!');
      } else {
        toast.error(result.message || 'Connection test failed');
      }
    } catch (error: any) {
      console.error('Test connection error:', error);
      toast.error(error?.message || 'Failed to test connection. Please check your credentials.');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await createImap(formData);
      toast.success('IMAP connection created successfully!');
      onOpenChange(false);
      // Reset form
      setFormData({
        email: '',
        password: '',
        imapHost: '',
        imapPort: 993,
        imapSecure: true,
        smtpHost: '',
        smtpPort: 587,
        smtpSecure: true,
      });
    } catch (error: any) {
      console.error('Failed to create IMAP connection:', error);
      toast.error(error?.message || 'Failed to create connection. Please try again.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showOverlay={true} className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add IMAP/SMTP Email Account</DialogTitle>
          <DialogDescription>
            Connect any email account using IMAP and SMTP protocols
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="your.email@example.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              onBlur={handleEmailBlur}
              required
              disabled={isDiscovering}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Your email password or app password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
              disabled={isDiscovering}
            />
            <p className="text-xs text-muted-foreground">
              For Gmail, Yahoo, and some providers, you may need to use an app-specific password
            </p>
          </div>

          <div className="rounded-lg bg-blue-50 dark:bg-blue-950 p-3 text-xs text-blue-900 dark:text-blue-100">
            <p className="font-medium mb-1">Note about Connection Testing:</p>
            <p>
              Connection testing may timeout due to serverless environment limitations.
              If testing fails, you can still try connecting - the actual sync happens in a different environment.
            </p>
          </div>

          {/* Advanced Settings */}
          <div className="space-y-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="flex w-full items-center justify-between p-0 text-sm font-medium hover:bg-transparent"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span>Advanced Settings</span>
              {showAdvanced ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>

            {showAdvanced && (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">IMAP Settings (Incoming)</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="imapHost">Server</Label>
                      <Input
                        id="imapHost"
                        type="text"
                        placeholder="imap.example.com"
                        value={formData.imapHost}
                        onChange={(e) => setFormData({ ...formData, imapHost: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="imapPort">Port</Label>
                      <Input
                        id="imapPort"
                        type="number"
                        placeholder="993"
                        value={formData.imapPort}
                        onChange={(e) =>
                          setFormData({ ...formData, imapPort: parseInt(e.target.value) })
                        }
                        required
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium">SMTP Settings (Outgoing)</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2 space-y-2">
                      <Label htmlFor="smtpHost">Server</Label>
                      <Input
                        id="smtpHost"
                        type="text"
                        placeholder="smtp.example.com"
                        value={formData.smtpHost}
                        onChange={(e) => setFormData({ ...formData, smtpHost: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="smtpPort">Port</Label>
                      <Input
                        id="smtpPort"
                        type="number"
                        placeholder="587"
                        value={formData.smtpPort}
                        onChange={(e) =>
                          setFormData({ ...formData, smtpPort: parseInt(e.target.value) })
                        }
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleTest}
              className="flex-1"
              disabled={isTesting || isDiscovering}
            >
              {isTesting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </Button>
            <Button type="submit" className="flex-1" disabled={isDiscovering || isTesting}>
              {isDiscovering ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Discovering...
                </>
              ) : (
                'Connect'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
