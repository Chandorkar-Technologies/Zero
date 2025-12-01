// Database utilities using Neon PostgreSQL
import { neon } from '@neondatabase/serverless';
import { nanoid } from 'nanoid';

// Database connection
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_SMxr57hJCvpy@ep-delicate-king-ah7ift2i-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';

const sql = neon(DATABASE_URL);

export interface WaitlistUser {
  id: string;
  email: string;
  name: string | null;
  referralCode: string;
  referredBy: string | null;
  position: number;
  referralCount: number;
  bonusStorage: number; // in GB
  hasEarlyAccess: boolean;
  plan: 'nubo' | 'workplace';
  createdAt: Date;
  invitedAt: Date | null;
}

export interface Referral {
  id: string;
  referrerId: string;
  referredId: string;
  createdAt: Date;
}

export function generateReferralCode(): string {
  return nanoid(8);
}

// Initialize database tables
export async function initDatabase(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS nubo_waitlist_users (
      id VARCHAR(21) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255),
      referral_code VARCHAR(10) UNIQUE NOT NULL,
      referred_by VARCHAR(10),
      position INTEGER NOT NULL,
      referral_count INTEGER DEFAULT 0,
      bonus_storage INTEGER DEFAULT 0,
      has_early_access BOOLEAN DEFAULT FALSE,
      plan VARCHAR(20) NOT NULL CHECK (plan IN ('nubo', 'workplace')),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      invited_at TIMESTAMP WITH TIME ZONE
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nubo_waitlist_referrals (
      id VARCHAR(21) PRIMARY KEY,
      referrer_id VARCHAR(21) NOT NULL REFERENCES nubo_waitlist_users(id),
      referred_id VARCHAR(21) NOT NULL REFERENCES nubo_waitlist_users(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `;

  // Create indexes if they don't exist
  await sql`CREATE INDEX IF NOT EXISTS idx_waitlist_email ON nubo_waitlist_users(email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_waitlist_referral_code ON nubo_waitlist_users(referral_code)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_waitlist_position ON nubo_waitlist_users(position)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_waitlist_plan ON nubo_waitlist_users(plan)`;
}

// Helper to convert row to WaitlistUser
function rowToUser(row: Record<string, unknown>): WaitlistUser {
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string | null,
    referralCode: row.referral_code as string,
    referredBy: row.referred_by as string | null,
    position: row.position as number,
    referralCount: row.referral_count as number,
    bonusStorage: row.bonus_storage as number,
    hasEarlyAccess: row.has_early_access as boolean,
    plan: row.plan as 'nubo' | 'workplace',
    createdAt: new Date(row.created_at as string),
    invitedAt: row.invited_at ? new Date(row.invited_at as string) : null,
  };
}

export async function createUser(data: {
  email: string;
  name?: string;
  referredBy?: string;
  plan: 'nubo' | 'workplace';
}): Promise<WaitlistUser> {
  // Check if email already exists
  const existing = await sql`
    SELECT * FROM nubo_waitlist_users WHERE LOWER(email) = LOWER(${data.email})
  `;

  if (existing.length > 0) {
    return rowToUser(existing[0]);
  }

  // Get next position
  const countResult = await sql`SELECT COUNT(*) as count FROM nubo_waitlist_users`;
  const position = Number(countResult[0].count) + 1;

  const id = nanoid();
  const referralCode = generateReferralCode();

  await sql`
    INSERT INTO nubo_waitlist_users (id, email, name, referral_code, referred_by, position, plan)
    VALUES (${id}, ${data.email.toLowerCase()}, ${data.name || null}, ${referralCode}, ${data.referredBy || null}, ${position}, ${data.plan})
  `;

  // If referred by someone, update their referral count
  if (data.referredBy) {
    const referrer = await sql`
      SELECT * FROM nubo_waitlist_users WHERE referral_code = ${data.referredBy}
    `;

    if (referrer.length > 0) {
      const referrerId = referrer[0].id as string;
      const newRefCount = (referrer[0].referral_count as number) + 1;
      let hasEarlyAccess = referrer[0].has_early_access as boolean;
      let bonusStorage = referrer[0].bonus_storage as number;
      let newPosition = referrer[0].position as number;

      // Apply referral benefits
      if (newRefCount >= 1) {
        newPosition = Math.max(1, newPosition - 100);
      }
      if (newRefCount >= 3) {
        hasEarlyAccess = true;
      }
      if (newRefCount >= 5) {
        bonusStorage = Math.min(10, bonusStorage + 2);
      }

      await sql`
        UPDATE nubo_waitlist_users
        SET referral_count = ${newRefCount},
            position = ${newPosition},
            has_early_access = ${hasEarlyAccess},
            bonus_storage = ${bonusStorage}
        WHERE id = ${referrerId}
      `;

      // Create referral record
      await sql`
        INSERT INTO nubo_waitlist_referrals (id, referrer_id, referred_id)
        VALUES (${nanoid()}, ${referrerId}, ${id})
      `;
    }
  }

  // Fetch and return the created user
  const created = await sql`SELECT * FROM nubo_waitlist_users WHERE id = ${id}`;
  return rowToUser(created[0]);
}

export async function getUserByEmail(email: string): Promise<WaitlistUser | null> {
  const result = await sql`
    SELECT * FROM nubo_waitlist_users WHERE LOWER(email) = LOWER(${email})
  `;
  return result.length > 0 ? rowToUser(result[0]) : null;
}

export async function getUserByReferralCode(code: string): Promise<WaitlistUser | null> {
  const result = await sql`
    SELECT * FROM nubo_waitlist_users WHERE referral_code = ${code}
  `;
  return result.length > 0 ? rowToUser(result[0]) : null;
}

export async function getUserById(id: string): Promise<WaitlistUser | null> {
  const result = await sql`
    SELECT * FROM nubo_waitlist_users WHERE id = ${id}
  `;
  return result.length > 0 ? rowToUser(result[0]) : null;
}

export async function getTotalUsers(): Promise<number> {
  const result = await sql`SELECT COUNT(*) as count FROM nubo_waitlist_users`;
  return Number(result[0].count);
}

export async function getStats(): Promise<{
  total: number;
  nubo: number;
  workplace: number;
  earlyAccess: number;
  invited: number;
  todaySignups: number;
}> {
  const total = await sql`SELECT COUNT(*) as count FROM nubo_waitlist_users`;
  const nubo = await sql`SELECT COUNT(*) as count FROM nubo_waitlist_users WHERE plan = 'nubo'`;
  const workplace = await sql`SELECT COUNT(*) as count FROM nubo_waitlist_users WHERE plan = 'workplace'`;
  const earlyAccess = await sql`SELECT COUNT(*) as count FROM nubo_waitlist_users WHERE has_early_access = true`;
  const invited = await sql`SELECT COUNT(*) as count FROM nubo_waitlist_users WHERE invited_at IS NOT NULL`;
  const todaySignups = await sql`SELECT COUNT(*) as count FROM nubo_waitlist_users WHERE created_at >= CURRENT_DATE`;

  return {
    total: Number(total[0].count),
    nubo: Number(nubo[0].count),
    workplace: Number(workplace[0].count),
    earlyAccess: Number(earlyAccess[0].count),
    invited: Number(invited[0].count),
    todaySignups: Number(todaySignups[0].count),
  };
}

export async function searchUsers(options: {
  page: number;
  perPage: number;
  search: string;
  plan: 'all' | 'nubo' | 'workplace';
  status: 'all' | 'early' | 'invited';
}): Promise<{
  users: WaitlistUser[];
  totalPages: number;
  total: number;
}> {
  const offset = (options.page - 1) * options.perPage;

  // Get all users and filter in memory for simplicity with Edge runtime
  let result = await sql`SELECT * FROM nubo_waitlist_users ORDER BY position ASC`;
  let users = result.map(row => rowToUser(row));

  // Apply search filter
  if (options.search) {
    const search = options.search.toLowerCase();
    users = users.filter(u =>
      u.email.toLowerCase().includes(search) ||
      u.name?.toLowerCase().includes(search) ||
      u.referralCode.toLowerCase().includes(search)
    );
  }

  // Apply plan filter
  if (options.plan !== 'all') {
    users = users.filter(u => u.plan === options.plan);
  }

  // Apply status filter
  if (options.status === 'early') {
    users = users.filter(u => u.hasEarlyAccess);
  } else if (options.status === 'invited') {
    users = users.filter(u => u.invitedAt !== null);
  }

  const total = users.length;
  const totalPages = Math.ceil(total / options.perPage);

  return {
    users: users.slice(offset, offset + options.perPage),
    totalPages,
    total,
  };
}

export async function getAllUsers(): Promise<WaitlistUser[]> {
  const result = await sql`SELECT * FROM nubo_waitlist_users ORDER BY position ASC`;
  return result.map(row => rowToUser(row));
}

export async function markUserInvited(userId: string): Promise<void> {
  await sql`
    UPDATE nubo_waitlist_users SET invited_at = NOW() WHERE id = ${userId}
  `;
}

export async function exportUsersCSV(): Promise<string> {
  const users = await getAllUsers();
  const headers = ['email', 'name', 'referral_code', 'position', 'referral_count', 'has_early_access', 'plan', 'created_at', 'invited_at'];
  const rows = users.map(u => [
    u.email,
    u.name || '',
    u.referralCode,
    u.position.toString(),
    u.referralCount.toString(),
    u.hasEarlyAccess ? 'yes' : 'no',
    u.plan,
    u.createdAt.toISOString(),
    u.invitedAt?.toISOString() || '',
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
