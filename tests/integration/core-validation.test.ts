import { describe, it, expect } from 'vitest';
import {
  ValidationError, str, email, num, enumVal, validationResponse,
  validate, contactSchema, dealSchema, taskSchema, companySchema, ticketSchema,
} from '@/lib/validate';

describe('Core Validation Integration', () => {
  describe('Contact creation flow', () => {
    const validContact = { first_name: 'John', last_name: 'Doe', email: 'john@example.com', phone: '+1-555-1234' };

    it('validates a complete contact submission', () => {
      const errors = validate(validContact, contactSchema);
      expect(errors).toBeNull();
    });

    it('rejects contact with missing first_name', () => {
      const errors = validate({ ...validContact, first_name: '' }, contactSchema);
      expect(errors).not.toBeNull();
      expect(errors!.first_name).toContain('required');
    });

    it('rejects contact with invalid email', () => {
      const errors = validate({ ...validContact, email: 'not-an-email' }, contactSchema);
      expect(errors).not.toBeNull();
    });

    it('rejects contact with invalid phone format', () => {
      const errors = validate({ ...validContact, phone: 'a'.repeat(30) }, contactSchema);
      expect(errors).not.toBeNull();
    });
  });

  describe('Deal creation flow', () => {
    it('validates a complete deal', () => {
      expect(validate({ title: 'Big Deal' }, dealSchema)).toBeNull();
    });

    it('rejects deal with empty title', () => {
      expect(validate({ title: '' }, dealSchema)).not.toBeNull();
    });
  });

  describe('Task creation flow', () => {
    it('validates a complete task', () => {
      expect(validate({ title: 'Do work' }, taskSchema)).toBeNull();
    });

    it('rejects task without title', () => {
      expect(validate({}, taskSchema)).not.toBeNull();
    });
  });

  describe('Company creation flow', () => {
    it('validates a complete company', () => {
      expect(validate({ name: 'Acme Corp' }, companySchema)).toBeNull();
    });

    it('rejects company without name', () => {
      expect(validate({ name: '' }, companySchema)).not.toBeNull();
    });
  });

  describe('Ticket creation flow', () => {
    it('validates a complete ticket', () => {
      expect(validate({ subject: 'Need help' }, ticketSchema)).toBeNull();
    });

    it('rejects ticket without subject', () => {
      expect(validate({}, ticketSchema)).not.toBeNull();
    });
  });

  describe('Legacy validation helpers', () => {
    it('str trims and validates', () => {
      expect(str('  hello  ', 'name')).toBe('hello');
      expect(() => str('', 'name', { required: true })).toThrow(ValidationError);
    });

    it('email validates and lowercases', () => {
      expect(email('Test@Example.COM')).toBe('test@example.com');
      expect(() => email('invalid')).toThrow(ValidationError);
    });

    it('num validates numeric values', () => {
      expect(num('42', 'age')).toBe(42);
      expect(() => num('abc', 'age')).toThrow(ValidationError);
    });

    it('enumVal validates against options', () => {
      expect(enumVal('active', 'status', ['active', 'inactive'])).toBe('active');
      expect(() => enumVal('unknown', 'status', ['active', 'inactive'])).toThrow();
    });

    it('validationResponse handles ValidationError', () => {
      const err = new ValidationError('bad input');
      const res = validationResponse(err);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(400);
    });

    it('validationResponse returns null for non-ValidationError', () => {
      expect(validationResponse(new Error('other'))).toBeNull();
    });
  });
});
