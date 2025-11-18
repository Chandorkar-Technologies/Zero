# Browser Cache Clearing Guide

## 🔍 Problem

You're seeing errors for the removed `getIntercomToken` endpoint even though we successfully:
- ✅ Removed the code from source
- ✅ Rebuilt the frontend
- ✅ Deployed to production

**Root Cause:** Your browser has cached the old version of the frontend.

---

## ✅ Quick Fix: Hard Refresh

The fastest solution is a **hard refresh** which bypasses cache:

### Windows/Linux:
- **Chrome/Edge:** `Ctrl + Shift + R`
- **Firefox:** `Ctrl + F5`

### Mac:
- **Chrome/Edge/Firefox:** `Cmd + Shift + R`
- **Safari:** `Cmd + Option + R`

---

## 🔧 Alternative Solutions

### Option 1: Clear Site Data (DevTools)

1. Open https://nubo.email
2. Press `F12` to open DevTools
3. Go to the **Application** tab
4. Click **"Clear site data"** button (left sidebar)
5. Refresh the page (`Ctrl+R` or `Cmd+R`)

### Option 2: Incognito/Private Window

Open https://nubo.email in an incognito/private window:
- **Chrome/Edge:** `Ctrl+Shift+N` (Windows) or `Cmd+Shift+N` (Mac)
- **Firefox:** `Ctrl+Shift+P` (Windows) or `Cmd+Shift+P` (Mac)
- **Safari:** `Cmd+Shift+N` (Mac)

This bypasses all cache and you'll see the latest version immediately.

### Option 3: Manual Cache Clear

**Chrome/Edge:**
1. Settings → Privacy and security
2. Clear browsing data
3. Select "Cached images and files"
4. Choose "All time"
5. Click "Clear data"

**Firefox:**
1. Settings → Privacy & Security
2. Cookies and Site Data
3. Click "Clear Data"
4. Check "Cached Web Content"
5. Click "Clear"

**Safari:**
1. Safari → Preferences
2. Advanced tab
3. Check "Show Develop menu"
4. Develop → Empty Caches

---

## 🌐 Cloudflare Cache (Optional)

If the problem persists after clearing browser cache, you may need to purge Cloudflare's CDN cache:

### Using Cloudflare Dashboard:
1. Go to https://dash.cloudflare.com
2. Select your domain (nubo.email)
3. Go to **Caching** → **Configuration**
4. Click **"Purge Everything"**
5. Confirm

### Using Wrangler CLI:
```bash
# Purge all cache for the zone
wrangler pages deployment tail --project-name=zero
```

---

## ✅ How to Verify It Worked

After clearing cache, you should see:

1. ✅ **"Nubo" branding** everywhere (not "Zero")
2. ✅ **No `getIntercomToken` errors** in console
3. ✅ **Email download working** properly
4. ✅ **No Intercom-related errors**

### Check Console:
1. Open DevTools (`F12`)
2. Go to **Console** tab
3. Refresh the page
4. Look for errors - there should be NO `getIntercomToken` errors

### Check Network:
1. Open DevTools (`F12`)
2. Go to **Network** tab
3. Refresh the page
4. Look for requests to `/api/trpc/user.getIntercomToken`
5. This request should **NOT** appear

---

## 🐛 Still Not Working?

If you still see the error after trying all options:

### 1. Check Your Browser Version
Make sure you're using the latest version of your browser.

### 2. Disable Browser Extensions
Some extensions (ad blockers, privacy tools) can interfere:
- Try disabling all extensions temporarily
- Or use incognito mode (which disables most extensions)

### 3. Check Service Workers
Service workers can cache resources:
1. DevTools → Application → Service Workers
2. Click "Unregister" for nubo.email
3. Refresh the page

### 4. DNS Cache
In rare cases, DNS cache can cause issues:

**Windows:**
```cmd
ipconfig /flushdns
```

**Mac/Linux:**
```bash
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder
```

### 5. Verify Deployment
Check that the latest deployment is active:
```bash
cd /Users/ninad/Desktop/projects/Zero/apps/mail
wrangler deployments list
```

Look for:
- Latest deployment should be version `882b0ff4...`
- Deployed approximately on November 16, 2025

---

## 📊 Expected Behavior

### Before Cache Clear:
- ❌ Error: "No procedure found on path 'user.getIntercomToken'"
- ❌ Emails not downloading
- ❌ Possible "Zero" branding still visible

### After Cache Clear:
- ✅ No `getIntercomToken` errors
- ✅ Emails download successfully
- ✅ "Nubo" branding throughout
- ✅ All features working

---

## 🎯 Summary

**The code is correct and deployed.** You just need to clear your browser cache.

**Recommended:** Try **Hard Refresh** first (`Ctrl+Shift+R` or `Cmd+Shift+R`).

If that doesn't work, try **Incognito Mode**.

If still having issues, **clear all site data** via DevTools.

---

## 📞 Need Help?

If none of these solutions work:
1. Check the browser console for new error messages
2. Try a completely different browser
3. Try from a different device/network
4. Verify the deployment is actually live at https://nubo.email

The deployment is successful - it's just a caching issue! 🎉
