import { Effect } from 'effect';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import { decryptPassword } from './encryption';
import type { ZeroDB } from '../../main';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface EmailAttachment {
  filename: string;
  content?: Buffer | string;
  contentType?: string;
  path?: string; // Path to file
}

export interface SendEmailOptions {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
  inReplyTo?: string;
  references?: string[];
}

/**
 * SMTP Client wrapper around nodemailer
 * Handles email sending via SMTP
 */
export class SmtpClient {
  private transporter: Transporter | null = null;
  private config: SmtpConfig;

  constructor(config: SmtpConfig) {
    this.config = config;
  }

  /**
   * Initialize SMTP transporter
   */
  private getTransporter = (): Transporter => {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: {
          user: this.config.auth.user,
          pass: this.config.auth.pass,
        },
      });
    }
    return this.transporter;
  };

  /**
   * Send an email via SMTP
   */
  sendEmail = (options: SendEmailOptions): Effect.Effect<string, Error> =>
    Effect.gen(function* (this: SmtpClient) {
      const transporter = this.getTransporter();

      const mailOptions: Mail.Options = {
        from: options.from,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        cc: options.cc ? (Array.isArray(options.cc) ? options.cc.join(', ') : options.cc) : undefined,
        bcc: options.bcc
          ? Array.isArray(options.bcc)
            ? options.bcc.join(', ')
            : options.bcc
          : undefined,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments,
        replyTo: options.replyTo,
        inReplyTo: options.inReplyTo,
        references: options.references,
      };

      console.log(`Sending email via SMTP: "${options.subject}" to ${options.to}`);

      const info = yield* Effect.tryPromise({
        try: () => transporter.sendMail(mailOptions),
        catch: (error) => new Error(`Failed to send email via SMTP: ${error}`),
      });

      console.log(`Email sent successfully. Message ID: ${info.messageId}`);
      return info.messageId;
    }.bind(this));

  /**
   * Verify SMTP connection (used for testing)
   */
  verify = (): Effect.Effect<boolean, Error> =>
    Effect.gen(function* (this: SmtpClient) {
      const transporter = this.getTransporter();

      console.log(`Verifying SMTP connection to ${this.config.host}:${this.config.port}`);

      yield* Effect.tryPromise({
        try: () => transporter.verify(),
        catch: (error) => new Error(`SMTP verification failed: ${error}`),
      });

      console.log('SMTP connection verified successfully');
      return true;
    }.bind(this));

  /**
   * Close the SMTP connection
   */
  close = (): Effect.Effect<void, Error> =>
    Effect.gen(function* (this: SmtpClient) {
      if (!this.transporter) {
        return;
      }

      console.log('Closing SMTP connection');

      yield* Effect.tryPromise({
        try: () => this.transporter!.close(),
        catch: (error) => new Error(`Failed to close SMTP connection: ${error}`),
      });

      this.transporter = null;
    }.bind(this));
}

/**
 * Create an SMTP client from database connection credentials
 */
export const createSmtpClientFromDB = (
  connectionId: string,
  db: ZeroDB,
): Effect.Effect<SmtpClient, Error> =>
  Effect.gen(function* () {
    // Get IMAP credentials from database (SMTP creds are stored in same table)
    const credentials = yield* Effect.tryPromise({
      try: () => db.getImapCredentials(connectionId),
      catch: (error) => new Error(`Failed to get SMTP credentials: ${error}`),
    });

    if (!credentials) {
      return yield* Effect.fail(
        new Error(`No SMTP credentials found for connection ${connectionId}`),
      );
    }

    // Decrypt the password
    const encryptionKey = process.env.IMAP_ENCRYPTION_KEY || 'default-encryption-key-change-me';
    const password = yield* decryptPassword(credentials.encryptedPassword, encryptionKey);

    // Create SMTP config
    const config: SmtpConfig = {
      host: credentials.smtpHost,
      port: credentials.smtpPort,
      secure: credentials.smtpSecure,
      auth: {
        user: credentials.username,
        pass: password,
      },
    };

    return new SmtpClient(config);
  });
