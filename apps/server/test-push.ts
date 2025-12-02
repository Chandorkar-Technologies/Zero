/**
 * Test script for push notifications
 * Run with: DATABASE_URL="..." npx tsx test-push.ts
 */

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

console.log('Connecting to database...');
const sql = postgres(DATABASE_URL);

async function testPush() {
  console.log('Testing push notification functionality...\n');

  // 1. Check if push_subscription table exists and has data
  console.log('1. Checking mail0_push_subscription table...');
  try {
    const subscriptions = await sql`
      SELECT id, user_id, endpoint, p256dh, auth, device_name, created_at
      FROM mail0_push_subscription
      LIMIT 5
    `;

    console.log(`Found ${subscriptions.length} subscription(s):`);
    for (const sub of subscriptions) {
      console.log(`  - ID: ${sub.id}`);
      console.log(`    User ID: ${sub.user_id}`);
      console.log(`    Endpoint: ${sub.endpoint?.substring(0, 60)}...`);
      console.log(`    Has p256dh: ${!!sub.p256dh} (length: ${sub.p256dh?.length || 0})`);
      console.log(`    Has auth: ${!!sub.auth} (length: ${sub.auth?.length || 0})`);
      console.log(`    Device: ${sub.device_name}`);
      console.log(`    Created: ${sub.created_at}`);
      console.log('');
    }

    if (subscriptions.length === 0) {
      console.log('No subscriptions found in database. Please enable push notifications first.');
    }
  } catch (error) {
    console.error('Error querying push_subscription table:', error);
  }

  // 2. Check table schema
  console.log('\n2. Checking table schema...');
  try {
    const columns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'mail0_push_subscription'
      ORDER BY ordinal_position
    `;

    console.log('Columns:');
    for (const col of columns) {
      console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    }
  } catch (error) {
    console.error('Error checking schema:', error);
  }

  await sql.end();
  console.log('\nDone.');
}

testPush().catch(console.error);
