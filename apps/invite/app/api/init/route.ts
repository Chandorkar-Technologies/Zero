import { NextRequest, NextResponse } from 'next/server';
import { initDatabase } from '@/lib/db';
import { verifyAdminTokenAsync } from '@/lib/auth';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  // This endpoint initializes the database tables
  // It's protected by admin auth to prevent abuse

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token || !(await verifyAdminTokenAsync(token))) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    await initDatabase();
    return NextResponse.json({ success: true, message: 'Database initialized' });
  } catch (error) {
    console.error('Database init error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to initialize database' },
      { status: 500 }
    );
  }
}

// Allow one-time init without auth for initial setup
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');

  // Simple secret to allow initial setup
  if (secret !== 'init-nubo-2025') {
    return NextResponse.json(
      { success: false, error: 'Invalid secret' },
      { status: 401 }
    );
  }

  try {
    await initDatabase();
    return NextResponse.json({ success: true, message: 'Database initialized' });
  } catch (error) {
    console.error('Database init error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to initialize database', details: String(error) },
      { status: 500 }
    );
  }
}
