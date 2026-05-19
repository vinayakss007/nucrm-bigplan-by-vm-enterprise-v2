import { describe, it, expect } from 'vitest';
import { validate, contactSchema, dealSchema, taskSchema, companySchema, ticketSchema } from '@/lib/validate';

describe('API Validation Schemas', () => {
  describe('contactSchema', () => {
    it('passes valid contact data', () => {
      const errors = validate({ first_name: 'John', email: 'john@example.com' }, contactSchema);
      expect(errors).toBeNull();
    });

    it('rejects missing first_name', () => {
      const errors = validate({ email: 'john@example.com' }, contactSchema);
      expect(errors).not.toBeNull();
      expect(errors!.first_name).toContain('required');
    });

    it('rejects invalid email', () => {
      const errors = validate({ first_name: 'John', email: 'not-an-email' }, contactSchema);
      expect(errors).not.toBeNull();
      expect(errors!.email).toContain('email');
    });

    it('rejects first_name over 100 chars', () => {
      const errors = validate({ first_name: 'x'.repeat(101) }, contactSchema);
      expect(errors).not.toBeNull();
      expect(errors!.first_name).toContain('100');
    });
  });

  describe('dealSchema', () => {
    it('passes valid deal data', () => {
      const errors = validate({ title: 'Big Deal' }, dealSchema);
      expect(errors).toBeNull();
    });

    it('rejects empty title', () => {
      const errors = validate({ title: '' }, dealSchema);
      expect(errors).not.toBeNull();
    });
  });

  describe('taskSchema', () => {
    it('passes valid task data', () => {
      const errors = validate({ title: 'Do something' }, taskSchema);
      expect(errors).toBeNull();
    });

    it('rejects missing title', () => {
      const errors = validate({}, taskSchema);
      expect(errors).not.toBeNull();
    });
  });

  describe('companySchema', () => {
    it('passes valid company data', () => {
      const errors = validate({ name: 'Acme Corp' }, companySchema);
      expect(errors).toBeNull();
    });

    it('rejects empty name', () => {
      const errors = validate({ name: '' }, companySchema);
      expect(errors).not.toBeNull();
    });
  });

  describe('ticketSchema', () => {
    it('passes valid ticket data', () => {
      const errors = validate({ subject: 'Need help' }, ticketSchema);
      expect(errors).toBeNull();
    });

    it('rejects missing subject', () => {
      const errors = validate({}, ticketSchema);
      expect(errors).not.toBeNull();
    });
  });

  describe('validate rules', () => {
    it('rejects value below minLength', () => {
      const errors = validate({ name: 'ab' }, { name: { minLength: 3 } });
      expect(errors!.name).toContain('at least 3');
    });

    it('rejects value above maxLength', () => {
      const errors = validate({ name: 'toolongname' }, { name: { maxLength: 5 } });
      expect(errors!.name).toContain('at most 5');
    });

    it('rejects value not matching pattern', () => {
      const errors = validate({ phone: 'abc' }, { phone: { pattern: /^\d+$/, message: 'Digits only' } });
      expect(errors!.phone).toContain('Digits only');
    });

    it('returns custom message for invalid pattern', () => {
      const errors = validate({ code: 'bad!' }, { code: { pattern: /^[A-Z]+$/, message: 'Uppercase letters only' } });
      expect(errors!.code).toBe('Uppercase letters only');
    });

    it('uses field name as default for pattern error', () => {
      const errors = validate({ val: 'x' }, { val: { pattern: /^\d+$/ } });
      expect(errors!.val).toContain('val has invalid format');
    });

    it('required fails for empty string', () => {
      const errors = validate({ name: '' }, { name: { required: true } });
      expect(errors!.name).toContain('required');
    });

    it('passes when optional field is missing', () => {
      const errors = validate({}, { name: { maxLength: 10 } });
      expect(errors).toBeNull();
    });
  });
});
