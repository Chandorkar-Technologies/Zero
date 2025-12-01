import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminTokenAsync } from '@/lib/auth';

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

  return NextResponse.json({ success: true });
}
