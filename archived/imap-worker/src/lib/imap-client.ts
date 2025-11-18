import { Effect } from 'effect';
import { ImapFlow } from 'imapflow';
import type { FetchMessageObject, FetchQueryObject, MailboxObject } from 'imapflow';
import { decryptPassword } from './encryption';
import type { ZeroDB } from '../../main';

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface EmailMessage {
  uid: number;
  messageId: string;
  subject: string;
  from: Array<{ name?: string; address: string }>;
  to: Array<{ name?: string; address: string }>;
  cc?: Array<{ name?: string; address: string }>;
  bcc?: Array<{ name?: string; address: string }>;
  date: Date;
  bodyText?: string;
  bodyHtml?: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    contentId?: string;
  }>;
  inReplyTo?: string;
  references?: string[];
  flags: string[];
  labels?: string[];
}

export interface FolderInfo {
  path: string;
  name: string;
  specialUse?: string;
  subscribed: boolean;
  listed: boolean;
}

/**
 * IMAP Client wrapper around ImapFlow
 * Handles connection management, email fetching, and parsing
 */
export class ImapClient {
  private client: ImapFlow | null = null;
  private config: ImapConfig;

  constructor(config: ImapConfig) {
    this.config = config;
  }

  /**
   * Connect to IMAP server
   */
  connect = (): Effect.Effect<void, Error> =>
    Effect.gen(function* (this: ImapClient) {
      if (this.client) {
        console.log('IMAP client already connected');
        return;
      }

      console.log(`Connecting to IMAP server ${this.config.host}:${this.config.port}`);

      this.client = new ImapFlow({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: this.config.auth,
        logger: false, // Disable verbose logging for production
      });

      yield* Effect.tryPromise({
        try: () => this.client!.connect(),
        catch: (error) => new Error(`Failed to connect to IMAP server: ${error}`),
      });

      console.log('Successfully connected to IMAP server');
    }.bind(this));

  /**
   * Disconnect from IMAP server
   */
  disconnect = (): Effect.Effect<void, Error> =>
    Effect.gen(function* (this: ImapClient) {
      if (!this.client) {
        return;
      }

      console.log('Disconnecting from IMAP server');

      yield* Effect.tryPromise({
        try: () => this.client!.logout(),
        catch: (error) => new Error(`Failed to disconnect from IMAP server: ${error}`),
      });

      this.client = null;
    }.bind(this));

  /**
   * List all folders in the mailbox
   */
  listFolders = (): Effect.Effect<FolderInfo[], Error> =>
    Effect.gen(function* (this: ImapClient) {
      if (!this.client) {
        return yield* Effect.fail(new Error('IMAP client not connected'));
      }

      const folders = yield* Effect.tryPromise({
        try: () => this.client!.list(),
        catch: (error) => new Error(`Failed to list folders: ${error}`),
      });

      return folders.map((folder) => ({
        path: folder.path,
        name: folder.name,
        specialUse: folder.specialUse,
        subscribed: folder.subscribed,
        listed: folder.listed,
      }));
    }.bind(this));

  /**
   * Select a folder (mailbox)
   */
  selectFolder = (folderPath: string): Effect.Effect<MailboxObject, Error> =>
    Effect.gen(function* (this: ImapClient) {
      if (!this.client) {
        return yield* Effect.fail(new Error('IMAP client not connected'));
      }

      console.log(`Selecting folder: ${folderPath}`);

      const mailbox = yield* Effect.tryPromise({
        try: () => this.client!.mailboxOpen(folderPath),
        catch: (error) => new Error(`Failed to select folder ${folderPath}: ${error}`),
      });

      console.log(`Folder ${folderPath} selected. Messages: ${mailbox.exists}`);
      return mailbox;
    }.bind(this));

  /**
   * Fetch emails from a folder
   * Supports both initial sync (all emails) and incremental sync (new emails only)
   */
  fetchEmails = (
    folderPath: string,
    options: {
      lastSyncedUid?: number;
      limit?: number;
    } = {},
  ): Effect.Effect<EmailMessage[], Error> =>
    Effect.gen(function* (this: ImapClient) {
      if (!this.client) {
        return yield* Effect.fail(new Error('IMAP client not connected'));
      }

      // Select the folder first
      const mailbox = yield* this.selectFolder(folderPath);

      if (mailbox.exists === 0) {
        console.log(`Folder ${folderPath} is empty`);
        return [];
      }

      // Determine the range of UIDs to fetch
      let range: string;
      if (options.lastSyncedUid && options.lastSyncedUid > 0) {
        // Incremental sync: fetch emails newer than last synced UID
        range = `${options.lastSyncedUid + 1}:*`;
        console.log(`Fetching new emails from UID ${options.lastSyncedUid + 1}`);
      } else {
        // Initial sync: fetch all emails (or limited range)
        if (options.limit) {
          const startUid = Math.max(1, mailbox.exists - options.limit + 1);
          range = `${startUid}:*`;
          console.log(`Fetching last ${options.limit} emails (UID ${startUid} onwards)`);
        } else {
          range = '1:*';
          console.log('Fetching all emails');
        }
      }

      const fetchOptions: FetchQueryObject = {
        uid: true,
        envelope: true,
        bodyStructure: true,
        source: true, // Get full RFC822 source for parsing
        flags: true,
        labels: true,
      };

      // Fetch messages using Effect.promise to handle the async iterator
      const fetchResult = yield* Effect.tryPromise({
        try: async () => {
          const messages: EmailMessage[] = [];
          for await (const message of this.client.fetch(range, fetchOptions, { uid: true })) {
            messages.push(message);
          }
          return messages;
        },
        catch: (error) => new Error(`Failed to fetch emails: ${error}`),
      });

      // Parse all fetched messages
      const messages: EmailMessage[] = [];
      for (const message of fetchResult) {
        const parsed = yield* this.parseEmailMessage(message);
        messages.push(parsed);
      }

      console.log(`Fetched ${messages.length} emails from ${folderPath}`);
      return messages;
    }.bind(this));

  /**
   * Parse a raw IMAP message into our EmailMessage format
   */
  private parseEmailMessage = (
    message: FetchMessageObject,
  ): Effect.Effect<EmailMessage, Error> =>
    Effect.gen(function* () {
      const envelope = message.envelope;
      if (!envelope) {
        return yield* Effect.fail(new Error('Message envelope is missing'));
      }

      // Parse email addresses
      const parseAddresses = (
        addresses?: Array<{ name?: string; address?: string }>,
      ): Array<{ name?: string; address: string }> => {
        if (!addresses) return [];
        return addresses
          .filter((addr) => addr.address)
          .map((addr) => ({
            name: addr.name,
            address: addr.address!,
          }));
      };

      // Extract body text and HTML
      let bodyText: string | undefined;
      let bodyHtml: string | undefined;

      if (message.source) {
        // Parse the RFC822 source to extract body
        const source = message.source.toString();

        // Simple extraction (in production, use a proper email parser like mailparser)
        const bodyMatch = source.match(/\r?\n\r?\n([\s\S]+)$/);
        if (bodyMatch) {
          bodyText = bodyMatch[1];
        }
      }

      // Extract attachments from bodyStructure
      const attachments: EmailMessage['attachments'] = [];
      if (message.bodyStructure) {
        const extractAttachments = (parts: any[]): void => {
          for (const part of parts) {
            if (part.disposition === 'attachment' || part.type === 'application') {
              attachments.push({
                filename: part.dispositionParameters?.filename || part.parameters?.name || 'unknown',
                contentType: `${part.type}/${part.subtype}`,
                size: part.size || 0,
                contentId: part.id,
              });
            }
            if (part.childNodes && part.childNodes.length > 0) {
              extractAttachments(part.childNodes);
            }
          }
        };

        if (Array.isArray(message.bodyStructure.childNodes)) {
          extractAttachments(message.bodyStructure.childNodes);
        }
      }

      const emailMessage: EmailMessage = {
        uid: message.uid,
        messageId: envelope.messageId || `<${message.uid}@unknown>`,
        subject: envelope.subject || '(no subject)',
        from: parseAddresses(envelope.from),
        to: parseAddresses(envelope.to),
        cc: parseAddresses(envelope.cc),
        bcc: parseAddresses(envelope.bcc),
        date: envelope.date || new Date(),
        bodyText,
        bodyHtml,
        attachments,
        inReplyTo: envelope.inReplyTo,
        references: Array.isArray(envelope.references) ? envelope.references : [],
        flags: Array.from(message.flags || []),
        labels: message.labels ? Array.from(message.labels) : undefined,
      };

      return emailMessage;
    });

  /**
   * Test IMAP connection (used for validation)
   */
  testConnection = (): Effect.Effect<boolean, Error> =>
    Effect.gen(function* (this: ImapClient) {
      yield* this.connect();

      // Try to list folders to verify connection works
      const folders = yield* this.listFolders();

      yield* this.disconnect();

      console.log(`Connection test successful. Found ${folders.length} folders.`);
      return true;
    }.bind(this));
}

/**
 * Create an IMAP client from database connection credentials
 */
export const createImapClientFromDB = (
  connectionId: string,
  db: ZeroDB,
): Effect.Effect<ImapClient, Error> =>
  Effect.gen(function* () {
    // Get IMAP credentials from database
    const credentials = yield* Effect.tryPromise({
      try: () => db.getImapCredentials(connectionId),
      catch: (error) => new Error(`Failed to get IMAP credentials: ${error}`),
    });

    if (!credentials) {
      return yield* Effect.fail(new Error(`No IMAP credentials found for connection ${connectionId}`));
    }

    // Decrypt the password
    const encryptionKey = process.env.IMAP_ENCRYPTION_KEY || 'default-encryption-key-change-me';
    const password = yield* decryptPassword(credentials.encryptedPassword, encryptionKey);

    // Create IMAP config
    const config: ImapConfig = {
      host: credentials.imapHost,
      port: credentials.imapPort,
      secure: credentials.imapSecure,
      auth: {
        user: credentials.username,
        pass: password,
      },
    };

    return new ImapClient(config);
  });
