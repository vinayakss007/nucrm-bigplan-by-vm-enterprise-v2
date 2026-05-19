import { describe, it, expect } from 'vitest';
import { ValidationError, str, email, num, enumVal, validationResponse } from '@/lib/validate';

describe('ValidationError', () => {
  it('has status 400', () => {
    const err = new ValidationError('test');
    expect(err.status).toBe(400);
    expect(err.name).toBe('ValidationError');
  });
});

describe('str', () => {
  it('trims whitespace', () => {
    expect(str('  hello  ', 'test')).toBe('hello');
  });

  it('returns null for empty string when not required', () => {
    expect(str('', 'test')).toBeNull();
    expect(str(null, 'test')).toBeNull();
    expect(str(undefined, 'test')).toBeNull();
  });

  it('throws when required but missing', () => {
    expect(() => str('', 'name', { required: true })).toThrow('name is required');
    expect(() => str(null, 'name', { required: true })).toThrow('name is required');
  });

  it('throws when below min length', () => {
    expect(() => str('ab', 'name', { min: 3 })).toThrow('name must be at least 3 characters');
  });

  it('throws when above max length', () => {
    expect(() => str('abcdef', 'name', { max: 3 })).toThrow('name must be 3 characters or less');
  });

  it('returns trimmed string when valid', () => {
    expect(str('hello', 'test', { min: 2, max: 10 })).toBe('hello');
  });

  it('converts non-string values', () => {
    expect(str(123, 'test')).toBe('123');
  });
});

describe('email', () => {
  it('returns lowercase email', () => {
    expect(email('Test@Example.COM')).toBe('test@example.com');
  });

  it('throws on invalid email', () => {
    expect(() => email('not-an-email')).toThrow('not a valid email address');
  });

  it('throws on email with spaces', () => {
    expect(() => email('test @example.com')).toThrow('not a valid email address');
  });

  it('returns null for empty', () => {
    expect(email('')).toBeNull();
  });

  it('accepts valid emails', () => {
    expect(email('user@domain.com')).toBe('user@domain.com');
    expect(email('a.b+c@test.co.in')).toBe('a.b+c@test.co.in');
  });
});

describe('num', () => {
  it('parses valid number', () => {
    expect(num('42', 'test')).toBe(42);
    expect(num(42, 'test')).toBe(42);
  });

  it('throws on NaN', () => {
    expect(() => num('abc', 'test')).toThrow('test must be a number');
  });

  it('throws when below min', () => {
    expect(() => num('5', 'age', { min: 18 })).toThrow('age must be at least 18');
  });

  it('throws when above max', () => {
    expect(() => num('150', 'age', { max: 100 })).toThrow('age must be 100 or less');
  });

  it('returns null for empty when not required', () => {
    expect(num('', 'test')).toBeNull();
  });

  it('throws when required but missing', () => {
    expect(() => num('', 'count', { required: true })).toThrow('count is required');
  });

  it('accepts floats', () => {
    expect(num('3.14', 'pi')).toBe(3.14);
  });
});

describe('enumVal', () => {
  it('returns value when valid', () => {
    expect(enumVal('active', 'status', ['active', 'inactive'])).toBe('active');
  });

  it('throws when not in allowed values', () => {
    expect(() => enumVal('unknown', 'status', ['active', 'inactive'])).toThrow(
      'status must be one of: active, inactive'
    );
  });

  it('returns null for empty when not required', () => {
    expect(enumVal('', 'status', ['active', 'inactive'])).toBeNull();
  });

  it('throws when required but missing', () => {
    expect(() => enumVal('', 'status', ['active', 'inactive'], true)).toThrow('status is required');
  });
});

describe('validationResponse', () => {
  it('returns 400 for ValidationError', () => {
    const err = new ValidationError('bad input');
    const res = validationResponse(err);
    expect(res).not.toBeNull();
    expect(res.status).toBe(400);
  });

  it('returns null for non-ValidationError', () => {
    expect(validationResponse(new Error('other'))).toBeNull();
  });
});
