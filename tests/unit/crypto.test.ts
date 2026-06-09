import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, hashPassword, verifyPassword, verifySecret } from '@/lib/crypto';

describe('verifySecret', () => {
  it('returns true when secrets match', () => {
    expect(verifySecret('secret-value', 'secret-value')).toBe(true);
  });

  it('returns false when secrets do not match', () => {
    expect(verifySecret('secret-value', 'different-value')).toBe(false);
  });

  it('returns false when both are null/undefined', () => {
    expect(verifySecret(null, undefined)).toBe(false);
  });

  it('returns false when only provided is null', () => {
    expect(verifySecret(null, 'expected')).toBe(false);
  });

  it('returns false when only expected is undefined', () => {
    expect(verifySecret('provided', undefined)).toBe(false);
  });

  it('returns false when lengths differ (shorter provided)', () => {
    expect(verifySecret('short', 'much-longer-secret-value')).toBe(false);
  });

  it('returns false when lengths differ (longer provided)', () => {
    expect(verifySecret('much-longer-secret-value', 'short')).toBe(false);
  });

  it('returns false on empty strings', () => {
    expect(verifySecret('', 'abc')).toBe(false);
    expect(verifySecret('abc', '')).toBe(false);
    expect(verifySecret('', '')).toBe(false);
  });
});

describe('encrypt/decrypt', () => {
  const testKey = 'test-encryption-key-32-chars!!';

  it('encrypts and decrypts correctly', () => {
    const plaintext = 'sensitive-data-123';
    const encrypted = encrypt(plaintext, testKey);
    const decrypted = decrypt(encrypted, testKey);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    const plaintext = 'same-data';
    const enc1 = encrypt(plaintext, testKey);
    const enc2 = encrypt(plaintext, testKey);
    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1, testKey)).toBe(plaintext);
    expect(decrypt(enc2, testKey)).toBe(plaintext);
  });

  it('fails to decrypt with wrong key', () => {
    const plaintext = 'secret';
    const encrypted = encrypt(plaintext, testKey);
    expect(() => decrypt(encrypted, 'wrong-key-32-chars-long!!')).toThrow();
  });

  it('throws on empty plaintext', () => {
    expect(() => encrypt('', testKey)).toThrow('Plaintext cannot be empty');
  });

  it('throws on empty key for encrypt', () => {
    expect(() => encrypt('data', '')).toThrow('Key cannot be empty');
  });

  it('throws on empty encrypted text for decrypt', () => {
    expect(() => decrypt('', testKey)).toThrow('Encrypted text cannot be empty');
  });

  it('throws on empty key for decrypt', () => {
    expect(() => decrypt('some-data', '')).toThrow('Key cannot be empty');
  });

  it('throws on malformed encrypted string', () => {
    expect(() => decrypt('invalid-format', testKey)).toThrow('Invalid encrypted format');
    expect(() => decrypt('part1:part2', testKey)).toThrow('Invalid encrypted format');
  });

  it('handles special characters in plaintext', () => {
    const specials = 'hello\nworld\t!@#$%^&*()_+={}[]|\\:;"\'<>,.?/~`';
    const encrypted = encrypt(specials, testKey);
    expect(decrypt(encrypted, testKey)).toBe(specials);
  });

  it('handles unicode characters', () => {
    const unicode = '🔥 你好 ñoño 日本語';
    const encrypted = encrypt(unicode, testKey);
    expect(decrypt(encrypted, testKey)).toBe(unicode);
  });

  it('pads short keys to 32 bytes', () => {
    const shortKey = 'short';
    const plaintext = 'test-data';
    const encrypted = encrypt(plaintext, shortKey);
    const decrypted = decrypt(encrypted, shortKey);
    expect(decrypted).toBe(plaintext);
  });

  it('truncates long keys to 32 bytes', () => {
    const longKey = 'x'.repeat(64);
    const plaintext = 'test-data';
    const encrypted = encrypt(plaintext, longKey);
    const decrypted = decrypt(encrypted, longKey);
    expect(decrypted).toBe(plaintext);
  });
});

describe('hashPassword/verifyPassword', () => {
  it('hashes and verifies password', async () => {
    const password = 'mySecurePassword123!';
    const hash = await hashPassword(password);
    expect(hash).toBeTruthy();
    expect(hash).not.toBe(password);

    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);
  });

  it('rejects wrong password', async () => {
    const password = 'correctPassword';
    const hash = await hashPassword(password);
    const valid = await verifyPassword('wrongPassword', hash);
    expect(valid).toBe(false);
  });

  it('produces different hashes for same password', async () => {
    const password = 'samePassword';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);
    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });

  it('throws on empty password', async () => {
    await expect(hashPassword('')).rejects.toThrow('Password cannot be empty');
  });

  it('returns false for empty password in verify', async () => {
    const hash = await hashPassword('valid-pass');
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('returns false for empty hash in verify', async () => {
    expect(await verifyPassword('password', '')).toBe(false);
  });

  it('returns false for null/undefined hash', async () => {
    expect(await verifyPassword('password', null as any)).toBe(false);
    expect(await verifyPassword('password', undefined as any)).toBe(false);
  });
});
