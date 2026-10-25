import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  assertNoAtcSecrets, decryptAtcNumber, encryptAtcNumber, hasAtcSecretLeak, hashAtcNumber, normalizeAtcNumber,
} from '../lib/atcSecret.js';

process.env.ATC_HASH_SECRET = 'test-hash-secret-0123456789';
process.env.ATC_ENCRYPTION_KEY = randomBytes(32).toString('base64');

test('normalising trims, upper-cases and strips spaces', () => {
  assert.equal(normalizeAtcNumber('  ab 123 x '), 'AB123X');
  assert.equal(normalizeAtcNumber(null), '');
});

test('the hash is deterministic and ignores case and spacing', () => {
  assert.equal(hashAtcNumber('abc 123'), hashAtcNumber(' ABC123 '));
  assert.notEqual(hashAtcNumber('ABC123'), hashAtcNumber('ABC124'));
  assert.match(hashAtcNumber('ABC123'), /^[0-9a-f]{64}$/);
});

test('the hash depends on the secret', () => {
  const before = hashAtcNumber('ABC123');
  process.env.ATC_HASH_SECRET = 'a-different-secret-9876543210';
  assert.notEqual(hashAtcNumber('ABC123'), before);
  process.env.ATC_HASH_SECRET = 'test-hash-secret-0123456789';
  assert.equal(hashAtcNumber('ABC123'), before);
});

test('encrypt then decrypt round-trips the number as typed, trimmed', () => {
  const cipher = encryptAtcNumber('  abc 123 ');
  assert.equal(decryptAtcNumber(cipher), 'abc 123');
  assert.equal(cipher.split('.').length, 3);
  assert.ok(!cipher.includes('ABC123'));
});

test('every encryption uses a fresh iv', () => {
  assert.notEqual(encryptAtcNumber('ABC123'), encryptAtcNumber('ABC123'));
});

test('a tampered ciphertext or a different key does not decrypt', () => {
  const [iv, tag, ct] = encryptAtcNumber('ABC123').split('.');
  const flipped = Buffer.from(ct, 'base64url');
  flipped[0] ^= 1;
  assert.throws(() => decryptAtcNumber([iv, tag, flipped.toString('base64url')].join('.')));
  const cipher = encryptAtcNumber('ABC123');
  const key = process.env.ATC_ENCRYPTION_KEY;
  process.env.ATC_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  assert.throws(() => decryptAtcNumber(cipher));
  process.env.ATC_ENCRYPTION_KEY = key;
  assert.throws(() => decryptAtcNumber('not-a-cipher'));
});

test('missing or malformed secrets fail loudly', () => {
  const hashSecret = process.env.ATC_HASH_SECRET;
  const key = process.env.ATC_ENCRYPTION_KEY;
  delete process.env.ATC_HASH_SECRET;
  assert.throws(() => hashAtcNumber('ABC123'), /ATC_HASH_SECRET/);
  process.env.ATC_HASH_SECRET = hashSecret;
  process.env.ATC_ENCRYPTION_KEY = Buffer.from('too short').toString('base64');
  assert.throws(() => encryptAtcNumber('ABC123'), /ATC_ENCRYPTION_KEY/);
  process.env.ATC_ENCRYPTION_KEY = key;
});

test('the leak check finds either secret column anywhere in a response', () => {
  assert.equal(hasAtcSecretLeak({ serial: 'ATC-000001', litres: 33000 }), false);
  assert.equal(hasAtcSecretLeak({ data: [{ serial: 'ATC-000001', vehicle: { plateNumber: 'X' } }] }), false);
  assert.equal(hasAtcSecretLeak({ atcHash: 'x' }), true);
  assert.equal(hasAtcSecretLeak({ data: [{ nested: { atcCipher: 'x' } }] }), true);
  assert.throws(() => assertNoAtcSecrets({ data: [{ atcCipher: 'x' }] }), /ATC secrets/);
  assert.deepEqual(assertNoAtcSecrets({ ok: true, at: new Date(0) }), { ok: true, at: new Date(0) });
});
