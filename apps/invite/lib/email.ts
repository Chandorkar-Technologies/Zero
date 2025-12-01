// Email templates and sending utilities
// Uses Resend for email delivery (configure RESEND_API_KEY in env)

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Nubo <hello@nubo.email>';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured, skipping email:', options.to);
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: options.to,
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!response.ok) {
      console.error('Email send failed:', await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('Email send error:', error);
    return false;
  }
}

export function getWelcomeEmailHtml(data: {
  name?: string;
  position: number;
  referralCode: string;
  referralLink: string;
  plan: 'nubo' | 'workplace';
}): string {
  const planName = data.plan === 'nubo' ? 'Nubo Pro' : 'Nubo Workplace';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Nubo</title>
</head>
<body style="margin: 0; padding: 0; background-color: #000; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #000; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <span style="font-size: 28px; font-weight: bold; color: #fff;">Nubo</span>
              <span style="background: linear-gradient(90deg, #FF9933, #138808); padding: 4px 12px; border-radius: 20px; font-size: 12px; color: #fff; margin-left: 10px;">Made in Bharat</span>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="background: rgba(255,255,255,0.05); border-radius: 16px; padding: 40px;">
              <h1 style="color: #fff; margin: 0 0 20px; font-size: 24px;">
                ${data.name ? `Welcome, ${data.name}!` : 'Welcome to the Revolution!'}
              </h1>

              <p style="color: #9ca3af; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                You're now on the Nubo waitlist for <strong style="color: #fff;">${planName}</strong>. India's own AI-powered email and productivity platform is coming soon.
              </p>

              <div style="background: rgba(255,153,51,0.1); border-radius: 12px; padding: 20px; margin: 30px 0; text-align: center;">
                <p style="color: #9ca3af; margin: 0 0 10px; font-size: 14px;">Your position on the waitlist</p>
                <span style="font-size: 48px; font-weight: bold; background: linear-gradient(135deg, #FF9933, #fff, #138808); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
                  #${data.position}
                </span>
              </div>

              <h2 style="color: #fff; font-size: 18px; margin: 30px 0 15px;">Want to move up? Share your link!</h2>

              <div style="background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px; margin: 0 0 20px;">
                <code style="color: #FF9933; font-size: 14px; word-break: break-all;">${data.referralLink}</code>
              </div>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0;">
                <tr>
                  <td style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; text-align: center; width: 30%;">
                    <div style="color: #FF9933; font-weight: bold; font-size: 16px;">1 referral</div>
                    <div style="color: #9ca3af; font-size: 12px;">+100 spots up</div>
                  </td>
                  <td width="5%"></td>
                  <td style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; text-align: center; width: 30%;">
                    <div style="color: #FF9933; font-weight: bold; font-size: 16px;">3 referrals</div>
                    <div style="color: #9ca3af; font-size: 12px;">Early access</div>
                  </td>
                  <td width="5%"></td>
                  <td style="background: rgba(255,255,255,0.05); border-radius: 8px; padding: 15px; text-align: center; width: 30%;">
                    <div style="color: #FF9933; font-weight: bold; font-size: 16px;">5 referrals</div>
                    <div style="color: #9ca3af; font-size: 12px;">+2GB storage</div>
                  </td>
                </tr>
              </table>

              <a href="${data.referralLink}" style="display: block; background: linear-gradient(90deg, #FF9933, #138808); color: #000; font-weight: bold; text-align: center; padding: 16px; border-radius: 12px; text-decoration: none; font-size: 16px; margin-top: 30px;">
                Share & Move Up
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 0; text-align: center;">
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px;">
                Built with ❤️ in India
              </p>
              <p style="color: #4b5563; font-size: 12px; margin: 0;">
                © 2025 Nubo Technologies Pvt. Ltd.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

export function getReferralNotificationHtml(data: {
  name?: string;
  newReferralCount: number;
  newPosition: number;
  referralLink: string;
}): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You got a referral!</title>
</head>
<body style="margin: 0; padding: 0; background-color: #000; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #000; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <span style="font-size: 28px; font-weight: bold; color: #fff;">Nubo</span>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="background: rgba(255,255,255,0.05); border-radius: 16px; padding: 40px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 20px;">🎉</div>

              <h1 style="color: #fff; margin: 0 0 20px; font-size: 24px;">
                Someone joined using your link!
              </h1>

              <p style="color: #9ca3af; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
                ${data.name ? `Great job, ${data.name}!` : 'Great job!'} You now have <strong style="color: #FF9933;">${data.newReferralCount} referral${data.newReferralCount > 1 ? 's' : ''}</strong> and your new position is <strong style="color: #138808;">#${data.newPosition}</strong>.
              </p>

              ${data.newReferralCount >= 3 ? `
              <div style="background: rgba(19,136,8,0.2); border-radius: 12px; padding: 20px; margin: 0 0 30px;">
                <p style="color: #22c55e; font-weight: bold; margin: 0;">
                  🚀 You've unlocked Early Access!
                </p>
              </div>
              ` : ''}

              <p style="color: #9ca3af; font-size: 14px; margin: 0 0 20px;">
                Keep sharing to unlock more rewards:
              </p>

              <a href="${data.referralLink}" style="display: inline-block; background: linear-gradient(90deg, #FF9933, #138808); color: #000; font-weight: bold; padding: 14px 30px; border-radius: 10px; text-decoration: none; font-size: 14px;">
                Share Your Link
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 0; text-align: center;">
              <p style="color: #4b5563; font-size: 12px; margin: 0;">
                © 2025 Nubo Technologies Pvt. Ltd.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

export function getInvitationEmailHtml(data: {
  name?: string;
  plan: 'nubo' | 'workplace';
}): string {
  const planName = data.plan === 'nubo' ? 'Nubo Pro' : 'Nubo Workplace';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're In! Welcome to Nubo</title>
</head>
<body style="margin: 0; padding: 0; background-color: #000; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #000; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <span style="font-size: 28px; font-weight: bold; color: #fff;">Nubo</span>
              <span style="background: linear-gradient(90deg, #FF9933, #138808); padding: 4px 12px; border-radius: 20px; font-size: 12px; color: #fff; margin-left: 10px;">Made in Bharat</span>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="background: rgba(255,255,255,0.05); border-radius: 16px; padding: 40px; text-align: center;">
              <div style="font-size: 64px; margin-bottom: 20px;">🎊</div>

              <h1 style="color: #fff; margin: 0 0 20px; font-size: 28px;">
                You're In!
              </h1>

              <p style="color: #9ca3af; font-size: 18px; line-height: 1.6; margin: 0 0 30px;">
                ${data.name ? `Congratulations ${data.name}!` : 'Congratulations!'} Your wait is over. Welcome to <strong style="color: #fff;">${planName}</strong>.
              </p>

              <div style="background: linear-gradient(135deg, rgba(255,153,51,0.2), rgba(19,136,8,0.2)); border-radius: 12px; padding: 30px; margin: 0 0 30px;">
                <p style="color: #fff; font-size: 16px; margin: 0;">
                  Click below to set up your account and start using India's own AI-powered productivity platform.
                </p>
              </div>

              <a href="https://nubo.email/login" style="display: inline-block; background: linear-gradient(90deg, #FF9933, #138808); color: #000; font-weight: bold; padding: 16px 40px; border-radius: 12px; text-decoration: none; font-size: 18px;">
                Get Started Now
              </a>

              <p style="color: #6b7280; font-size: 14px; margin: 30px 0 0;">
                Thank you for believing in the Make in India vision.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 0; text-align: center;">
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px;">
                Built with ❤️ in India
              </p>
              <p style="color: #4b5563; font-size: 12px; margin: 0;">
                © 2025 Nubo Technologies Pvt. Ltd.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}
