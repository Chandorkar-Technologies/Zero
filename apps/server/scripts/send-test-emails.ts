/**
 * Send test emails to verify all templates are working
 */

import { Resend } from 'resend';
import {
  getEmailHtml,
  emailSubjects,
  type EmailTemplateName,
} from '../src/lib/email-templates.generated';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TEST_EMAIL = 'ninad@hostingduty.com';
const TEST_NAME = 'Ninad';

if (!RESEND_API_KEY) {
  console.error('RESEND_API_KEY is required');
  process.exit(1);
}

const resend = new Resend(RESEND_API_KEY);

async function sendAllTestEmails() {
  const templates: EmailTemplateName[] = [
    'welcome',
    'nuboPro',
    'autoLabeling',
    'aiWritingAssistant',
    'shortcuts',
    'categories',
    'superSearch',
    'nuboProWelcome',
    'nuboCancellation',
    'nuboWorkspace',
  ];

  console.log(`Sending ${templates.length} test emails to ${TEST_EMAIL}...`);

  for (const template of templates) {
    try {
      const result = await resend.emails.send({
        from: 'Nubo <onboarding@nubo.email>',
        to: TEST_EMAIL,
        subject: `[TEST] ${emailSubjects[template]}`,
        html: getEmailHtml(template, TEST_NAME),
      });

      console.log(`✓ Sent ${template}: ${result.data?.id || 'success'}`);
    } catch (error) {
      console.error(`✗ Failed to send ${template}:`, error);
    }

    // Small delay to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('\nDone! Check your inbox at', TEST_EMAIL);
}

sendAllTestEmails().catch(console.error);
