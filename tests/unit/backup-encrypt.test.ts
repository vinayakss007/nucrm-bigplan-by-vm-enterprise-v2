/**
 * Tests for lib/backups/encrypt.ts — AES-256-GCM backup encryption.
 *
 * These are pure crypto tests: no filesystem, no S3, no database.
 * They verify that encrypt → decrypt is a round-trip, that tampering is
 * detected, and that missing keys fail explicitly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// We need to set the env var BEFORE importing the module under test,
// because getBackupEncryptionKey() reads process.env at call time.
const TEST_KEY = 'test-backup-encryption-key-at-least-32-chars-long';

describe('backup encryption', () => {
  beforeEach(() => {
    process.env.BACKUP_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.BACKUP_ENCRYPTION_KEY;
  });

  describe('encryptBuffer + decryptBuffer', () => {
    it('round-trips arbitrary data', async () => {
      const { encryptBuffer, decryptBuffer } = await import('@/lib/backups/encrypt');
      const plaintext = Buffer.from('Hello, this is a backup dump with SQL inside. CREATE TABLE...');

      const { iv, ciphertext, tag } = encryptBuffer(plaintext);
      const decrypted = decryptBuffer(iv, ciphertext, tag);

      expect(decrypted.toString()).toBe(plaintext.toString());
    });

    it('produces different ciphertext each time (random IV)', async () => {
      const { encryptBuffer } = await import('@/lib/backups/encrypt');
      const plaintext = Buffer.from('Same input every time');

      const result1 = encryptBuffer(plaintext);
      const result2 = encryptBuffer(plaintext);

      // IVs must differ
      expect(result1.iv.equals(result2.iv)).toBe(false);
      // Ciphertext must differ (because IV differs)
      expect(result1.ciphertext.equals(result2.ciphertext)).toBe(false);
    });

    it('detects tampering (modified ciphertext)', async () => {
      const { encryptBuffer, decryptBuffer } = await import('@/lib/backups/encrypt');
      const plaintext = Buffer.from('Sensitive data');

      const { iv, ciphertext, tag } = encryptBuffer(plaintext);

      // Flip a byte in the ciphertext
      const tampered = Buffer.from(ciphertext);
      tampered[0] ^= 0xff;

      expect(() => decryptBuffer(iv, tampered, tag)).toThrow();
    });

    it('detects tampering (modified tag)', async () => {
      const { encryptBuffer, decryptBuffer } = await import('@/lib/backups/encrypt');
      const plaintext = Buffer.from('Sensitive data');

      const { iv, ciphertext, tag } = encryptBuffer(plaintext);

      // Flip a byte in the tag
      const tamperedTag = Buffer.from(tag);
      tamperedTag[0] ^= 0xff;

      expect(() => decryptBuffer(iv, ciphertext, tamperedTag)).toThrow();
    });

    it('handles empty plaintext', async () => {
      const { encryptBuffer, decryptBuffer } = await import('@/lib/backups/encrypt');
      const plaintext = Buffer.alloc(0);

      const { iv, ciphertext, tag } = encryptBuffer(plaintext);
      const decrypted = decryptBuffer(iv, ciphertext, tag);

      expect(decrypted.length).toBe(0);
    });

    it('handles large data (1MB)', async () => {
      const { encryptBuffer, decryptBuffer } = await import('@/lib/backups/encrypt');
      const plaintext = Buffer.alloc(1024 * 1024, 'A');

      const { iv, ciphertext, tag } = encryptBuffer(plaintext);
      const decrypted = decryptBuffer(iv, ciphertext, tag);

      expect(decrypted.equals(plaintext)).toBe(true);
    });
  });

  describe('isEncryptionEnabled', () => {
    it('returns true when key is set', async () => {
      const { isEncryptionEnabled } = await import('@/lib/backups/encrypt');
      expect(isEncryptionEnabled()).toBe(true);
    });

    it('returns false when key is empty', async () => {
      process.env.BACKUP_ENCRYPTION_KEY = '';
      // Need fresh import to re-evaluate
      const mod = await import('@/lib/backups/encrypt');
      expect(mod.isEncryptionEnabled()).toBe(false);
    });

    it('returns false when key is not set', async () => {
      delete process.env.BACKUP_ENCRYPTION_KEY;
      const mod = await import('@/lib/backups/encrypt');
      expect(mod.isEncryptionEnabled()).toBe(false);
    });
  });

  describe('key derivation', () => {
    it('same key produces same encryption result for same IV (deterministic derivation)', async () => {
      const { encryptBuffer } = await import('@/lib/backups/encrypt');
      // We can't test same-IV because randomBytes is always different,
      // but we CAN test that the key derivation is deterministic by
      // checking that decryption with the same env var works.
      const plaintext = Buffer.from('test');
      const { iv, ciphertext, tag } = encryptBuffer(plaintext);

      // Re-import with same key should decrypt successfully
      const { decryptBuffer } = await import('@/lib/backups/encrypt');
      const result = decryptBuffer(iv, ciphertext, tag);
      expect(result.toString()).toBe('test');
    });

    it('different key cannot decrypt', async () => {
      const { encryptBuffer } = await import('@/lib/backups/encrypt');
      const plaintext = Buffer.from('secret');
      const { iv, ciphertext, tag } = encryptBuffer(plaintext);

      // Change the key
      process.env.BACKUP_ENCRYPTION_KEY = 'completely-different-key-that-is-also-long-enough';

      // Force re-evaluation by calling the function with new env
      const { decryptBuffer } = await import('@/lib/backups/encrypt');
      expect(() => decryptBuffer(iv, ciphertext, tag)).toThrow();
    });
  });

  describe('error handling', () => {
    it('encryptBuffer throws when key is not configured', async () => {
      delete process.env.BACKUP_ENCRYPTION_KEY;
      const { encryptBuffer } = await import('@/lib/backups/encrypt');
      expect(() => encryptBuffer(Buffer.from('test'))).toThrow('BACKUP_ENCRYPTION_KEY is not configured');
    });

    it('decryptBuffer throws when key is not configured', async () => {
      delete process.env.BACKUP_ENCRYPTION_KEY;
      const { decryptBuffer } = await import('@/lib/backups/encrypt');
      expect(() => decryptBuffer(Buffer.alloc(12), Buffer.from('x'), Buffer.alloc(16))).toThrow(
        'BACKUP_ENCRYPTION_KEY is not configured'
      );
    });
  });
});
