import { Effect } from 'effect';

/**
 * Encrypt a password using AES-GCM encryption
 * Uses Web Crypto API available in Cloudflare Workers
 */
export const encryptPassword = (password: string, secretKey: string): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    // Convert the secret key to a fixed-length key (32 bytes for AES-256)
    const keyMaterial = new TextEncoder().encode(secretKey.padEnd(32, '0').slice(0, 32));

    // Import the key
    const key = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
        ]),
      catch: (error) => new Error(`Failed to import encryption key: ${error}`),
    });

    // Generate a random IV (Initialization Vector)
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt the password
    const encodedPassword = new TextEncoder().encode(password);
    const encrypted = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.encrypt(
          {
            name: 'AES-GCM',
            iv: iv,
          },
          key,
          encodedPassword,
        ),
      catch: (error) => new Error(`Failed to encrypt password: ${error}`),
    });

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Convert to base64
    const base64 = btoa(String.fromCharCode(...combined));
    return base64;
  });

/**
 * Decrypt a password using AES-GCM encryption
 */
export const decryptPassword = (
  encryptedPassword: string,
  secretKey: string,
): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    // Convert the secret key to a fixed-length key (32 bytes for AES-256)
    const keyMaterial = new TextEncoder().encode(secretKey.padEnd(32, '0').slice(0, 32));

    // Import the key
    const key = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM', length: 256 }, false, [
          'decrypt',
        ]),
      catch: (error) => new Error(`Failed to import decryption key: ${error}`),
    });

    // Decode from base64
    const combined = Uint8Array.from(atob(encryptedPassword), (c) => c.charCodeAt(0));

    // Extract IV and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    // Decrypt the password
    const decrypted = yield* Effect.tryPromise({
      try: () =>
        crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: iv,
          },
          key,
          encrypted,
        ),
      catch: (error) => new Error(`Failed to decrypt password: ${error}`),
    });

    // Convert back to string
    const password = new TextDecoder().decode(decrypted);
    return password;
  });

/**
 * Generate a random encryption key
 * This should be stored securely in environment variables
 */
export const generateEncryptionKey = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
};
