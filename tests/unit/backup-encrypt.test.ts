import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Backup Encryption', () => {
  const TEST_KEY = 'a'.repeat(64); // 32 bytes hex

  beforeEach(() => {
    process.env.BACKUP_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    delete process.env.BACKUP_ENCRYPTION_KEY_PREV;
    vi.resetModules();
  });

  it('encrypts and decrypts data correctly', async () => {
    const { encryptBackup, decryptBackup } = await import('@/lib/backups/encrypt');
    const original = Buffer.from('Hello, this is a backup file content!');

    const encrypted = encryptBackup(original);
    const decrypted = decryptBackup(encrypted);

    expect(decrypted.toString()).toBe(original.toString());
  });

  it('encrypted output is larger than input (IV + tag overhead)', async () => {
    const { encryptBackup } = await import('@/lib/backups/encrypt');
    const original = Buffer.from('test data');

    const encrypted = encryptBackup(original);

    // Should be: 12 (IV) + 16 (tag) + data length
    expect(encrypted.length).toBe(12 + 16 + original.length);
  });

  it('produces different ciphertext each time (random IV)', async () => {
    const { encryptBackup } = await import('@/lib/backups/encrypt');
    const original = Buffer.from('same input');

    const encrypted1 = encryptBackup(original);
    const encrypted2 = encryptBackup(original);

    expect(encrypted1.equals(encrypted2)).toBe(false);
  });

  it('throws on missing encryption key', async () => {
    delete process.env.BACKUP_ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;

    const { encryptBackup } = await import('@/lib/backups/encrypt');

    expect(() => encryptBackup(Buffer.from('data'))).toThrow('BACKUP_ENCRYPTION_KEY');
  });

  it('throws on wrong key length', async () => {
    process.env.BACKUP_ENCRYPTION_KEY = 'tooshort';

    const { encryptBackup } = await import('@/lib/backups/encrypt');

    expect(() => encryptBackup(Buffer.from('data'))).toThrow('32 bytes');
  });

  it('decryption fails with wrong key', async () => {
    const { encryptBackup } = await import('@/lib/backups/encrypt');
    const original = Buffer.from('secret data');

    const encrypted = encryptBackup(original);

    // Change key
    process.env.BACKUP_ENCRYPTION_KEY = 'b'.repeat(64);
    vi.resetModules();
    const mod = await import('@/lib/backups/encrypt');

    expect(() => mod.decryptBackup(encrypted)).toThrow('Decryption failed');
  });

  it('supports key rotation via BACKUP_ENCRYPTION_KEY_PREV', async () => {
    const { encryptBackup } = await import('@/lib/backups/encrypt');
    const original = Buffer.from('rotated data');

    // Encrypt with current key
    const encrypted = encryptBackup(original);

    // Rotate key: old key becomes _PREV
    const oldKey = TEST_KEY;
    process.env.BACKUP_ENCRYPTION_KEY = 'c'.repeat(64); // new key
    process.env.BACKUP_ENCRYPTION_KEY_PREV = oldKey; // old key
    vi.resetModules();

    const mod2 = await import('@/lib/backups/encrypt');
    const decrypted = mod2.decryptBackup(encrypted);

    expect(decrypted.toString()).toBe(original.toString());
  });

  it('isEncryptedBackup detects encrypted data', async () => {
    const { encryptBackup, isEncryptedBackup } = await import('@/lib/backups/encrypt');
    const encrypted = encryptBackup(Buffer.from('test'));

    expect(isEncryptedBackup(encrypted)).toBe(true);
    expect(isEncryptedBackup(Buffer.from('short'))).toBe(false);
  });
});
