import { env } from '../env';
import { Redis } from '@upstash/redis';

// Cloudflare Workers-compatible Resend client using direct REST API
// The official Resend SDK uses 'cache' in fetch options which CF Workers doesn't support
interface EmailAttachment {
  filename: string;
  content: string; // Base64 encoded content
  content_type?: string;
}

interface SendEmailOptions {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  react?: unknown; // Accept react but skip rendering - not CF Workers compatible yet
  scheduledAt?: string;
  attachments?: EmailAttachment[];
}

interface ResendResponse {
  id?: string;
  error?: { message: string; name: string };
}

const createResendClient = (apiKey: string) => {
  const send = async (options: SendEmailOptions): Promise<ResendResponse> => {
    const html = options.html;

    // Skip React emails for now - @react-email/render uses cache which CF Workers doesn't support
    // TODO: Pre-render emails at build time or use a different rendering approach
    if (!html && options.react) {
      console.log('Skipping React email - not yet supported in CF Workers:', options.subject);
      return { id: 'skipped' };
    }

    if (!html) {
      console.error('No HTML provided for email:', options.subject);
      return { id: 'skipped-no-html' };
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: options.from,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html,
        ...(options.scheduledAt && { scheduled_at: options.scheduledAt }),
        ...(options.attachments && { attachments: options.attachments }),
      }),
    });

    const data = await response.json() as ResendResponse;

    if (!response.ok) {
      console.error('Resend API error:', data);
      throw new Error(data.error?.message || 'Failed to send email');
    }

    return data;
  };

  return {
    emails: {
      send,
    },
  };
};

export const resend = () =>
  env.RESEND_API_KEY
    ? createResendClient(env.RESEND_API_KEY)
    : { emails: { send: async (...args: unknown[]) => console.log(args) } };

export const redis = () => new Redis({ url: env.REDIS_URL, token: env.REDIS_TOKEN });

export const twilio = () => {
  //   if (env.NODE_ENV === 'development' && !forceUseRealService) {
  //     return {
  //       messages: {
  //         send: async (to: string, body: string) =>
  //           console.log(`[TWILIO:MOCK] Sending message to ${to}: ${body}`),
  //       },
  //     };
  //   }

  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
    throw new Error('Twilio is not configured correctly');
  }

  const send = async (to: string, body: string) => {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
        },
        body: new URLSearchParams({
          To: to,
          From: env.TWILIO_PHONE_NUMBER,
          Body: body,
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send OTP: ${error}`);
    }
  };

  return {
    messages: {
      send,
    },
  };
};
