import { describe, it, expect } from 'vitest';
import { 
  ValidationError, 
  str, 
  email, 
  num, 
  enumVal, 
  validationResponse 
} from '@/lib/validate';

describe('validate', () => {
  describe('ValidationError', () => {
    it('creates validation error with status 400', () => {
      const err = new ValidationError('Test error');
      expect(err.message).toBe('Test error');
      expect(err.status).toBe(400);
      expect(err.name).toBe('ValidationError');
    });
  });

  describe('str', () => {
    it('trims and returns string', () => {
      expect(str('  hello  ', 'name')).toBe('hello');
    });

    it('returns null for empty/undefined/null when not required', () => {
      expect(str('', 'name')).toBeNull();
      expect(str(undefined, 'name')).toBeNull();
      expect(str(null, 'name')).toBeNull();
    });

    it('throws when required and empty', () => {
      expect(() => str('', 'name', { required: true })).toThrow('name is required');
      expect(() => str(undefined, 'name', { required: true })).toThrow('name is required');
    });

    it('validates min length', () => {
      expect(() => str('ab', 'password', { min: 3 })).toThrow('at least 3 characters');
      expect(str('abc', 'password', { min: 3 })).toBe('abc');
    });

    it('validates max length', () => {
      expect(() => str('abcdef', 'code', { max: 5 })).toThrow('5 characters or less');
      expect(str('abc', 'code', { max: 5 })).toBe('abc');
    });

    it('handles non-string values', () => {
      expect(str(123, 'field')).toBe('123');
    });
  });

  describe('email', () => {
    it('validates and lowercases email', () => {
      expect(email('User@Example.COM')).toBe('user@example.com');
    });

    it('returns null for empty email', () => {
      expect(email('')).toBeNull();
      expect(email(null)).toBeNull();
    });

    it('throws on invalid email format', () => {
      expect(() => email('invalid-email')).toThrow('not a valid email address');
      expect(() => email('@domain.com')).toThrow('not a valid email address');
      expect(() => email('user@')).toThrow('not a valid email address');
    });

    it('handles email with plus sign', () => {
      expect(email('user+tag@example.com')).toBe('user+tag@example.com');
    });
  });

  describe('num', () => {
    it('parses and returns number', () => {
      expect(num('42', 'age')).toBe(42);
      expect(num(42, 'age')).toBe(42);
    });

    it('returns null for empty/undefined/null when not required', () => {
      expect(num('', 'age')).toBeNull();
      expect(num(undefined, 'age')).toBeNull();
      expect(num(null, 'age')).toBeNull();
    });

    it('throws when required and empty', () => {
      expect(() => num('', 'age', { required: true })).toThrow('age is required');
    });

    it('throws on non-numeric value', () => {
      expect(() => num('abc', 'age')).toThrow('must be a number');
    });

    it('validates min value', () => {
      expect(() => num(0, 'age', { min: 1 })).toThrow('at least 1');
      expect(num(1, 'age', { min: 1 })).toBe(1);
    });

    it('validates max value', () => {
      expect(() => num(150, 'age', { max: 120 })).toThrow('120 or less');
      expect(num(120, 'age', { max: 120 })).toBe(120);
    });
  });

  describe('enumVal', () => {
    const statuses = ['active', 'inactive', 'pending'] as const;

    it('returns value when valid', () => {
      expect(enumVal('active', 'status', statuses)).toBe('active');
    });

    it('returns null when empty and not required', () => {
      expect(enumVal('', 'status', statuses)).toBeNull();
      expect(enumVal(null, 'status', statuses)).toBeNull();
    });

    it('throws when required and empty', () => {
      expect(() => enumVal('', 'status', statuses, true)).toThrow('status is required');
    });

    it('throws on invalid value', () => {
      expect(() => enumVal('invalid', 'status', statuses)).toThrow('must be one of');
    });

    it('works with default required parameter', () => {
      expect(enumVal('pending', 'status', statuses, true)).toBe('pending');
    });
  });

  describe('validationResponse', () => {
    it('returns 400 response for ValidationError', () => {
      const err = new ValidationError('Validation failed');
      const response = validationResponse(err);
      
      expect(response).toBeDefined();
    });

    it('returns null for non-ValidationError', () => {
      const err = new Error('Regular error');
      expect(validationResponse(err)).toBeNull();
    });
  });
});
