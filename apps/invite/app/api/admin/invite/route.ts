import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminTokenAsync } from '@/lib/auth';
import { markUserInvited } from '@/lib/db';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token || !(await verifyAdminTokenAsync(token))) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      );
    }

    await markUserInvited(userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error inviting user:', error);
    return NextResponse.json(
      { success: false, error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
