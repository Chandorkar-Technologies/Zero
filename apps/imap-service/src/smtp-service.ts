import nodemailer from 'nodemailer';
import type { Logger } from 'pino';

export class SmtpService {
    constructor(private logger: Logger) { }

    async sendEmail(connection: any, emailOptions: {
        from: string;
        to: string[];
        cc?: string[];
        bcc?: string[];
        subject: string;
        text?: string;
        html?: string;
    }) {
        this.logger.info(`Sending email from ${emailOptions.from} to ${emailOptions.to.join(', ')}`);

        const config = connection.config;

        // IMAP connections store SMTP config under config.smtp and auth under config.auth
        const smtpConfig = config.smtp || config;
        const authConfig = config.auth || smtpConfig.auth;

        this.logger.info(`[SMTP] Using SMTP config: host=${smtpConfig.host}, port=${smtpConfig.port}, secure=${smtpConfig.secure}`);

        if (!smtpConfig || !smtpConfig.host || !authConfig) {
            this.logger.error(`[SMTP] Invalid config structure:`, {
                hasSmtp: !!config.smtp,
                hasAuth: !!config.auth,
                hasHost: !!smtpConfig?.host
            });
            throw new Error(`Invalid SMTP configuration for connection ${connection.id}`);
        }

        // Create reusable transporter object using the default SMTP transport
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.secure, // true for 465, false for other ports
            auth: {
                user: authConfig.user,
                pass: authConfig.pass,
            },
        });

        try {
            // send mail with defined transport object
            const info = await transporter.sendMail({
                from: emailOptions.from,
                to: emailOptions.to,
                cc: emailOptions.cc,
                bcc: emailOptions.bcc,
                subject: emailOptions.subject,
                text: emailOptions.text,
                html: emailOptions.html,
            });

            this.logger.info(`Message sent: ${info.messageId}`);
            return info;
        } catch (error) {
            this.logger.error(error, `Failed to send email for connection ${connection.id}`);
            throw error;
        }
    }
}
