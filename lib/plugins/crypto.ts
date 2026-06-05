/**
 * NuCRM Plugin Credential Encryption Utility
 *
 * Provides symmetric encryption (AES-256-GCM) for plugin authConfig
 * before persisting to the database, and decryption on read.
 * Also provides credential masking for API responses.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env['ENCRYPTION_KEY'];
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  // Key should be 32 bytes hex-encoded (64 chars)
  return Buffer.from(key, 'hex');
}

/**
 * Encrypt a plaintext JSON value into an opaque string (iv:authTag:ciphertext, all hex).
 */
export function encryptAuthConfig(plainObj: unknown): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const plaintext = JSON.stringify(plainObj);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an encrypted authConfig string back to its original object.
 */
export function decryptAuthConfig<T = unknown>(encryptedStr: string): T {
  const key = getEncryptionKey();
  const parts = encryptedStr.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted auth config format');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8')) as T;
}

/**
 * Mask a credential string for display (e.g., "sk-test-abc123xyz" -> "sk-****xyz").
 * Shows last 4 characters preceded by "****".
 */
export function maskCredential(value: string): string {
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

/**
 * Redact sensitive fields from an authConfig object for API responses.
 * Returns a copy with credential values masked.
 */
export function redactAuthConfig(authConfig: unknown): unknown {
  if (!authConfig || typeof authConfig !== 'object') return authConfig;

  const config = authConfig as Record<string, unknown>;
  const type = config['type'] as string | undefined;

  switch (type) {
    case 'bearer':
      return { type: 'bearer', token: maskCredential(String(config['token'] ?? '')) };
    case 'basic':
      return { type: 'basic', username: config['username'], password: maskCredential(String(config['password'] ?? '')) };
    case 'api_key_header':
      return { type: 'api_key_header', headerName: config['headerName'], apiKey: maskCredential(String(config['apiKey'] ?? '')) };
    case 'api_key_query':
      return { type: 'api_key_query', paramName: config['paramName'], apiKey: maskCredential(String(config['apiKey'] ?? '')) };
    case 'oauth2_client_credentials':
      return {
        type: 'oauth2_client_credentials',
        clientId: config['clientId'],
        clientSecret: maskCredential(String(config['clientSecret'] ?? '')),
        tokenUrl: config['tokenUrl'],
        scope: config['scope'],
      };
    case 'none':
    default:
      return authConfig;
  }
}
