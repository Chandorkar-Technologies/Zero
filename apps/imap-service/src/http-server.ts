import express, { type Request, type Response, type NextFunction } from 'express';
import type { Logger } from 'pino';
import { SmtpService } from './smtp-service.js';

interface SendEmailRequest {
    smtp: {
        host: string;
        port: number;
        secure: boolean;
        auth: {
            user: string;
            pass: string;
        };
    };
    email: {
        from: string;
        to: string[];
        cc?: string[];
        bcc?: string[];
        replyTo?: string;
        subject: string;
        text?: string;
        html?: string;
        inReplyTo?: string;
        references?: string;
        attachments?: Array<{
            filename: string;
            content: string; // base64 encoded
            contentType?: string;
        }>;
    };
    apiKey: string; // Simple API key for authentication
}

export class HttpServer {
    private app: express.Application;
    private smtpService: SmtpService;
    private logger: Logger;
    private apiKey: string;

    constructor(logger: Logger, apiKey: string) {
        this.app = express();
        this.logger = logger;
        this.apiKey = apiKey;
        this.smtpService = new SmtpService(logger);

        this.setupMiddleware();
        this.setupRoutes();
    }

    private setupMiddleware() {
        this.app.use(express.json({ limit: '50mb' })); // Large limit for attachments

        // Simple API key authentication
        this.app.use((req: Request, res: Response, next: NextFunction) => {
            // Skip auth for health check
            if (req.path === '/health') {
                return next();
            }

            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                res.status(401).json({ error: 'Missing or invalid authorization header' });
                return;
            }

            const token = authHeader.substring(7);
            if (token !== this.apiKey) {
                res.status(403).json({ error: 'Invalid API key' });
                return;
            }

            next();
        });
    }

    private setupRoutes() {
        // Health check endpoint
        this.app.get('/health', (_req: Request, res: Response) => {
            res.json({ status: 'ok', service: 'imap-smtp-service' });
        });

        // Send email endpoint
        this.app.post('/send', async (req: Request, res: Response) => {
            try {
                const body = req.body as SendEmailRequest;

                if (!body.smtp || !body.email) {
                    return res.status(400).json({ error: 'Missing smtp or email configuration' });
                }

                this.logger.info({
                    to: body.email.to,
                    subject: body.email.subject,
                    smtpHost: body.smtp.host,
                    smtpPort: body.smtp.port,
                }, 'Received send email request');

                // Convert base64 attachments to buffers
                const attachments = body.email.attachments?.map(att => ({
                    filename: att.filename,
                    content: Buffer.from(att.content, 'base64'),
                    contentType: att.contentType,
                }));

                const result = await this.smtpService.sendEmail(
                    {
                        id: 'http-request',
                        config: {
                            host: body.smtp.host,
                            port: body.smtp.port,
                            secure: body.smtp.secure,
                            auth: body.smtp.auth,
                        },
                    },
                    {
                        from: body.email.from,
                        to: body.email.to,
                        cc: body.email.cc,
                        bcc: body.email.bcc,
                        replyTo: body.email.replyTo,
                        subject: body.email.subject,
                        text: body.email.text,
                        html: body.email.html,
                        inReplyTo: body.email.inReplyTo,
                        references: body.email.references,
                        attachments,
                    }
                );

                this.logger.info({ messageId: result.messageId }, 'Email sent successfully');

                res.json({
                    success: true,
                    messageId: result.messageId,
                });
            } catch (error) {
                this.logger.error(error, 'Failed to send email');
                res.status(500).json({
                    error: 'Failed to send email',
                    message: error instanceof Error ? error.message : 'Unknown error',
                });
            }
        });
    }

    start(port: number): Promise<void> {
        return new Promise((resolve) => {
            this.app.listen(port, () => {
                this.logger.info({ port }, 'HTTP server started');
                resolve();
            });
        });
    }
}
