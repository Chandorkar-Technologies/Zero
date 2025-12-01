import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminTokenAsync } from '@/lib/auth';
import { getAllUsers } from '@/lib/db';

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
    const users = await getAllUsers();

    // Generate CSV
    const headers = [
      'Position',
      'Email',
      'Name',
      'Plan',
      'Referral Code',
      'Referral Count',
      'Bonus Storage (GB)',
      'Has Early Access',
      'Invited At',
      'Created At',
    ];

    const rows = users.map((u) => [
      u.position,
      u.email,
      u.name || '',
      u.plan,
      u.referralCode,
      u.referralCount,
      u.bonusStorage,
      u.hasEarlyAccess ? 'Yes' : 'No',
      u.invitedAt ? u.invitedAt.toISOString() : '',
      u.createdAt.toISOString(),
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="nubo-waitlist-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error exporting users:', error);
    return NextResponse.json(
      { success: false, error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
