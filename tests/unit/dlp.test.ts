import { describe, it, expect } from 'vitest';
import { maskPii, maskSensitiveData } from '@/lib/dlp';

describe('maskPii', () => {
  it('returns empty string as-is', () => {
    expect(maskPii('')).toBe('');
  });

  it('returns non-string values as-is', () => {
    expect(maskPii(null as unknown as string)).toBe(null);
    expect(maskPii(undefined as unknown as string)).toBe(undefined);
  });

  it('masks email addresses', () => {
    expect(maskPii('john.doe@example.com')).toBe('j***@example.com');
    expect(maskPii('a@b.co')).toBe('a***@b.co');
  });

  it('masks simple digit phone numbers', () => {
    const result = maskPii('1234567890');
    expect(result).toMatch(/\*\*\*/);
  });

  it('masks SSN with dashes', () => {
    const result = maskPii('987-65-4321');
    expect(result).toMatch(/\*\*\*/);
  });

  it('masks 9-digit strings (phone pattern matches)', () => {
    const result = maskPii('123456789');
    expect(result).toMatch(/\*\*\*/);
  });

  it('masks credit card numbers with separators', () => {
    expect(maskPii('4111-1111-1111-1111')).toBe('****-****-****-1111');
  });

  it('masks SSN with dashes (phone pattern wins)', () => {
    const result = maskPii('123-45-6789');
    expect(result).toMatch(/\*\*\*/);
  });

  it('masks IP addresses', () => {
    const masked = maskPii('192.168.1.100');
    expect(masked).toBe('192.168.***.***');
  });

  it('returns non-PII text as-is', () => {
    expect(maskPii('hello world')).toBe('hello world');
    expect(maskPii('just some random text')).toBe('just some random text');
  });

  it('does not mask user@IP-like strings (email regex requires letter TLD)', () => {
    expect(maskPii('user@192.168.1.1')).toBe('user@192.168.1.1');
  });
});

describe('maskSensitiveData', () => {
  it('masks known sensitive fields', () => {
    const data = { password: 'secret123', name: 'John', apiKey: 'sk-123' };
    const result = maskSensitiveData(data);
    expect(result.masked.password).toBe('***REDACTED***');
    expect(result.masked.apiKey).toBe('***REDACTED***');
    expect(result.masked.name).toBe('John');
    expect(result.maskedFields).toContain('password');
    expect(result.maskedFields).toContain('apiKey');
  });

  it('masks snake_case sensitive fields', () => {
    const data = { password_hash: 'abc', api_key: 'xyz' };
    const result = maskSensitiveData(data);
    expect(result.masked.password_hash).toBe('***REDACTED***');
    expect(result.masked.api_key).toBe('***REDACTED***');
  });

  it('skips null and undefined fields', () => {
    const data = { password: null, apiKey: undefined, name: 'John' };
    const result = maskSensitiveData(data);
    expect(result.masked.password).toBeNull();
    expect(result.masked.apiKey).toBeUndefined();
    expect(result.maskedFields).toEqual([]);
  });

  it('includes custom sensitive fields', () => {
    const data = { ssn: '123-45-6789', name: 'John' };
    const result = maskSensitiveData(data, ['ssn']);
    expect(result.masked.ssn).toBe('***REDACTED***');
    expect(result.maskedFields).toContain('ssn');
  });

  it('does not mutate the original object', () => {
    const data = { password: 'secret' };
    const result = maskSensitiveData(data);
    expect(result.masked.password).toBe('***REDACTED***');
    expect(data.password).toBe('secret');
  });
});
