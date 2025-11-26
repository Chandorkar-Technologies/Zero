import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export class Store {
    private client: S3Client;
    private bucketName: string;

    constructor(config: {
        accountId: string;
        accessKeyId: string;
        secretAccessKey: string;
        bucketName: string;
    }) {
        this.client = new S3Client({
            region: 'auto',
            endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
        });
        this.bucketName = config.bucketName;
    }

    async saveEmail(connectionId: string, threadId: string, emailData: any): Promise<string> {
        const key = `${connectionId}/${threadId}.json`;
        console.log(`[Store] Saving to R2: bucket=${this.bucketName}, key=${key}, connectionId=${connectionId}, threadId=${threadId}`);
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: JSON.stringify(emailData),
                ContentType: 'application/json',
            })
        );
        console.log(`[Store] Successfully saved to R2: ${key}`);
        return key;
    }

    async saveAttachment(
        connectionId: string,
        emailId: string,
        attachmentId: string,
        content: Buffer,
        contentType: string
    ): Promise<string> {
        const key = `${connectionId}/attachments/${emailId}/${attachmentId}`;
        console.log(`[Store] Saving attachment to R2: bucket=${this.bucketName}, key=${key}`);
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: content,
                ContentType: contentType,
            })
        );
        console.log(`[Store] Successfully saved attachment to R2: ${key}`);
        return key;
    }
}
