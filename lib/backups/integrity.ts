/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Backup integrity primitives.
 *
 * A backup that cannot be proven byte-identical to what was written is not a
 * backup — it is an assumption. Every backup artefact gets a SHA-256 digest
 * recorded alongside it so that restores can be validated before they are
 * trusted, and so that silent storage corruption is detectable.
 */

import { createHash } from 'crypto';
import { createReadStream } from 'fs';

export const CHECKSUM_ALGORITHM = 'sha256' as const;

/**
 * Stream a file through SHA-256.
 *
 * Streaming rather than `readFile` keeps memory flat: production dumps are
 * multi-gigabyte and buffering one would risk an OOM in a 1GB container.
 */
export function checksumFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(CHECKSUM_ALGORITHM);
    const stream = createReadStream(path);

    stream.on('error', reject);
    hash.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** SHA-256 of an in-memory buffer. */
export function checksumBuffer(buffer: Buffer): string {
  return createHash(CHECKSUM_ALGORITHM).update(buffer).digest('hex');
}

/**
 * Constant-time-ish comparison of two hex digests.
 *
 * Checksums are not secrets, so this is about correctness rather than timing
 * resistance: it normalises case and rejects length mismatches explicitly.
 */
export function checksumsMatch(expected: string | null | undefined, actual: string): boolean {
  if (!expected) return false;
  const a = expected.trim().toLowerCase();
  const b = actual.trim().toLowerCase();
  return a.length === b.length && a === b;
}

export interface ChecksumVerification {
  verified: boolean;
  expected: string | null;
  actual: string;
  reason?: string;
}

/**
 * Verify a file against a previously recorded digest.
 *
 * Returns a structured result instead of throwing so callers can record the
 * failure against the backup record before deciding whether to escalate.
 */
export async function verifyFileChecksum(
  path: string,
  expected: string | null | undefined
): Promise<ChecksumVerification> {
  const actual = await checksumFile(path);

  if (!expected) {
    return {
      verified: false,
      expected: null,
      actual,
      reason: 'No checksum recorded for this backup — integrity cannot be proven',
    };
  }

  const verified = checksumsMatch(expected, actual);
  return {
    verified,
    expected,
    actual,
    ...(verified ? {} : { reason: 'Checksum mismatch — backup artefact is corrupt or truncated' }),
  };
}
