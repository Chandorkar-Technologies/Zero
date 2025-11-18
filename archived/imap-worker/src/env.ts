import type { R2Bucket, Hyperdrive } from '@cloudflare/workers-types';

export interface Env {
  NODE_ENV: string;
  IMAP_ENCRYPTION_KEY: string;
  HYPERDRIVE: Hyperdrive;
  THREADS_BUCKET: R2Bucket;
}
