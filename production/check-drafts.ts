import postgres from 'postgres';

const sql = postgres('postgresql://neondb_owner:npg_SMxr57hJCvpy@ep-delicate-king-ah7ift2i-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require');

async function main() {
  try {
    const connectionId = 'a257189a-9486-41c9-93af-a3e6803f225f';

    console.log('=== CHECKING ALL EMAILS FOR IMAP CONNECTION ===');
    const emails = await sql`
      SELECT id, thread_id, subject, "to", labels, created_at
      FROM mail0_email
      WHERE connection_id = ${connectionId}
      ORDER BY created_at DESC
      LIMIT 30
    `;
    
    console.log('Emails found:', emails.length);
    emails.forEach(e => {
      const to = e.to ? JSON.stringify(e.to) : 'No Recipient';
      const labels = e.labels ? JSON.stringify(e.labels) : '[]';
      console.log(`ID: ${e.id}, Thread: ${e.thread_id}`);
      console.log(`  Subject: "${e.subject || 'No Subject'}"`);
      console.log(`  To: ${to}`);
      console.log(`  Labels: ${labels}`);
      console.log('---');
    });

    await sql.end();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
