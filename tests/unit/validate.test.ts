import { describe, it, expect } from 'vitest';
import {
  ValidationError,
  str,
  email,
  num,
  enumVal,
  validationResponse,
  validate,
  contactSchema,
  dealSchema,
  taskSchema,
  companySchema,
  ticketSchema,
} from '@/lib/validate';

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

  it('supports boolean shorthand for required', () => {
    expect(() => str('', 'name', true)).toThrow('name is required');
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

  it('handles zero as valid string', () => {
    expect(str(0, 'test')).toBe('0');
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

  it('returns null for empty when not required', () => {
    expect(email('')).toBeNull();
    expect(email(null)).toBeNull();
    expect(email(undefined)).toBeNull();
  });

  it('throws when required but missing', () => {
    expect(() => email('', 'email', true)).toThrow('email is required');
  });

  it('accepts valid emails', () => {
    expect(email('user@domain.com')).toBe('user@domain.com');
    expect(email('a.b+c@test.co.in')).toBe('a.b+c@test.co.in');
  });

  it('accepts field name parameter', () => {
    expect(() => email('', 'work_email', true)).toThrow('work_email is required');
  });

  it('uses default field name "email"', () => {
    expect(() => email('', undefined, true)).toThrow('email is required');
  });

  it('uses default field name "email" when field param is an object', () => {
    const result = email('test@test.com', { notUsed: true });
    expect(result).toBe('test@test.com');
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

  it('supports boolean shorthand for required', () => {
    expect(() => num('', 'count', true)).toThrow('count is required');
  });

  it('returns null for null/undefined when not required', () => {
    expect(num(null, 'test')).toBeNull();
    expect(num(undefined, 'test')).toBeNull();
  });

  it('accepts floats', () => {
    expect(num('3.14', 'pi')).toBe(3.14);
  });

  it('accepts zero', () => {
    expect(num('0', 'test')).toBe(0);
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
    expect(res!.status).toBe(400);
    expect(res!.error).toBe('bad input');
  });

  it('returns null for non-ValidationError', () => {
    expect(validationResponse(new Error('other'))).toBeNull();
  });

  it('returns null for non-Error objects', () => {
    expect(validationResponse('string')).toBeNull();
    expect(validationResponse(null)).toBeNull();
  });
});

describe('validate (new schema API)', () => {
  it('returns null when all fields pass', () => {
    const data = { name: 'John', email: 'john@test.com', age: 25 };
    const schema = {
      name: { required: true },
      email: { email: true },
    };
    expect(validate(data, schema)).toBeNull();
  });

  it('returns errors for required fields', () => {
    const data = { name: '' };
    const schema = { name: { required: true } };
    const errors = validate(data, schema);
    expect(errors).toEqual({ name: 'name is required' });
  });

  it('returns errors for missing fields', () => {
    const data = {};
    const schema = { name: { required: true } };
    expect(validate(data, schema)).toEqual({ name: 'name is required' });
  });

  it('validates email format', () => {
    const data = { email: 'not-an-email' };
    const schema = { email: { email: true } };
    expect(validate(data, schema)).toEqual({ email: 'Invalid email address' });
  });

  it('passes valid email', () => {
    const data = { email: 'user@domain.com' };
    const schema = { email: { email: true } };
    expect(validate(data, schema)).toBeNull();
  });

  it('validates minLength', () => {
    const data = { password: 'ab' };
    const schema = { password: { minLength: 8 } };
    expect(validate(data, schema)).toEqual({ password: 'password must be at least 8 characters' });
  });

  it('validates maxLength', () => {
    const data = { title: 'a'.repeat(300) };
    const schema = { title: { maxLength: 200 } };
    expect(validate(data, schema)).toEqual({ title: 'title must be at most 200 characters' });
  });

  it('validates pattern', () => {
    const data = { phone: 'abc' };
    const schema = { phone: { pattern: /^\d{3}-\d{4}$/ } };
    expect(validate(data, schema)).toEqual({ phone: 'phone has invalid format' });
  });

  it('passes pattern match', () => {
    const data = { phone: '555-1234' };
    const schema = { phone: { pattern: /^\d{3}-\d{4}$/ } };
    expect(validate(data, schema)).toBeNull();
  });

  it('uses custom error message for required field', () => {
    const data = { email: '' };
    const schema = { email: { required: true, message: 'Custom error' } };
    expect(validate(data, schema)).toEqual({ email: 'Custom error' });
  });

  it('uses custom error message for pattern validation', () => {
    const data = { code: 'bad' };
    const schema = { code: { pattern: /^\d{6}$/, message: 'Code must be 6 digits' } };
    expect(validate(data, schema)).toEqual({ code: 'Code must be 6 digits' });
  });

  it('skips optional fields with no value', () => {
    const data = { name: 'John' };
    const schema = { name: { required: true }, email: { email: true } };
    expect(validate(data, schema)).toBeNull();
  });

  it('returns multiple validation errors', () => {
    const data = { name: '', email: 'bad' };
    const schema = { name: { required: true }, email: { email: true } };
    const errors = validate(data, schema);
    expect(errors).toHaveProperty('name');
    expect(errors).toHaveProperty('email');
  });

  it('handles whitespace-only strings as empty', () => {
    const data = { name: '   ' };
    const schema = { name: { required: true } };
    expect(validate(data, schema)).toEqual({ name: 'name is required' });
  });
});

describe('pre-defined schemas', () => {
  it('contactSchema validates required first_name', () => {
    expect(validate({}, contactSchema)).toHaveProperty('first_name');
    expect(validate({ first_name: 'John' }, contactSchema)).toBeNull();
  });

  it('contactSchema validates maxLength', () => {
    const data = { first_name: 'a'.repeat(200) };
    expect(validate(data, contactSchema)).toHaveProperty('first_name');
  });

  it('contactSchema validates email', () => {
    const data = { first_name: 'John', email: 'bad' };
    expect(validate(data, contactSchema)).toHaveProperty('email');
  });

  it('contactSchema validates phone pattern', () => {
    const data = { first_name: 'John', phone: 'abc' };
    expect(validate(data, contactSchema)).toHaveProperty('phone');
  });

  it('contactSchema passes valid contact', () => {
    const data = { first_name: 'John', email: 'john@test.com', phone: '555-1234' };
    expect(validate(data, contactSchema)).toBeNull();
  });

  it('dealSchema requires title', () => {
    expect(validate({}, dealSchema)).toHaveProperty('title');
    expect(validate({ title: 'Big Deal' }, dealSchema)).toBeNull();
  });

  it('dealSchema validates maxLength', () => {
    expect(validate({ title: 'a'.repeat(300) }, dealSchema)).toHaveProperty('title');
  });

  it('taskSchema requires title', () => {
    expect(validate({}, taskSchema)).toHaveProperty('title');
    expect(validate({ title: 'Task 1' }, taskSchema)).toBeNull();
  });

  it('companySchema requires name', () => {
    expect(validate({}, companySchema)).toHaveProperty('name');
    expect(validate({ name: 'Acme Corp' }, companySchema)).toBeNull();
  });

  it('companySchema validates website maxLength', () => {
    expect(validate({ name: 'Acme', website: 'x'.repeat(600) }, companySchema)).toHaveProperty('website');
  });

  it('ticketSchema requires subject', () => {
    expect(validate({}, ticketSchema)).toHaveProperty('subject');
    expect(validate({ subject: 'Help needed' }, ticketSchema)).toBeNull();
  });

  it('ticketSchema validates subject maxLength', () => {
    expect(validate({ subject: 'a'.repeat(400) }, ticketSchema)).toHaveProperty('subject');
  });
});
