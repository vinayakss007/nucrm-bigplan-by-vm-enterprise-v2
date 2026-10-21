/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * File access for the backup readers, split out of
 * lib/restore/backup-parser.ts under #422. `.gz` is handled transparently so
 * every reader sees one plain-text stream.
 */

import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { createHash } from 'crypto';
import { Readable } from 'stream';

/**
 * Calculate SHA-256 hash of a file
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = filePath.endsWith('.gz')
      ? createReadStream(filePath).pipe(createGunzip())
      : createReadStream(filePath);

    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Get file stream (handles .gz transparently)
 */
export function getFileStream(filePath: string): Readable {
  if (filePath.endsWith('.gz') || filePath.endsWith('.gzip')) {
    return createReadStream(filePath).pipe(createGunzip());
  }
  return createReadStream(filePath);
}
