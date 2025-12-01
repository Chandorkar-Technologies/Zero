import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminTokenAsync } from '@/lib/auth';
import { getStats } from '@/lib/db';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token || !(await verifyAdminTokenAsync(token))) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const stats = await getStats();
    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { success: false, error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
