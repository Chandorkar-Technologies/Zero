import { NextRequest, NextResponse } from 'next/server';
import { createUser, getUserByEmail, getTotalUsers } from '@/lib/db';
import { sendEmail, getWelcomeEmailHtml } from '@/lib/email';

export const runtime = 'edge';

const MAX_EARLY_ACCESS = parseInt(process.env.MAX_EARLY_ACCESS_USERS || '10000', 10);

// Rate limiting (simple in-memory, use Redis in production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60000 }); // 1 minute window
    return false;
  }

  if (entry.count >= 5) {
    return true;
  }

  entry.count++;
  return false;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    if (isRateLimited(ip)) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { email, name, plan, referredBy } = body;

    // Validate email
    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { success: false, error: 'Please provide a valid email address.' },
        { status: 400 }
      );
    }

    // Validate plan
    if (!plan || !['nubo', 'workplace'].includes(plan)) {
      return NextResponse.json(
        { success: false, error: 'Please select a valid plan.' },
        { status: 400 }
      );
    }

    // Check if waitlist is full
    const totalUsers = await getTotalUsers();
    if (totalUsers >= MAX_EARLY_ACCESS) {
      return NextResponse.json(
        {
          success: false,
          error: 'The early access waitlist is full! We\'ll notify you when more spots open.',
          waitlistFull: true,
        },
        { status: 200 }
      );
    }

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return NextResponse.json({
        success: true,
        existing: true,
        position: existingUser.position,
        referralCode: existingUser.referralCode,
        referralCount: existingUser.referralCount,
        hasEarlyAccess: existingUser.hasEarlyAccess,
      });
    }

    // Create new user
    const user = await createUser({
      email,
      name: name || undefined,
      plan,
      referredBy: referredBy || undefined,
    });

    // Send welcome email (non-blocking)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://invite.nubo.email';
    const referralLink = `${baseUrl}?ref=${user.referralCode}`;

    sendEmail({
      to: email,
      subject: `You're #${user.position} on the Nubo waitlist!`,
      html: getWelcomeEmailHtml({
        name: name || undefined,
        position: user.position,
        referralCode: user.referralCode,
        referralLink,
        plan: plan as 'nubo' | 'workplace',
      }),
    }).catch((err) => console.error('Failed to send welcome email:', err));

    return NextResponse.json({
      success: true,
      position: user.position,
      referralCode: user.referralCode,
      referralCount: 0,
      hasEarlyAccess: false,
    });
  } catch (error) {
    console.error('Error joining waitlist:', error);
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
