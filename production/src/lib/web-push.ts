/**
 * Web Push implementation for Cloudflare Workers
 * Uses Web Crypto API instead of Node.js crypto
 */

import { env } from '../env';

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string; icon?: string }>;
}

// Helper to convert base64url to Uint8Array
function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Helper to convert Uint8Array to base64url
function uint8ArrayToBase64Url(uint8Array: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Generate ECDH key pair for message encryption
async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  ) as Promise<CryptoKeyPair>;
}

// Export public key as raw bytes
async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  const exported = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(exported as ArrayBuffer);
}

// Derive shared secret using ECDH
async function deriveSharedSecret(
  privateKey: CryptoKey,
  publicKeyBytes: Uint8Array
): Promise<Uint8Array> {
  const publicKey = await crypto.subtle.importKey(
    'raw',
    publicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey } as unknown as Algorithm,
    privateKey,
    256
  );

  return new Uint8Array(sharedSecret);
}

// HKDF key derivation
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'HKDF' }, false, ['deriveBits']);

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info,
    },
    key,
    length * 8
  );

  return new Uint8Array(derived);
}

// Encrypt payload using AES-GCM
async function encryptPayload(
  payload: string,
  p256dh: string,
  auth: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; publicKey: Uint8Array }> {
  const userPublicKey = base64UrlToUint8Array(p256dh);
  const userAuth = base64UrlToUint8Array(auth);

  // Generate ephemeral key pair
  const keyPair = await generateECDHKeyPair();
  const localPublicKey = await exportPublicKey(keyPair.publicKey);

  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive shared secret
  const sharedSecret = await deriveSharedSecret(keyPair.privateKey, userPublicKey);

  // Create info for HKDF
  const keyInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');

  // Create context for HKDF
  const context = new Uint8Array(65 + 65);
  context.set(userPublicKey, 0);
  context.set(localPublicKey, 65);

  // Derive PRK
  const prk = await hkdf(userAuth, sharedSecret, new TextEncoder().encode('Content-Encoding: auth\0'), 32);

  // Derive content encryption key and nonce
  const cek = await hkdf(salt, prk, keyInfo, 16);
  const nonce = await hkdf(salt, prk, nonceInfo, 12);

  // Encrypt payload
  const encoder = new TextEncoder();
  const paddedPayload = new Uint8Array(payload.length + 2);
  paddedPayload[0] = 0; // Padding delimiter
  paddedPayload[1] = 0; // No padding
  paddedPayload.set(encoder.encode(payload), 2);

  const cryptoKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cryptoKey,
    paddedPayload
  );

  return {
    ciphertext: new Uint8Array(encrypted),
    salt,
    publicKey: localPublicKey,
  };
}

// Create VAPID JWT token
async function createVapidJwt(audience: string): Promise<string> {
  const vapidPrivateKey = env.VAPID_PRIVATE_KEY;

  if (!vapidPrivateKey) {
    throw new Error('VAPID_PRIVATE_KEY not configured');
  }

  const header = {
    typ: 'JWT',
    alg: 'ES256',
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 12 * 60 * 60, // 12 hours
    sub: 'mailto:noreply@nubo.email',
  };

  const headerB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import private key
  const privateKeyBytes = base64UrlToUint8Array(vapidPrivateKey);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  // Sign the token
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureB64 = uint8ArrayToBase64Url(new Uint8Array(signature));
  return `${unsignedToken}.${signatureB64}`;
}

/**
 * Send a push notification
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  try {
    const vapidPublicKey = env.VAPID_PUBLIC_KEY;

    if (!vapidPublicKey) {
      return { success: false, error: 'VAPID_PUBLIC_KEY not configured' };
    }

    // Encrypt the payload
    const { ciphertext, salt, publicKey } = await encryptPayload(
      JSON.stringify(payload),
      subscription.keys.p256dh,
      subscription.keys.auth
    );

    // Build the encrypted body with headers
    const body = new Uint8Array(salt.length + 4 + 1 + publicKey.length + ciphertext.length);
    let offset = 0;

    // Salt (16 bytes)
    body.set(salt, offset);
    offset += salt.length;

    // Record size (4 bytes, big-endian) - max 4096
    body[offset++] = 0;
    body[offset++] = 0;
    body[offset++] = 0x10;
    body[offset++] = 0x00;

    // Key ID length (1 byte) and public key (65 bytes)
    body[offset++] = publicKey.length;
    body.set(publicKey, offset);
    offset += publicKey.length;

    // Ciphertext
    body.set(ciphertext, offset);

    // Get audience from endpoint
    const url = new URL(subscription.endpoint);
    const audience = `${url.protocol}//${url.host}`;

    // Create VAPID authorization
    const jwt = await createVapidJwt(audience);
    const vapidAuth = `vapid t=${jwt}, k=${vapidPublicKey}`;

    // Send the request
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Authorization': vapidAuth,
        'TTL': '86400', // 24 hours
        'Urgency': 'normal',
      },
      body,
    });

    if (response.status === 201 || response.status === 200) {
      return { success: true, statusCode: response.status };
    }

    // Handle common error cases
    if (response.status === 404 || response.status === 410) {
      // Subscription expired or invalid - should be deleted
      return { success: false, statusCode: response.status, error: 'subscription_expired' };
    }

    const errorText = await response.text();
    return { success: false, statusCode: response.status, error: errorText };
  } catch (error) {
    console.error('[WebPush] Error sending notification:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Send push notifications to all of a user's subscriptions
 */
export async function sendPushToUser(
  subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload
): Promise<{ sent: number; failed: number; expired: string[] }> {
  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      sendPushNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
    )
  );

  let sent = 0;
  let failed = 0;
  const expired: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value.success) {
        sent++;
      } else {
        failed++;
        if (result.value.error === 'subscription_expired') {
          expired.push(subscriptions[index].endpoint);
        }
      }
    } else {
      failed++;
    }
  });

  return { sent, failed, expired };
}
