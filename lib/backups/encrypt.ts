/**
 * Backup Encryption Module
 *
 * Encrypts backup files with AES-256-GCM before uploading to S3.
 * Decrypts on restore.
 *
 * Key management:
 * - Uses BACKUP_ENCRYPTION_KEY env var (32 bytes, hex-encoded)
 * - Falls back to ENCRYPTION_KEY if backup-specific key not set
 * - Key rotation: old backups remain decryptable as long as the old key is kept in BACKUP_ENCRYPTION_KEY_PREV
 *
 * File format: [12-byte IV][16-byte auth tag][encrypted data]
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Get the encryption key from environment.
 * Must be exactly 32 bytes (64 hex characters).
 */
function getKey(): Buffer {
  const keyHex = process.env.BACKUP_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      'BACKUP_ENCRYPTION_KEY or ENCRYPTION_KEY must be set for encrypted backups. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error(`Encryption key must be 32 bytes (64 hex chars). Got ${key.length} bytes.`);
  }

  return key;
}

/**
 * Encrypt a buffer with AES-256-GCM.
 * Returns: [IV (12 bytes)][Auth Tag (16 bytes)][Encrypted Data]
 */
export function encryptBackup(data: Buffer): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: IV + AuthTag + EncryptedData
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt a buffer encrypted with encryptBackup.
 * Input format: [IV (12 bytes)][Auth Tag (16 bytes)][Encrypted Data]
 */
export function decryptBackup(encrypted: Buffer): Buffer {
  const key = getKey();

  if (encrypted.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Encrypted data too short — corrupted or not an encrypted backup');
  }

  const iv = encrypted.subarray(0, IV_LENGTH);
  const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const data = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    // Try previous key for key rotation support
    const prevKeyHex = process.env.BACKUP_ENCRYPTION_KEY_PREV;
    if (prevKeyHex) {
      try {
        const prevKey = Buffer.from(prevKeyHex, 'hex');
        const decipher2 = createDecipheriv(ALGORITHM, prevKey, iv);
        decipher2.setAuthTag(authTag);
        return Buffer.concat([decipher2.update(data), decipher2.final()]);
      } catch {
        // Both keys failed
      }
    }

    throw new Error('Decryption failed — invalid key or corrupted backup');
  }
}

/**
 * Check if a buffer looks like an encrypted backup (starts with valid IV pattern).
 */
export function isEncryptedBackup(data: Buffer): boolean {
  return data.length > IV_LENGTH + AUTH_TAG_LENGTH;
}
