# Production Secrets Checklist

## ✅ Secrets Found in .env

The following secrets were found and will be pushed to production:

### Authentication & Security
- ✅ `BETTER_AUTH_SECRET` - Auth signing key
- ✅ `BETTER_AUTH_URL` - Will use: `https://nubo.email`
- ✅ `GOOGLE_CLIENT_ID` - Google OAuth client ID
- ✅ `GOOGLE_CLIENT_SECRET` - Google OAuth secret
- ✅ `INTERCOM_IDENTITY_VERIFICATION_SECRET` - Intercom JWT signing key

### Database
- ⚠️ `DATABASE_URL` - **CURRENTLY SET TO LOCALHOST - UPDATE REQUIRED!**
  - Current: `postgresql://postgres:postgres@localhost:5432/zerodotemail`
  - **You need to update this to your production database URL**

### Redis
- ✅ `REDIS_URL` - Upstash Redis URL
- ✅ `REDIS_TOKEN` - Upstash Redis token

### Email Service
- ✅ `RESEND_API_KEY` - Resend email service API key

### AI Services
- ✅ `OPENAI_API_KEY` - OpenAI API key
- ✅ `PERPLEXITY_API_KEY` - Perplexity API key
- ✅ `OPENAI_MODEL` - `gpt-4o`
- ✅ `OPENAI_MINI_MODEL` - `gpt-4o-mini`
- ✅ `AI_SYSTEM_PROMPT` - AI assistant system prompt

### Billing
- ✅ `AUTUMN_SECRET_KEY` - Autumn billing service key

### SMS/Phone
- ✅ `TWILIO_ACCOUNT_SID` - Twilio account SID
- ✅ `TWILIO_AUTH_TOKEN` - Twilio auth token
- ✅ `TWILIO_PHONE_NUMBER` - `+16075245413`

---

## 🚨 IMPORTANT: Before Running the Script

### 1. Update Production Database URL

Edit `push-production-secrets.sh` and replace the `DATABASE_URL` line with your production database:

```bash
push_secret "DATABASE_URL" "postgresql://YOUR_PRODUCTION_DB_URL"
```

### 2. Verify Google OAuth Credentials

Make sure your Google OAuth client is configured for production:
- ✅ Authorized redirect URIs include: `https://api.nubo.email/auth/callback/google`
- ✅ Authorized JavaScript origins include: `https://nubo.email`

### 3. Environment Variables Already in wrangler.jsonc

These are **NOT secrets** and are already configured in `wrangler.jsonc` production env:
- `NODE_ENV` = `"production"`
- `COOKIE_DOMAIN` = `".nubo.email"`
- `VITE_PUBLIC_BACKEND_URL` = `"https://api.nubo.email"`
- `VITE_PUBLIC_APP_URL` = `"https://nubo.email"`
- `DISABLE_CALLS` = `"true"`
- `THREAD_SYNC_LOOP` = `"true"`
- `DISABLE_WORKFLOWS` = `"true"`
- Other infrastructure bindings (KV, Queues, R2, etc.)

---

## 🚀 How to Push Secrets

### Step 1: Fix OAuth Scope (if needed)
```bash
wrangler login
```

### Step 2: Update the script
Edit `push-production-secrets.sh` and update `DATABASE_URL` to your production value.

### Step 3: Run the script
```bash
./push-production-secrets.sh
```

### Step 4: Verify secrets were pushed
```bash
wrangler secret list --env production
```

You should see all the secret names (values are hidden).

### Step 5: Deploy
```bash
wrangler deploy --env production
```

---

## 🔍 Verify Production Deployment

After deployment:

1. Check the deployment logs
2. Test Google login at `https://nubo.email`
3. Check Intercom integration (should no longer show JWT error)
4. Monitor error logs in Cloudflare dashboard

---

## 🛡️ Security Notes

- ⚠️ This script contains your actual secret values - **DO NOT commit it to git**
- ✅ Add to `.gitignore`: `push-production-secrets.sh`
- ✅ After pushing secrets, consider deleting the script or storing it securely
- ✅ Rotate all secrets if they've been exposed

---

## 📝 Database URL Formats

### Hyperdrive (Recommended for Production)
If using Cloudflare Hyperdrive, `DATABASE_URL` should point to your Hyperdrive connection string.

Check your Hyperdrive config:
```bash
wrangler hyperdrive list
```

Your production Hyperdrive ID is: `ae4405addb934ccdb006a6e701d725fa`

The connection string should be something like:
```
postgresql://user:password@host:port/database
```

This is the **origin** database that Hyperdrive connects to, not the Hyperdrive connection string itself.
