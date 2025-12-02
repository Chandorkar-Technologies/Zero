import postgres from 'postgres';

const sql = postgres('postgresql://neondb_owner:npg_SMxr57hJCvpy@ep-delicate-king-ah7ift2i-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require');

async function main() {
  try {
    const connectionId = 'a257189a-9486-41c9-93af-a3e6803f225f';

    console.log('=== CONNECTION DETAILS ===');
    const connections = await sql`
      SELECT id, email, provider_id, created_at
      FROM mail0_connection
      WHERE id = ${connectionId}
    `;
    console.log(connections);

    console.log('\n=== CURRENT EMAIL READ STATUS ===');
    const emails = await sql`
      SELECT thread_id, subject, is_read, updated_at
      FROM mail0_email
      WHERE connection_id = ${connectionId}
      ORDER BY internal_date DESC
      LIMIT 10
    `;

    emails.forEach(e => {
      const status = e.is_read ? 'READ' : 'UNREAD';
      const subject = e.subject?.substring(0, 45) || 'No subject';
      console.log(`[${status}] Thread ${e.thread_id}: ${subject}`);
    });

    await sql.end();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
