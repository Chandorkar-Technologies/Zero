import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminTokenAsync } from '@/lib/auth';
import { searchUsers } from '@/lib/db';

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
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const search = searchParams.get('search') || '';
    const plan = searchParams.get('plan') as 'all' | 'nubo' | 'workplace' | null;
    const status = searchParams.get('status') as 'all' | 'early' | 'invited' | null;

    const result = await searchUsers({
      page,
      perPage: 20,
      search,
      plan: plan || 'all',
      status: status || 'all',
    });

    return NextResponse.json({
      success: true,
      users: result.users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        referralCode: u.referralCode,
        position: u.position,
        referralCount: u.referralCount,
        bonusStorage: u.bonusStorage,
        hasEarlyAccess: u.hasEarlyAccess,
        plan: u.plan,
        createdAt: u.createdAt.toISOString(),
        invitedAt: u.invitedAt?.toISOString() || null,
      })),
      totalPages: result.totalPages,
      total: result.total,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { success: false, error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
