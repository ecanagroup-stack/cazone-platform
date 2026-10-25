import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

// The real ATC number is a bearer instrument: anyone who can quote it can collect fuel. It is stored
// only as a keyed hash (so a duplicate can be refused without reading anything back) and an
// AES-256-GCM ciphertext (so the ATC manager and Admin can read it again through an audited action).
// No API returns either column, and the number must never reach the AuditLog or a log line.
// Plain node:crypto only, so the tests can import it without the Next.js alias.

const configError = (message) => Object.assign(new Error(message), { status: 500 });

// Case, spacing and the like are noise when the same number is typed twice or retyped later.
export function normalizeAtcNumber(value) {
  return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

function hashSecret() {
  const secret = process.env.ATC_HASH_SECRET;
  if (!secret || secret.length < 16) throw configError('ATC security is not configured on the server (ATC_HASH_SECRET)');
  return secret;
}

function encryptionKey() {
  const key = Buffer.from(process.env.ATC_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw configError('ATC security is not configured on the server (ATC_ENCRYPTION_KEY)');
  return key;
}

export function hashAtcNumber(value) {
  return createHmac('sha256', hashSecret()).update(normalizeAtcNumber(value)).digest('hex');
}

// iv.tag.ciphertext, each base64url. Holds the number as typed (trimmed), not the normalised form the
// hash uses, so "View number" shows what is printed on the paper ATC.
export function encryptAtcNumber(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value ?? '').trim(), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptAtcNumber(payload) {
  const [iv, tag, ciphertext] = String(payload || '').split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !ciphertext) throw configError('The stored ATC number is unreadable');
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error.status) throw error;
    throw configError('The stored ATC number could not be decrypted');
  }
}

const SECRET_KEYS = new Set(['atcHash', 'atcCipher']);

// True when a value about to be sent to a client carries either secret column anywhere inside it.
export function hasAtcSecretLeak(value) {
  if (Array.isArray(value)) return value.some(hasAtcSecretLeak);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.entries(value).some(([key, item]) => SECRET_KEYS.has(key) || hasAtcSecretLeak(item));
  }
  return false;
}

// Last line of defence behind the explicit `select`s: refuses to build a response that leaks.
export function assertNoAtcSecrets(value) {
  if (hasAtcSecretLeak(value)) throw configError('Refusing to send ATC secrets to the client');
  return value;
}
