# Remaining IMAP Cleanup Tasks

## 1. Remove from src/db/schema.ts
Find and remove these table definitions:
- `export const imapCredentials = pgTable(...)`  
- `export const imapSyncState = pgTable(...)`

## 2. Remove from src/main.ts (DbRpcDO class, lines ~231-290)
Remove all IMAP RPC methods:
- `createImapCredentials`
- `getImapCredentials`
- `updateImapCredentials`
- `deleteImapCredentials`
- `createImapSyncState`
- `getImapSyncState`
- `updateImapSyncState`

Also remove from main.ts imports (line ~18-19):
- `imapCredentials,`
- `imapSyncState,`

## 3. Remove from wrangler.jsonc
Remove IMAP worker binding and queue:
```json
[[env.production.services]]
binding = "IMAP_WORKER"
service = "imap-worker-production"

[[env.production.queues.producers]]
queue = "imap-sync-queue-prod"
binding = "imap_sync_queue"
```

## 4. Remove env.ts entries
Remove from ZeroEnv type:
- `IMAP_WORKER: Fetcher;`
- `imap_sync_queue: Queue;`

## 5. Optional: Archive apps/imap-worker directory
Move to archive or delete:
```bash
git mv apps/imap-worker apps/archived/imap-worker
# OR
rm -rf apps/imap-worker
```

## 6. Deploy
```bash
wrangler deploy --env production
```
