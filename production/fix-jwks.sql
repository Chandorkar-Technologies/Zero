-- Fix for BETTER_AUTH_SECRET encryption key mismatch
-- This script clears the encrypted JWT keys that were encrypted with the old secret
-- Better-auth will automatically generate new keys on the next request

-- WARNING: This will invalidate all existing sessions and JWT tokens
-- Users will need to log in again

BEGIN;

-- Show current JWKS records (for logging)
SELECT
    id,
    created_at,
    LENGTH(public_key) as public_key_length,
    LENGTH(private_key) as private_key_length
FROM mail0_jwks;

-- Delete all JWKS records
DELETE FROM mail0_jwks;

-- Verify deletion
SELECT COUNT(*) as remaining_jwks FROM mail0_jwks;

COMMIT;

-- After running this:
-- 1. Redeploy your worker: wrangler deploy --env production
-- 2. Better-auth will generate new keys using the current BETTER_AUTH_SECRET
-- 3. Users will need to log in again
