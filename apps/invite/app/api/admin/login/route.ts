import { NextRequest, NextResponse } from 'next/server';
import { createAdminToken } from '@/lib/auth';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const password = body?.password;

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Password is required' },
        { status: 400 }
      );
    }

    const token = await createAdminToken(password);

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Invalid password' },
        { status: 401 }
      );
    }

    return NextResponse.json({ success: true, token });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Login error:', errorMessage);
    return NextResponse.json(
      { success: false, error: 'Something went wrong', details: errorMessage },
      { status: 500 }
    );
  }
}
