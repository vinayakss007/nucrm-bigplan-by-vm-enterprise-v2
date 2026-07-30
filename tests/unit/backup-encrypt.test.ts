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


describe('key rotation (BACKUP_ENCRYPTION_KEY_PREV)', () => {
  const KEY_OLD = 'old-key-0123456789abcdef0123456789abcdef';
  const KEY_NEW = 'new-key-fedcba9876543210fedcba9876543210';
  const ORIGINAL = process.env.BACKUP_ENCRYPTION_KEY;
  const ORIGINAL_PREV = process.env.BACKUP_ENCRYPTION_KEY_PREV;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = ORIGINAL;
    if (ORIGINAL_PREV === undefined) delete process.env.BACKUP_ENCRYPTION_KEY_PREV;
    else process.env.BACKUP_ENCRYPTION_KEY_PREV = ORIGINAL_PREV;
  });

  /** Seal a payload under `key`, then read it back under the current env. */
  async function sealWith(key: string, payload: Buffer) {
    process.env.BACKUP_ENCRYPTION_KEY = key;
    delete process.env.BACKUP_ENCRYPTION_KEY_PREV;
    const mod = await import('@/lib/backups/encrypt');
    return mod.encryptBuffer(payload);
  }

  it('decrypts a backup sealed with the previous key after rotation', async () => {
    const payload = Buffer.from('pg_dump output from before the rotation');
    const sealed = await sealWith(KEY_OLD, payload);

    // Rotate: new key becomes current, old key retained as PREV.
    process.env.BACKUP_ENCRYPTION_KEY = KEY_NEW;
    process.env.BACKUP_ENCRYPTION_KEY_PREV = KEY_OLD;
    const { decryptBuffer } = await import('@/lib/backups/encrypt');

    expect(decryptBuffer(sealed.iv, sealed.ciphertext, sealed.tag).toString()).toBe(
      payload.toString()
    );
  });

  it('still decrypts artefacts sealed with the current key', async () => {
    const payload = Buffer.from('sealed after the rotation');
    process.env.BACKUP_ENCRYPTION_KEY = KEY_NEW;
    process.env.BACKUP_ENCRYPTION_KEY_PREV = KEY_OLD;
    const { encryptBuffer, decryptBuffer } = await import('@/lib/backups/encrypt');

    const sealed = encryptBuffer(payload);
    expect(decryptBuffer(sealed.iv, sealed.ciphertext, sealed.tag).toString()).toBe(
      payload.toString()
    );
  });

  it('fails once the previous key is removed, not silently', async () => {
    const sealed = await sealWith(KEY_OLD, Buffer.from('stranded'));

    // Rotation completed and PREV dropped: the old artefact is unrecoverable and
    // must say so rather than returning garbage.
    process.env.BACKUP_ENCRYPTION_KEY = KEY_NEW;
    delete process.env.BACKUP_ENCRYPTION_KEY_PREV;
    const { decryptBuffer } = await import('@/lib/backups/encrypt');

    expect(() => decryptBuffer(sealed.iv, sealed.ciphertext, sealed.tag)).toThrow(
      /BACKUP_ENCRYPTION_KEY_PREV/
    );
  });

  it('reports how many keys were tried', async () => {
    const sealed = await sealWith('a-third-unrelated-key-000000000000', Buffer.from('x'));
    process.env.BACKUP_ENCRYPTION_KEY = KEY_NEW;
    process.env.BACKUP_ENCRYPTION_KEY_PREV = KEY_OLD;
    const { decryptBuffer } = await import('@/lib/backups/encrypt');

    expect(() => decryptBuffer(sealed.iv, sealed.ciphertext, sealed.tag)).toThrow(
      /2 configured key\(s\)/
    );
  });

  it('does not count a PREV that duplicates the current key', async () => {
    const sealed = await sealWith('yet-another-key-1111111111111111111', Buffer.from('x'));
    process.env.BACKUP_ENCRYPTION_KEY = KEY_NEW;
    process.env.BACKUP_ENCRYPTION_KEY_PREV = KEY_NEW;
    const { decryptBuffer } = await import('@/lib/backups/encrypt');

    // Same key twice is one distinct key, and retrying it would be pointless.
    expect(() => decryptBuffer(sealed.iv, sealed.ciphertext, sealed.tag)).toThrow(
      /1 configured key\(s\)/
    );
  });

  it('ignores a blank PREV', async () => {
    process.env.BACKUP_ENCRYPTION_KEY = KEY_NEW;
    process.env.BACKUP_ENCRYPTION_KEY_PREV = '   ';
    const { getPreviousBackupEncryptionKey } = await import('@/lib/backups/encrypt');
    expect(getPreviousBackupEncryptionKey()).toBeNull();
  });

  it('round-trips a file sealed with the previous key, leaving no temp file behind', async () => {
    const { mkdtemp, writeFile, readFile, readdir } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const dir = await mkdtemp(join(tmpdir(), 'rotate-'));
    const plain = join(dir, 'dump.sql');
    const restored = join(dir, 'restored.sql');
    await writeFile(plain, 'CREATE TABLE t (id int);');

    process.env.BACKUP_ENCRYPTION_KEY = KEY_OLD;
    delete process.env.BACKUP_ENCRYPTION_KEY_PREV;
    const before = await import('@/lib/backups/encrypt');
    const encPath = await before.encryptBackupFile(plain);

    process.env.BACKUP_ENCRYPTION_KEY = KEY_NEW;
    process.env.BACKUP_ENCRYPTION_KEY_PREV = KEY_OLD;
    const after = await import('@/lib/backups/encrypt');
    await after.decryptBackupFile(encPath, restored);

    expect((await readFile(restored)).toString()).toBe('CREATE TABLE t (id int);');
    // The first key fails at the GCM tag check, so a temp file is written and
    // must be cleaned up rather than left next to the restore.
    expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});


describe('file round-trip (encryptBackupFile / decryptBackupFile)', () => {
  const KEY = 'file-path-key-0123456789abcdef0123456789';
  const ORIGINAL = process.env.BACKUP_ENCRYPTION_KEY;
  const ORIGINAL_PREV = process.env.BACKUP_ENCRYPTION_KEY_PREV;

  beforeEach(() => {
    process.env.BACKUP_ENCRYPTION_KEY = KEY;
    delete process.env.BACKUP_ENCRYPTION_KEY_PREV;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = ORIGINAL;
    if (ORIGINAL_PREV === undefined) delete process.env.BACKUP_ENCRYPTION_KEY_PREV;
    else process.env.BACKUP_ENCRYPTION_KEY_PREV = ORIGINAL_PREV;
  });

  async function tmp() {
    const { mkdtemp } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    return { dir: await mkdtemp(join(tmpdir(), 'benc-')), join };
  }

  // Regression: the file path previously never wrote the GCM auth tag and never
  // called setAuthTag, so every encrypted backup was permanently unrestorable.
  // The existing tests were buffer-only ("no filesystem"), which is why it
  // shipped. These exercise the real streaming path.
  it('round-trips a dump through encrypt and decrypt', async () => {
    const { writeFile, readFile } = await import('fs/promises');
    const { dir, join } = await tmp();
    const plain = join(dir, 'dump.sql');
    const restored = join(dir, 'restored.sql');
    const body = 'CREATE TABLE t (id int);\n'.repeat(500);
    await writeFile(plain, body);

    const { encryptBackupFile, decryptBackupFile } = await import('@/lib/backups/encrypt');
    const enc = await encryptBackupFile(plain);
    await decryptBackupFile(enc, restored);

    expect((await readFile(restored)).toString()).toBe(body);
  });

  it('writes IV + ciphertext + 16-byte tag', async () => {
    const { writeFile, readFile } = await import('fs/promises');
    const { dir, join } = await tmp();
    const plain = join(dir, 'd.sql');
    await writeFile(plain, 'SELECT 1;'); // 9 bytes

    const { encryptBackupFile } = await import('@/lib/backups/encrypt');
    const enc = await encryptBackupFile(plain);

    // 12 (IV) + 9 (ciphertext, GCM is a stream cipher so same length) + 16 (tag).
    // Without the tag this was 21, and decryption could never succeed.
    expect((await readFile(enc)).length).toBe(12 + 9 + 16);
  });

  it('removes the plaintext after encrypting', async () => {
    const { writeFile, access } = await import('fs/promises');
    const { dir, join } = await tmp();
    const plain = join(dir, 'd.sql');
    await writeFile(plain, 'SELECT 1;');

    const { encryptBackupFile } = await import('@/lib/backups/encrypt');
    await encryptBackupFile(plain);

    // The plaintext is deleted, which is exactly why the round-trip must work:
    // there is no original left to fall back on.
    await expect(access(plain)).rejects.toThrow();
  });

  it('rejects a tampered artefact instead of writing garbage', async () => {
    const { writeFile, readFile, access } = await import('fs/promises');
    const { dir, join } = await tmp();
    const plain = join(dir, 'd.sql');
    const restored = join(dir, 'r.sql');
    await writeFile(plain, 'SELECT 1;');

    const { encryptBackupFile, decryptBackupFile } = await import('@/lib/backups/encrypt');
    const enc = await encryptBackupFile(plain);

    // Flip a ciphertext byte (after the IV, before the tag).
    const buf = await readFile(enc);
    buf[IV_END] = buf[IV_END]! ^ 0xff;
    await writeFile(enc, buf);

    await expect(decryptBackupFile(enc, restored)).rejects.toThrow();
    // And no partial plaintext is left behind at the destination.
    await expect(access(restored)).rejects.toThrow();
  });

  it('rejects a truncated artefact with a clear message', async () => {
    const { writeFile } = await import('fs/promises');
    const { dir, join } = await tmp();
    const enc = join(dir, 'short.enc');
    await writeFile(enc, Buffer.alloc(10));

    const { decryptBackupFile } = await import('@/lib/backups/encrypt');
    await expect(decryptBackupFile(enc, join(dir, 'out'))).rejects.toThrow(/too small/i);
  });
});

/** First ciphertext byte offset: straight after the 12-byte IV. */
const IV_END = 12;
