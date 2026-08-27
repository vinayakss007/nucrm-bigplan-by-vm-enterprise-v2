/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Backup encryption.
 *
 * Wraps a backup dump file in AES-256-GCM before it leaves the host, so the
 * artefact is useless without the key even if the storage bucket is breached.
 *
 * Design decisions:
 *  - AES-256-GCM (authenticated encryption): protects against both reading AND
 *    tampering. A modified ciphertext fails decryption rather than producing a
 *    corrupt restore.
 *  - Per-file random IV (96 bits): stored as the first 12 bytes of the output.
 *    Never reused because it is generated fresh per invocation.
 *  - Key derived from BACKUP_ENCRYPTION_KEY via HKDF-SHA256 with a fixed
 *    info string so the env var does not have to be exactly 32 bytes.
 *  - Streaming: the dump may be multi-gigabyte. Both encrypt and decrypt
 *    process it in chunks without buffering the whole file in memory.
 *  - The GCM auth tag (16 bytes) is written explicitly after the ciphertext and
 *    read back off the tail before decryption. Node does NOT put the tag into
 *    the cipher's output stream; it has to be fetched with getAuthTag() once the
 *    stream has finished and supplied with setAuthTag() before decipher.final().
 *
 * File layout of the encrypted artefact:
 *   [12 bytes IV][...AES-256-GCM ciphertext...][16 bytes auth tag]
 *
 * The checksum recorded in backup_records is computed AFTER encryption, so it
 * validates the encrypted artefact — not the plaintext. This is intentional:
 * storage corruption of the ciphertext is what we need to detect, and
 * computing the checksum over plaintext would require decrypting first.
 */

import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 12; // 96 bits, recommended for GCM
const TAG_LENGTH = 16; // 128-bit GCM auth tag, appended after the ciphertext
const KEY_LENGTH = 32; // 256 bits
const HKDF_INFO = 'nucrm-backup-encryption-v1';

/**
 * Derive a 256-bit key from the raw env var via HKDF.
 *
 * This means the operator can use any length passphrase; HKDF normalises it
 * into a uniformly distributed 256-bit key.
 */
function deriveKey(rawKey: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', rawKey, '', HKDF_INFO, KEY_LENGTH)
  );
}

/**
 * Returns the encryption key, or null if encryption is not configured.
 *
 * Encryption is opt-in: if BACKUP_ENCRYPTION_KEY is not set, backups are
 * stored unencrypted (as they were before this module existed). This keeps
 * the upgrade path non-breaking.
 */
export function getBackupEncryptionKey(): Buffer | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY;
  if (!raw || raw.trim() === '') return null;
  // Fail closed on a weak key rather than silently encrypting with low entropy.
  // A short passphrase would still be stretched by HKDF, but that does not add
  // entropy — it only spreads what little there is. Refuse anything under 32
  // characters so encryption/decryption cannot proceed with a guessable key.
  if (raw.length < 32) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be at least 32 characters');
  }
  return deriveKey(raw);
}

/** Whether backup encryption is enabled. */
export function isEncryptionEnabled(): boolean {
  return getBackupEncryptionKey() !== null;
}

/**
 * The superseded key, if one is configured.
 *
 * Rotating BACKUP_ENCRYPTION_KEY would otherwise strand every existing backup:
 * the artefacts already in storage are sealed with the old key, so a restore
 * would fail the GCM tag check. Keeping the outgoing value in
 * BACKUP_ENCRYPTION_KEY_PREV lets those older artefacts still be restored while
 * every new one is written with the new key. Once the retention window has
 * passed and no artefact predates the rotation, the variable can be dropped.
 */
export function getPreviousBackupEncryptionKey(): Buffer | null {
  const raw = process.env.BACKUP_ENCRYPTION_KEY_PREV;
  if (!raw || raw.trim() === '') return null;
  return deriveKey(raw);
}

/**
 * Keys to attempt on decrypt, current first.
 *
 * Only decryption consults the previous key. Encryption always uses the current
 * one, so rotation only ever moves forward and nothing is re-sealed with a
 * retired key.
 */
function getDecryptionKeys(): Buffer[] {
  const keys: Buffer[] = [];
  const current = getBackupEncryptionKey();
  if (current) keys.push(current);
  const previous = getPreviousBackupEncryptionKey();
  // Skip a PREV that duplicates the current key: attempting it twice would only
  // double the work on a genuinely undecryptable artefact.
  if (previous && !(current && previous.equals(current))) keys.push(previous);
  return keys;
}

/**
 * Encrypt a file in place (overwrites the source with the ciphertext).
 *
 * Returns the path to the encrypted file (same path, `.enc` extension added).
 * The original plaintext file is deleted after successful encryption.
 */
export async function encryptBackupFile(plaintextPath: string): Promise<string> {
  const key = getBackupEncryptionKey();
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY is not configured');

  const encryptedPath = `${plaintextPath}.enc`;
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const input = createReadStream(plaintextPath);
  const output = createWriteStream(encryptedPath);

  // Write the IV as the first 12 bytes so decrypt knows where to find it.
  output.write(iv);

  await pipeline(input, cipher, output);

  // Append the auth tag. This is required, not optional: Node never places the
  // GCM tag into the cipher's output stream, so without this the artefact has no
  // tag and decipher.final() can only ever fail with "unable to authenticate
  // data" — i.e. the backup would be permanently unrestorable. getAuthTag() is
  // only valid after the stream has flushed, which pipeline() guarantees.
  const { appendFile, unlink } = await import('fs/promises');
  await appendFile(encryptedPath, cipher.getAuthTag());

  // Delete the plaintext now that the ciphertext is flushed.
  await unlink(plaintextPath);

  return encryptedPath;
}

/**
 * Decrypt a backup file.
 *
 * Reads the IV from the first 12 bytes, then decrypts the rest.
 * If the auth tag check fails (tampered or corrupt), the decipher throws.
 */
export async function decryptBackupFile(encryptedPath: string, outputPath: string): Promise<void> {
  const keys = getDecryptionKeys();
  if (keys.length === 0) throw new Error('BACKUP_ENCRYPTION_KEY is not configured');

  const { open, rename, unlink, stat } = await import('fs/promises');

  const { size } = await stat(encryptedPath);
  if (size < IV_LENGTH + TAG_LENGTH) {
    throw new Error(
      `Encrypted backup is too small to be valid (${size} bytes; expected at ` +
        `least ${IV_LENGTH + TAG_LENGTH}). Artefacts produced before the auth tag ` +
        `was written are missing their tag and cannot be decrypted.`
    );
  }

  // Read the IV from the head and the auth tag from the tail.
  const handle = await open(encryptedPath, 'r');
  const ivBuf = Buffer.alloc(IV_LENGTH);
  await handle.read(ivBuf, 0, IV_LENGTH, 0);
  const tagBuf = Buffer.alloc(TAG_LENGTH);
  await handle.read(tagBuf, 0, TAG_LENGTH, size - TAG_LENGTH);
  await handle.close();

  let lastError: unknown;

  for (const [index, key] of keys.entries()) {
    // Decrypt to a temporary file, then rename on success.
    //
    // GCM only detects the wrong key when the auth tag is verified at final(),
    // which happens after the entire stream has already passed through. Writing
    // straight to outputPath would therefore leave a near-complete file of
    // garbage there whenever the first key is the wrong one — and with rotation
    // that is now an expected path, not an edge case. rename() is atomic, so
    // outputPath either does not exist or holds fully verified plaintext.
    const tempPath = `${outputPath}.k${index}.tmp`;
    try {
      const decipher = createDecipheriv(ALGORITHM, key, ivBuf);
      decipher.setAuthTag(tagBuf);
      // Read only the ciphertext: skip the leading IV and stop before the
      // trailing tag, which is not part of the ciphertext. `end` is inclusive.
      await pipeline(
        createReadStream(encryptedPath, { start: IV_LENGTH, end: size - TAG_LENGTH - 1 }),
        decipher,
        createWriteStream(tempPath)
      );
      await rename(tempPath, outputPath);
      return;
    } catch (err) {
      lastError = err;
      await unlink(tempPath).catch(() => {});
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Failed to decrypt backup with ${keys.length} configured key(s). ` +
      `If BACKUP_ENCRYPTION_KEY was rotated, keep the previous value in ` +
      `BACKUP_ENCRYPTION_KEY_PREV. Underlying error: ${detail}`
  );
}

/**
 * Encrypt a buffer in memory (for smaller artefacts or tests).
 *
 * Returns: { iv, ciphertext, tag } — all as Buffers.
 */
export function encryptBuffer(plaintext: Buffer): { iv: Buffer; ciphertext: Buffer; tag: Buffer } {
  const key = getBackupEncryptionKey();
  if (!key) throw new Error('BACKUP_ENCRYPTION_KEY is not configured');

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return { iv, ciphertext, tag };
}

/**
 * Decrypt a buffer in memory.
 */
export function decryptBuffer(iv: Buffer, ciphertext: Buffer, tag: Buffer): Buffer {
  const keys = getDecryptionKeys();
  if (keys.length === 0) throw new Error('BACKUP_ENCRYPTION_KEY is not configured');

  let lastError: unknown;

  for (const key of keys) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (err) {
      lastError = err;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Failed to decrypt buffer with ${keys.length} configured key(s). ` +
      `If BACKUP_ENCRYPTION_KEY was rotated, keep the previous value in ` +
      `BACKUP_ENCRYPTION_KEY_PREV. Underlying error: ${detail}`
  );
}
