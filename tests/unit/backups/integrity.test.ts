import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createHash } from 'crypto';
import {
  CHECKSUM_ALGORITHM,
  checksumFile,
  checksumBuffer,
  checksumsMatch,
  verifyFileChecksum,
} from '@/lib/backups/integrity';

describe('backup integrity', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nucrm-integrity-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, contents: string | Buffer): string {
    const p = path.join(dir, name);
    writeFileSync(p, contents);
    return p;
  }

  it('uses sha256', () => {
    expect(CHECKSUM_ALGORITHM).toBe('sha256');
  });

  describe('checksumFile', () => {
    it('matches a known SHA-256 digest', async () => {
      const contents = 'pretend this is a pg_dump';
      const file = write('dump.bin', contents);
      const expected = createHash('sha256').update(contents).digest('hex');

      await expect(checksumFile(file)).resolves.toBe(expected);
    });

    it('handles an empty file', async () => {
      const file = write('empty.bin', '');
      const expected = createHash('sha256').update('').digest('hex');
      await expect(checksumFile(file)).resolves.toBe(expected);
    });

    // Production dumps are multi-gigabyte, so the implementation streams rather
    // than buffering. Verify a multi-chunk payload still hashes correctly.
    it('streams larger payloads correctly', async () => {
      const big = Buffer.alloc(1024 * 512, 0x5a);
      const file = write('big.bin', big);
      const expected = createHash('sha256').update(big).digest('hex');
      await expect(checksumFile(file)).resolves.toBe(expected);
    });

    it('produces different digests for different content', async () => {
      const a = await checksumFile(write('a.bin', 'alpha'));
      const b = await checksumFile(write('b.bin', 'beta'));
      expect(a).not.toBe(b);
    });

    it('rejects when the file does not exist', async () => {
      await expect(checksumFile(path.join(dir, 'nope.bin'))).rejects.toThrow();
    });
  });

  describe('checksumBuffer', () => {
    it('agrees with checksumFile for the same bytes', async () => {
      const buf = Buffer.from('same bytes either way');
      const file = write('same.bin', buf);
      expect(checksumBuffer(buf)).toBe(await checksumFile(file));
    });
  });

  describe('checksumsMatch', () => {
    const digest = createHash('sha256').update('x').digest('hex');

    it('matches identical digests', () => {
      expect(checksumsMatch(digest, digest)).toBe(true);
    });

    it('is case-insensitive and tolerates surrounding whitespace', () => {
      expect(checksumsMatch(`  ${digest.toUpperCase()}  `, digest)).toBe(true);
    });

    it('rejects a different digest', () => {
      const other = createHash('sha256').update('y').digest('hex');
      expect(checksumsMatch(digest, other)).toBe(false);
    });

    // A missing recorded digest must never be treated as a pass, otherwise
    // "no checksum" would silently look identical to "checksum verified".
    it('rejects a missing expected digest', () => {
      expect(checksumsMatch(null, digest)).toBe(false);
      expect(checksumsMatch(undefined, digest)).toBe(false);
      expect(checksumsMatch('', digest)).toBe(false);
    });

    it('rejects a truncated digest rather than prefix-matching', () => {
      expect(checksumsMatch(digest.slice(0, 32), digest)).toBe(false);
    });
  });

  describe('verifyFileChecksum', () => {
    it('verifies a matching file', async () => {
      const contents = 'verify me';
      const file = write('ok.bin', contents);
      const expected = createHash('sha256').update(contents).digest('hex');

      const result = await verifyFileChecksum(file, expected);
      expect(result.verified).toBe(true);
      expect(result.actual).toBe(expected);
      expect(result.reason).toBeUndefined();
    });

    it('reports a mismatch as corruption without throwing', async () => {
      const file = write('corrupt.bin', 'actual contents');
      const wrong = createHash('sha256').update('what we expected').digest('hex');

      const result = await verifyFileChecksum(file, wrong);
      expect(result.verified).toBe(false);
      expect(result.expected).toBe(wrong);
      expect(result.reason).toMatch(/mismatch/i);
    });

    it('reports "unverifiable" when no digest was recorded', async () => {
      const file = write('legacy.bin', 'from before checksums existed');

      const result = await verifyFileChecksum(file, null);
      expect(result.verified).toBe(false);
      expect(result.expected).toBeNull();
      expect(result.reason).toMatch(/no checksum recorded/i);
    });
  });
});
