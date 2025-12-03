import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { SettingsCard } from '@/components/settings/settings-card';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSession, authClient } from '@/lib/auth-client';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { m } from '@/paraglide/messages';
import { useForm } from 'react-hook-form';
import { CheckCircle, AlertCircle, Mail } from 'lucide-react';
import { toast } from 'sonner';

import { useState } from 'react';
import * as z from 'zod';

const formSchema = z.object({
  twoFactorAuth: z.boolean(),
  loginNotifications: z.boolean(),
});

export default function SecurityPage() {
  const [isSaving, setIsSaving] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const { data: session } = useSession();

  const handleResendVerification = async () => {
    if (!session?.user?.email) return;

    setIsResendingVerification(true);
    try {
      await authClient.sendVerificationEmail({
        email: session.user.email,
        callbackURL: `${window.location.origin}/settings/connections`,
      });
      toast.success('Verification email sent! Please check your inbox.');
    } catch {
      toast.error('Failed to send verification email. Please try again.');
    } finally {
      setIsResendingVerification(false);
    }
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      twoFactorAuth: false,
      loginNotifications: true,
    },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSaving(true);

    // TODO: Save settings in user's account
    setTimeout(() => {
      console.log(values);
      setIsSaving(false);
    }, 1000);
  }

  return (
    <div className="grid gap-6">
      {/* Email Verification Status Card */}
      <SettingsCard
        title="Email Verification"
        description="Verify your email address to secure your account."
      >
        <div className="space-y-4">
          {session?.user ? (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{session.user.email}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {session.user.emailVerified ? (
                      <Badge variant="outline" className="text-green-600 border-green-600 gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Verified
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-yellow-600 border-yellow-600 gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Not verified
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              {!session.user.emailVerified && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResendVerification}
                  disabled={isResendingVerification}
                >
                  {isResendingVerification ? 'Sending...' : 'Resend verification email'}
                </Button>
              )}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Loading...</div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard
        title={m['pages.settings.security.title']()}
        description={m['pages.settings.security.description']()}
        footer={
          <div className="flex gap-4">
            <Button variant="destructive">{m['pages.settings.security.deleteAccount']()}</Button>
            <Button type="submit" form="security-form" disabled={isSaving}>
              {isSaving ? m['common.actions.saving']() : m['common.actions.saveChanges']()}
            </Button>
          </div>
        }
      >
        <Form {...form}>
          <form id="security-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="flex w-full flex-col items-center gap-5 md:flex-row">
              <FormField
                control={form.control}
                name="twoFactorAuth"
                render={({ field }) => (
                  <FormItem className="bg-popover flex w-full flex-row items-center justify-between rounded-lg border p-4 md:w-auto">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                      {m['pages.settings.security.twoFactorAuth']()}
                      </FormLabel>
                      <FormDescription>
                      {m['pages.settings.security.twoFactorAuthDescription']()}
                      </FormDescription>
                    </div>
                    <FormControl className="ml-4">
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="loginNotifications"
                render={({ field }) => (
                  <FormItem className="bg-popover flex w-full flex-row items-center justify-between rounded-lg border p-4 md:w-auto">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                      {m['pages.settings.security.loginNotifications']()}
                      </FormLabel>
                      <FormDescription>
                      {m['pages.settings.security.loginNotificationsDescription']()}
                      </FormDescription>
                    </div>
                    <FormControl className="ml-4">
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </form>
        </Form>
      </SettingsCard>
    </div>
  );
}
