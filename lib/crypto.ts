/**
 * Cryptographic utilities
 * Provides encryption/decryption and password hashing
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Timing-safe secret comparison
 * Prevents timing attacks on secret validation
 * Uses constant-time comparison for ALL code paths (no early returns)
 */
export function verifySecret(provided: string | null, expected: string | undefined): boolean {
  const a = provided ? Buffer.from(provided) : Buffer.alloc(0);
  const b = expected ? Buffer.from(expected) : Buffer.alloc(0);

  if (a.length === 0 && b.length === 0) {
    timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }

  if (a.length === b.length) {
    return timingSafeEqual(a, b);
  }

  const maxLen = Math.max(a.length, b.length);
  const aPad = Buffer.concat([a, Buffer.alloc(maxLen - a.length)]);
  const bPad = Buffer.concat([b, Buffer.alloc(maxLen - b.length)]);
  timingSafeEqual(aPad, bPad);
  return false;
}

/**
 * Encrypt plaintext using AES-256-GCM
 * Returns base64 encoded string with IV and auth tag
 */
export function encrypt(plaintext: string, key: string): string {
  if (!plaintext) throw new Error('Plaintext cannot be empty');
  if (!key) throw new Error('Key cannot be empty');

  const iv = randomBytes(IV_LENGTH);
  const keyBuffer = Buffer.from(key.padEnd(32).slice(0, 32));
  
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  // Return iv:auth_tag:encrypted_data
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt ciphertext using AES-256-GCM
 */
export function decrypt(encryptedText: string, key: string): string {
  if (!encryptedText) throw new Error('Encrypted text cannot be empty');
  if (!key) throw new Error('Key cannot be empty');

  const [ivBase64, authTagBase64, encrypted] = encryptedText.split(':');
  
  if (!ivBase64 || !authTagBase64 || !encrypted) {
    throw new Error('Invalid encrypted format');
  }

  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const keyBuffer = Buffer.from(key.padEnd(32).slice(0, 32));
  
  const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Hash password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error('Password cannot be empty');
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

/**
 * Verify password against bcrypt hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}
