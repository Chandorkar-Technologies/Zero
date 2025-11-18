# Fix: BETTER_AUTH_SECRET Encryption Key Mismatch

## 🔴 The Problem

You're getting this error:
```
Failed to decrypt private private key. Make sure the secret currently in use
is the same as the one used to encrypt the private key.
```

**Root Cause:**
- Better-auth stores encrypted JWT private keys in the `mail0_jwks` database table
- The `private_key` column is encrypted using `BETTER_AUTH_SECRET`
- When you changed `BETTER_AUTH_SECRET` in production, the old encrypted keys can no longer be decrypted
- This happens **every time the app tries to use JWT authentication**

## 📋 Database Table Structure

```sql
Table: mail0_jwks
├── id (text, primary key)
├── public_key (text)
├── private_key (text) ← ENCRYPTED with BETTER_AUTH_SECRET
└── created_at (timestamp)
```

**File:** `apps/server/src/db/schema.ts:232`

## ✅ Solution: Clear the JWKS Table

The safest solution is to **delete all encrypted keys** and let better-auth generate new ones.

### Step 1: Connect to Your Production Database

```bash
# If using Neon, get connection string from dashboard
# Or use the DATABASE_URL from your Hyperdrive config

psql "postgresql://neondb_owner:npg_SMxr57hJCvpy@ep-delicate-king-ah7ift2i-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require"
```

### Step 2: Run the Fix SQL Script

**Option A: Use the provided SQL file**
```bash
psql YOUR_DATABASE_URL -f fix-jwks.sql
```

**Option B: Run manually**
```sql
-- Delete all JWKS records
DELETE FROM mail0_jwks;

-- Verify
SELECT COUNT(*) FROM mail0_jwks;
-- Should return 0
```

### Step 3: Redeploy (Optional but Recommended)

```bash
wrangler deploy --env production
```

### Step 4: Test

```bash
# Test auth endpoint
curl https://api.nubo.email/api/auth/get-session

# Should return null (no error)
```

---

## ⚠️ Important Notes

### What Will Happen:
1. ✅ All encrypted JWT keys will be deleted
2. ✅ Better-auth will generate new keys using the current `BETTER_AUTH_SECRET`
3. ⚠️ **All existing JWT tokens will be invalidated**
4. ⚠️ **All existing sessions MAY be invalidated** (users need to log in again)

### Why This is Safe:
- Better-auth automatically generates new JWKS keys on the next request
- The new keys will be encrypted with the current `BETTER_AUTH_SECRET`
- No data loss - only authentication tokens are affected

### Alternative: Restore Old Secret

If you know what the **OLD** `BETTER_AUTH_SECRET` was in production (before you changed it), you can restore it instead:

```bash
# Replace with the actual old secret
echo 'OLD_SECRET_VALUE' | wrangler secret put BETTER_AUTH_SECRET --env production
```

But this only works if you know the old value!

---

## 🔍 How to Prevent This in the Future

### 1. Never Change BETTER_AUTH_SECRET in Production

Once set, the `BETTER_AUTH_SECRET` should **never change** unless you're intentionally rotating keys.

### 2. If You Must Rotate Keys

Follow these steps:
1. Clear the `mail0_jwks` table
2. Update the secret
3. Deploy
4. Notify users they need to re-login

### 3. Use Environment-Specific Secrets

Your `.env` has:
```bash
BETTER_AUTH_SECRET=4e7b1db2d92696c19e16da4d6019cc27f40c0a37a1561ed095223f323ec811d6
```

Make sure this is the **SAME** value in:
- Local development (`.env`)
- Staging environment
- Production environment

Or use different secrets per environment and clear JWKS when promoting code.

---

## 🛠️ Troubleshooting

### Error Still Persists After Clearing JWKS?

1. **Verify the table is empty:**
   ```sql
   SELECT * FROM mail0_jwks;
   ```

2. **Check the secret is correct:**
   ```bash
   wrangler secret list --env production | grep BETTER_AUTH_SECRET
   ```

3. **Clear Redis cache:**
   Better-auth may cache keys in Redis. Clear your Redis cache or restart Redis.

4. **Check logs:**
   ```bash
   wrangler tail --env production --format pretty
   ```

### Still Getting 500 Errors?

The error might be from a different cause. Check:
1. Database connection (Hyperdrive)
2. Redis connection
3. Other secrets (GOOGLE_CLIENT_ID, etc.)

---

## 📝 Summary

**Quick Fix:**
```bash
# 1. Connect to database
psql YOUR_DATABASE_URL

# 2. Delete JWKS
DELETE FROM mail0_jwks;

# 3. Verify
SELECT COUNT(*) FROM mail0_jwks;  -- Should be 0

# 4. Exit
\q

# 5. Test
curl https://api.nubo.email/api/auth/get-session
```

**Expected Result:** No more "Failed to decrypt private key" errors! ✅

---

## 📚 References

- Better-auth JWKS Documentation: https://better-auth.com
- Database Schema: `apps/server/src/db/schema.ts:232`
- Auth Configuration: `apps/server/src/lib/auth.ts:160`
