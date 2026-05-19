import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, hashPassword, verifyPassword } from '@/lib/crypto';

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
    expect(() => encrypt('', testKey)).toThrow();
  });

  it('throws on empty key', () => {
    expect(() => encrypt('data', '')).toThrow();
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
    // But both verify
    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });
});
