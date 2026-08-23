/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { encrypt, decrypt } from '@/lib/crypto';

const SENSITIVE_FIELDS = [
  'apiKey',
  'api_secret',
  'secretKey',
  'password',
  'passwordHash',
  'totpSecret',
  'accessToken',
  'refreshToken',
  'oauthToken',
  'privateKey',
  'clientSecret',
];

export function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELDS.some(f => 
    fieldName.toLowerCase().includes(f.toLowerCase())
  );
}

 
 
export function getEncryptionKey(): string {
  const key = process.env['ENCRYPTION_KEY'];
  if (!key) {
    throw new Error(
      '[field-encryption] ENCRYPTION_KEY env var is required. Generate with: openssl rand -hex 32'
    );
  }
  return key;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function encryptSensitiveFields<T extends Record<string, any>>(
  data: T,
  fields?: string[]
): T {
  const fieldsToEncrypt = fields || SENSITIVE_FIELDS;
  const result = { ...data };
  const encKey = getEncryptionKey();

  for (const [k, value] of Object.entries(result)) {
    if (fieldsToEncrypt.some(f => k.toLowerCase().includes(f.toLowerCase())) && value) {
      result[k as keyof T] = encrypt(String(value), encKey) as T[keyof T];
    }
  }

  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decryptSensitiveFields<T extends Record<string, any>>(
  data: T,
  fields?: string[]
): T {
  const fieldsToDecrypt = fields || SENSITIVE_FIELDS;
  const result = { ...data };
  const encKey = getEncryptionKey();

  for (const [k, value] of Object.entries(result)) {
    if (fieldsToDecrypt.some(f => k.toLowerCase().includes(f.toLowerCase())) && value) {
      try {
        result[k as keyof T] = decrypt(String(value), encKey) as T[keyof T];
      } catch (err) {
        // Fail-closed and LOUD.
        //
        // Never return the ciphertext (that would leak stored secrets) and never
        // substitute null either: a silently-nulled credential looks like an
        // unconfigured integration, so a key-rotation mistake or storage
        // corruption would be mistaken for normal state and go unnoticed. A
        // decryption failure means the key is wrong or the data is corrupt, and
        // both demand operator attention.
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`[field-encryption] Failed to decrypt field "${k}": ${reason}`);
      }
    }
  }

  return result;
}

export function maskSensitiveValue(value: string, showChars = 4): string {
  if (!value || value.length <= showChars * 2) return '***';
  return value.substring(0, showChars) + '****' + value.substring(value.length - showChars);
}