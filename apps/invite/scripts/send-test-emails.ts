/**
 * Send test invite emails to verify all templates are working
 */

import {
  getWelcomeEmailHtml,
  getReferralNotificationHtml,
  getInvitationEmailHtml,
} from '../lib/email';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TEST_EMAIL = 'ninad@hostingduty.com';
const TEST_NAME = 'Ninad';

if (!RESEND_API_KEY) {
  console.error('RESEND_API_KEY is required');
  process.exit(1);
}

interface EmailTemplate {
  name: string;
  subject: string;
  html: string;
}

async function sendEmail(template: EmailTemplate): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Nubo <hello@nubo.email>',
      to: TEST_EMAIL,
      subject: `[TEST] ${template.subject}`,
      html: template.html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send ${template.name}: ${await response.text()}`);
  }

  const data = await response.json() as { id?: string };
  console.log(`✓ Sent ${template.name}: ${data.id || 'success'}`);
}

async function sendAllTestEmails() {
  const templates: EmailTemplate[] = [
    {
      name: 'Waitlist Welcome (Nubo Pro)',
      subject: 'Welcome to the Nubo Waitlist',
      html: getWelcomeEmailHtml({
        name: TEST_NAME,
        position: 42,
        referralCode: 'TEST123',
        referralLink: 'https://join.nubo.email?ref=TEST123',
        plan: 'nubo',
      }),
    },
    {
      name: 'Waitlist Welcome (Workplace)',
      subject: 'Welcome to the Nubo Workplace Waitlist',
      html: getWelcomeEmailHtml({
        name: TEST_NAME,
        position: 15,
        referralCode: 'WORK456',
        referralLink: 'https://join.nubo.email?ref=WORK456',
        plan: 'workplace',
      }),
    },
    {
      name: 'Referral Notification (1 referral)',
      subject: 'You got a referral!',
      html: getReferralNotificationHtml({
        name: TEST_NAME,
        newReferralCount: 1,
        newPosition: 35,
        referralLink: 'https://join.nubo.email?ref=TEST123',
      }),
    },
    {
      name: 'Referral Notification (3 referrals - Early Access)',
      subject: 'You got a referral! Early Access Unlocked!',
      html: getReferralNotificationHtml({
        name: TEST_NAME,
        newReferralCount: 3,
        newPosition: 10,
        referralLink: 'https://join.nubo.email?ref=TEST123',
      }),
    },
    {
      name: 'You\'re In! (Nubo Pro)',
      subject: 'You\'re In! Welcome to Nubo Pro',
      html: getInvitationEmailHtml({
        name: TEST_NAME,
        plan: 'nubo',
      }),
    },
    {
      name: 'You\'re In! (Workplace)',
      subject: 'You\'re In! Welcome to Nubo Workplace',
      html: getInvitationEmailHtml({
        name: TEST_NAME,
        plan: 'workplace',
      }),
    },
  ];

  console.log(`Sending ${templates.length} test invite emails to ${TEST_EMAIL}...`);

  for (const template of templates) {
    try {
      await sendEmail(template);
    } catch (error) {
      console.error(`✗ Failed to send ${template.name}:`, error);
    }

    // Small delay to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('\nDone! Check your inbox at', TEST_EMAIL);
}

sendAllTestEmails().catch(console.error);
