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

export function encryptSensitiveFields<T extends Record<string, any>>(
  data: T,
  fields?: string[]
): T {
  const fieldsToEncrypt = fields || SENSITIVE_FIELDS;
  const result = { ...data };
  const encKey = process.env['ENCRYPTION_KEY'] || '';

  for (const [k, value] of Object.entries(result)) {
    if (fieldsToEncrypt.some(f => k.toLowerCase().includes(f.toLowerCase())) && value) {
      result[k as keyof T] = encrypt(String(value), encKey) as any;
    }
  }

  return result;
}

export function decryptSensitiveFields<T extends Record<string, any>>(
  data: T,
  fields?: string[]
): T {
  const fieldsToDecrypt = fields || SENSITIVE_FIELDS;
  const result = { ...data };
  const encKey = process.env['ENCRYPTION_KEY'] || '';

  for (const [k, value] of Object.entries(result)) {
    if (fieldsToDecrypt.some(f => k.toLowerCase().includes(f.toLowerCase())) && value) {
      try {
        result[k as keyof T] = decrypt(String(value), encKey) as any;
      } catch {
        // Fallback to default on corrupted storage data
        result[k as keyof T] = value;
      }
    }
  }

  return result;
}

export function maskSensitiveValue(value: string, showChars = 4): string {
  if (!value || value.length <= showChars * 2) return '***';
  return value.substring(0, showChars) + '****' + value.substring(value.length - showChars);
}