// Hardcoded admin password and secret for token signing
const ADMIN_PASSWORD = 'Mrunal@123';
const TOKEN_SECRET = 'nubo-invite-admin-secret-2025';

// Helper to create HMAC signature
async function createSignature(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(TOKEN_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Helper to verify HMAC signature
async function verifySignature(data: string, signature: string): Promise<boolean> {
  const expectedSignature = await createSignature(data);
  return expectedSignature === signature;
}

export async function createAdminToken(password: string): Promise<string | null> {
  // Direct string comparison
  if (password !== ADMIN_PASSWORD) {
    return null;
  }

  // Create a stateless signed token with expiration
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  const payload = `admin:${expiresAt}`;
  const signature = await createSignature(payload);

  // Token format: base64(payload).signature
  const token = btoa(payload) + '.' + signature;
  return token;
}

export async function verifyAdminTokenAsync(token: string): Promise<boolean> {
  try {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return false;

    const payload = atob(encodedPayload);
    const [role, expiresAtStr] = payload.split(':');

    if (role !== 'admin') return false;

    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || expiresAt < Date.now()) return false;

    return await verifySignature(payload, signature);
  } catch {
    return false;
  }
}

// Synchronous wrapper that returns false if token format is invalid
// For async verification, use verifyAdminTokenAsync
export function verifyAdminToken(token: string): boolean {
  // Quick sync check for token format before async verification
  // The actual routes will need to use verifyAdminTokenAsync
  try {
    const [encodedPayload] = token.split('.');
    if (!encodedPayload) return false;
    const payload = atob(encodedPayload);
    const [role, expiresAtStr] = payload.split(':');
    if (role !== 'admin') return false;
    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || expiresAt < Date.now()) return false;
    return true; // Format is valid, signature check happens in async version
  } catch {
    return false;
  }
}

export function revokeAdminToken(_token: string): void {
  // No-op for stateless tokens - they expire naturally
}
