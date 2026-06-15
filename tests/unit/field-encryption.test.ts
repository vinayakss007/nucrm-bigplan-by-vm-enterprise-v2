import { describe, it, expect, beforeEach } from 'vitest';
import { isSensitiveField, maskSensitiveValue, encryptSensitiveFields, decryptSensitiveFields } from '@/lib/field-encryption';

const mockEncrypt = vi.fn((val: string) => `enc:${val}`);
const mockDecrypt = vi.fn((val: string) => val.replace('enc:', ''));

vi.mock('@/lib/crypto', () => ({
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  encrypt: (...args: any[]) => mockEncrypt(...args),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  decrypt: (...args: any[]) => mockDecrypt(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32chars';
});

describe('isSensitiveField', () => {
  it('detects apiKey', () => {
    expect(isSensitiveField('apiKey')).toBe(true);
  });

  it('detects password fields', () => {
    expect(isSensitiveField('password')).toBe(true);
    expect(isSensitiveField('passwordHash')).toBe(true);
  });

  it('detects token fields', () => {
    expect(isSensitiveField('accessToken')).toBe(true);
    expect(isSensitiveField('refreshToken')).toBe(true);
    expect(isSensitiveField('oauthToken')).toBe(true);
  });

  it('detects secret fields', () => {
    expect(isSensitiveField('clientSecret')).toBe(true);
    expect(isSensitiveField('api_secret')).toBe(true);
  });

  it('is case insensitive', () => {
    expect(isSensitiveField('APIKEY')).toBe(true);
    expect(isSensitiveField('ApiKey')).toBe(true);
  });

  it('returns false for non-sensitive fields', () => {
    expect(isSensitiveField('name')).toBe(false);
    expect(isSensitiveField('email')).toBe(false);
    expect(isSensitiveField('description')).toBe(false);
  });
});

describe('maskSensitiveValue', () => {
  it('masks middle of value, shows first and last 4 chars', () => {
    expect(maskSensitiveValue('sk_live_abcdefghijklmnop')).toBe('sk_l****mnop');
  });

  it('returns asterisks for short values', () => {
    expect(maskSensitiveValue('ab')).toBe('***');
  });

  it('returns asterisks for empty values', () => {
    expect(maskSensitiveValue('')).toBe('***');
  });

  it('returns asterisks for boundary-length values', () => {
    const val = '12345678';
    expect(maskSensitiveValue(val, 4)).toBe('***');
  });

  it('masks with longer values past boundary', () => {
    expect(maskSensitiveValue('12345678901', 4)).toBe('1234****8901');
  });

  it('handles null value', () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(maskSensitiveValue(null as any)).toBe('***');
  });

  it('handles undefined value', () => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(maskSensitiveValue(undefined as any)).toBe('***');
  });
});

describe('encryptSensitiveFields', () => {
  it('encrypts sensitive fields by default list', () => {
    const data = { name: 'test', apiKey: 'sk-123', email: 'test@test.com' };
    const result = encryptSensitiveFields(data);
    expect(result.apiKey).toBe('enc:sk-123');
    expect(result.name).toBe('test');
    expect(result.email).toBe('test@test.com');
  });

  it('encrypts specified fields only', () => {
    const data = { name: 'test', apiKey: 'sk-123', clientSecret: 'cs-456' };
    const result = encryptSensitiveFields(data, ['clientSecret']);
    expect(result.name).toBe('test');
    expect(result.apiKey).toBe('sk-123');
    expect(result.clientSecret).toBe('enc:cs-456');
  });

  it('skips empty values', () => {
    const data = { apiKey: '', password: null };
    const result = encryptSensitiveFields(data);
    expect(result.apiKey).toBe('');
    expect(result.password).toBeNull();
    expect(mockEncrypt).not.toHaveBeenCalled();
  });

  it('returns a new object, not mutating input', () => {
    const data = { name: 'test', apiKey: 'sk-123' };
    const result = encryptSensitiveFields(data);
    expect(result).not.toBe(data);
    expect(data.apiKey).toBe('sk-123');
  });

  it('works without ENCRYPTION_KEY', () => {
    delete process.env.ENCRYPTION_KEY;
    const data = { apiKey: 'sk-123' };
    const _result = encryptSensitiveFields(data);
    expect(mockEncrypt).toHaveBeenCalledWith('sk-123', '');
  });
});

describe('decryptSensitiveFields', () => {
  it('decrypts sensitive fields by default list', () => {
    const data = { name: 'test', apiKey: 'enc:sk-123' };
    const result = decryptSensitiveFields(data);
    expect(result.apiKey).toBe('sk-123');
    expect(result.name).toBe('test');
  });

  it('decrypts specified fields only', () => {
    const data = { name: 'test', apiKey: 'enc:sk-123', secretKey: 'enc:sk-456' };
    const result = decryptSensitiveFields(data, ['secretKey']);
    expect(result.apiKey).toBe('enc:sk-123');
    expect(result.secretKey).toBe('sk-456');
  });

  it('skips empty values', () => {
    const data = { apiKey: '', password: null };
    const result = decryptSensitiveFields(data);
    expect(result.apiKey).toBe('');
    expect(result.password).toBeNull();
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it('handles decryption errors gracefully', () => {
    mockDecrypt.mockImplementationOnce(() => { throw new Error('bad decrypt'); });
    const data = { apiKey: 'invalid-encrypted' };
    const result = decryptSensitiveFields(data);
    expect(result.apiKey).toBe('invalid-encrypted');
  });

  it('returns a new object, not mutating input', () => {
    const data = { name: 'test', apiKey: 'enc:sk-123' };
    const result = decryptSensitiveFields(data);
    expect(result).not.toBe(data);
    expect(data.apiKey).toBe('enc:sk-123');
  });
});
