import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isSensitiveField, maskSensitiveValue } from '@/lib/field-encryption';

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
});
