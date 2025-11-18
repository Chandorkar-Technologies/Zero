import { Effect } from 'effect';
import type { ImapClient, EmailMessage } from './imap-client';
import type { ZeroDB } from '../../main';
import type { ParsedMessage } from '../../types';
import type { R2Bucket } from '@cloudflare/workers-types';

/**
 * IMAP Sync Engine
 * Handles fetching emails from IMAP and storing them in R2 and database
 */

/**
 * Convert IMAP EmailMessage to ParsedMessage format
 */
export const convertImapMessageToParsedMessage = (
  email: EmailMessage,
  connectionId: string,
): ParsedMessage => {
  // Generate a thread ID based on email headers
  // Use In-Reply-To or References for threading, fallback to Message-ID
  let threadId = email.messageId;
  if (email.inReplyTo) {
    threadId = email.inReplyTo;
  } else if (email.references && email.references.length > 0) {
    threadId = email.references[0];
  }

  // Convert attachments to ParsedMessage format
  const attachments = email.attachments.map((att) => ({
    attachmentId: att.contentId || `${email.uid}-${att.filename}`,
    filename: att.filename,
    mimeType: att.contentType,
    size: att.size,
    body: '', // Attachment body will be fetched separately if needed
    headers: [],
  }));

  // Determine if email is unread based on flags
  const unread = !email.flags.includes('\\Seen');

  // Convert to ParsedMessage
  const parsedMessage: ParsedMessage = {
    id: email.messageId || `uid-${email.uid}`,
    connectionId,
    title: email.subject,
    subject: email.subject,
    tags: [], // Tags/labels will be assigned later by AI or user
    sender: {
      name: email.from[0]?.name,
      email: email.from[0]?.address || 'unknown@unknown.com',
    },
    to: email.to.map((addr) => ({
      name: addr.name,
      email: addr.address,
    })),
    cc: email.cc || null,
    bcc: email.bcc || null,
    tls: true, // IMAP connections are typically TLS
    listUnsubscribe: undefined,
    listUnsubscribePost: undefined,
    receivedOn: email.date.toISOString(),
    unread,
    body: email.bodyText || '',
    processedHtml: email.bodyHtml || email.bodyText || '',
    blobUrl: '', // Will be set after storing in R2
    decodedBody: email.bodyText,
    references: email.references?.join(' '),
    inReplyTo: email.inReplyTo,
    replyTo: email.from[0]?.address, // Use sender as reply-to by default
    messageId: email.messageId,
    threadId,
    attachments,
    isDraft: email.flags.includes('\\Draft'),
  };

  return parsedMessage;
};

/**
 * Store email in R2 bucket
 */
export const storeEmailInR2 = (
  threadsBucket: R2Bucket,
  connectionId: string,
  threadId: string,
  message: ParsedMessage,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    const key = `${connectionId}/${threadId}.json`;

    // Create thread object (similar to Gmail structure)
    const thread = {
      latest: message,
      messages: [message], // For now, just one message per thread
      // Can be extended to group multiple messages by threadId
    };

    yield* Effect.tryPromise({
      try: () =>
        threadsBucket.put(key, JSON.stringify(thread), {
          customMetadata: {
            threadId,
            connectionId,
          },
        }),
      catch: (error) => new Error(`Failed to store email in R2: ${error}`),
    });

    console.log(`Stored email in R2: ${key}`);
    return key;
  });

/**
 * Sync emails for a specific folder
 */
export const syncFolder = (
  imapClient: ImapClient,
  folderPath: string,
  connectionId: string,
  db: ZeroDB,
  threadsBucket: R2Bucket,
  options: {
    isInitialSync?: boolean;
    limit?: number;
  } = {},
): Effect.Effect<number, Error> =>
  Effect.gen(function* () {
    console.log(`Starting sync for folder: ${folderPath} (connectionId: ${connectionId})`);

    // Get sync state from database
    const syncState = yield* Effect.tryPromise({
      try: () => db.getImapSyncState(connectionId, folderPath),
      catch: (error) => new Error(`Failed to get sync state: ${error}`),
    });

    const lastSyncedUid = syncState?.lastSyncedUid || undefined;

    // Fetch emails from IMAP
    const emails = yield* imapClient.fetchEmails(folderPath, {
      lastSyncedUid,
      limit: options.limit,
    });

    console.log(`Fetched ${emails.length} emails from ${folderPath}`);

    if (emails.length === 0) {
      console.log('No new emails to sync');
      return 0;
    }

    // Process each email
    let syncedCount = 0;
    let highestUid = lastSyncedUid || 0;

    for (const email of emails) {
      // Convert to ParsedMessage format
      const parsedMessage = convertImapMessageToParsedMessage(email, connectionId);

      // Store in R2
      yield* storeEmailInR2(
        threadsBucket,
        connectionId,
        parsedMessage.threadId || parsedMessage.id,
        parsedMessage,
      );

      // Track highest UID
      if (email.uid > highestUid) {
        highestUid = email.uid;
      }

      syncedCount++;
    }

    // Update sync state
    yield* Effect.tryPromise({
      try: () =>
        db.updateImapSyncState(connectionId, folderPath, {
          lastSyncedUid: highestUid,
          lastSyncedAt: new Date(),
        }),
      catch: (error) => new Error(`Failed to update sync state: ${error}`),
    });

    console.log(`Synced ${syncedCount} emails for ${folderPath}. Last UID: ${highestUid}`);
    return syncedCount;
  });

/**
 * Perform full sync for a connection (all folders)
 */
export const syncConnection = (
  imapClient: ImapClient,
  connectionId: string,
  db: ZeroDB,
  threadsBucket: R2Bucket,
  options: {
    foldersToSync?: string[];
    isInitialSync?: boolean;
    limit?: number;
  } = {},
): Effect.Effect<{ totalSynced: number; folders: string[] }, Error> =>
  Effect.gen(function* () {
    console.log(`Starting full sync for connection: ${connectionId}`);

    // Connect to IMAP
    yield* imapClient.connect();

    // Get folders to sync
    let folders: string[];
    if (options.foldersToSync && options.foldersToSync.length > 0) {
      folders = options.foldersToSync;
    } else {
      // List all folders
      const allFolders = yield* imapClient.listFolders();
      // Filter to important folders (INBOX, Sent, etc.)
      folders = allFolders
        .filter(
          (f) =>
            f.path === 'INBOX' ||
            f.specialUse === '\\Sent' ||
            f.specialUse === '\\Drafts' ||
            f.specialUse === '\\Important',
        )
        .map((f) => f.path);

      // If no special folders found, just sync INBOX
      if (folders.length === 0) {
        folders = ['INBOX'];
      }
    }

    console.log(`Syncing folders: ${folders.join(', ')}`);

    let totalSynced = 0;

    // Sync each folder
    for (const folder of folders) {
      const synced = yield* syncFolder(imapClient, folder, connectionId, db, threadsBucket, {
        isInitialSync: options.isInitialSync,
        limit: options.limit,
      });
      totalSynced += synced;
    }

    // Disconnect
    yield* imapClient.disconnect();

    console.log(`Full sync complete. Total emails synced: ${totalSynced}`);
    return {
      totalSynced,
      folders,
    };
  });
