import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail } from '@/lib/db';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    const user = await getUserByEmail(email);

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Email not found on waitlist' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      user: {
        email: user.email,
        name: user.name,
        position: user.position,
        referralCode: user.referralCode,
        referralCount: user.referralCount,
        bonusStorage: user.bonusStorage,
        hasEarlyAccess: user.hasEarlyAccess,
        plan: user.plan,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error fetching status:', error);
    return NextResponse.json(
      { success: false, error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
