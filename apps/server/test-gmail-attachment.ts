import { gmail as gmailApi, auth as googleAuth } from '@googleapis/gmail';
import { createDb } from './src/db';
import { connection } from './src/db/schema';
import { eq } from 'drizzle-orm';

// Test Gmail attachment fetching
async function testGmailAttachment() {
  // Get a connection from the database
  const { db } = createDb(process.env.DATABASE_URL!);

  // Find a Google connection
  const connections = await db
    .select()
    .from(connection)
    .where(eq(connection.providerId, 'google'))
    .limit(1);

  if (!connections.length) {
    console.log('No Google connections found');
    return;
  }

  const conn = connections[0];
  console.log('Found connection:', conn.email);

  // Create Gmail client with OAuth credentials
  const oauth2Client = new googleAuth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({
    access_token: conn.accessToken,
    refresh_token: conn.refreshToken,
  });

  const gmail = gmailApi({ version: 'v1', auth: oauth2Client });

  // List messages with attachments
  console.log('\nSearching for messages with attachments...');
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: 'has:attachment',
    maxResults: 5,
  });

  if (!listRes.data.messages?.length) {
    console.log('No messages with attachments found');
    return;
  }

  console.log(`Found ${listRes.data.messages.length} messages with attachments`);

  // Get the first message
  const messageId = listRes.data.messages[0].id!;
  console.log('\nFetching message:', messageId);

  const msgRes = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
  });

  console.log('Message subject:', msgRes.data.payload?.headers?.find(h => h.name === 'Subject')?.value);

  // Find attachments
  function findAttachments(parts: any[]): any[] {
    let results: any[] = [];
    for (const part of parts) {
      if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
        results.push(part);
      }
      if (part.parts && Array.isArray(part.parts)) {
        results = results.concat(findAttachments(part.parts));
      }
    }
    return results;
  }

  const attachmentParts = msgRes.data.payload?.parts
    ? findAttachments(msgRes.data.payload.parts)
    : [];

  console.log(`\nFound ${attachmentParts.length} attachments in message`);

  if (!attachmentParts.length) {
    console.log('No attachments found');
    return;
  }

  // Fetch the first attachment
  const attachmentPart = attachmentParts[0];
  console.log('\nFetching attachment:', {
    filename: attachmentPart.filename,
    mimeType: attachmentPart.mimeType,
    size: attachmentPart.body?.size,
    attachmentId: attachmentPart.body?.attachmentId,
  });

  const attachRes = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: messageId,
    id: attachmentPart.body.attachmentId,
  });

  console.log('\nAttachment response:');
  console.log('- data length:', attachRes.data.data?.length || 0);
  console.log('- size:', attachRes.data.size);
  console.log('- data preview (first 100 chars):', attachRes.data.data?.substring(0, 100));

  // Try to decode
  if (attachRes.data.data) {
    // Convert base64url to base64
    let base64 = attachRes.data.data.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) {
      base64 += '='.repeat(4 - pad);
    }

    try {
      const buffer = Buffer.from(base64, 'base64');
      console.log('\nDecoded successfully:');
      console.log('- buffer length:', buffer.length);
      console.log('- matches expected size:', buffer.length === attachmentPart.body?.size);
    } catch (e) {
      console.log('Failed to decode:', e);
    }
  }
}

testGmailAttachment().catch(console.error);
