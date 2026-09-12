import { describe, it, expect } from 'vitest';
import { isValidTableName, validateTableName } from '@/lib/sql-allowlist';

describe('sql-allowlist', () => {
  describe('isValidTableName', () => {
    it('returns true for a valid table name', () => {
      expect(isValidTableName('contacts')).toBe(true);
      expect(isValidTableName('users')).toBe(true);
      expect(isValidTableName('deals')).toBe(true);
    });

    it('returns false for an invalid table name', () => {
      expect(isValidTableName('invalid_table')).toBe(false);
      expect(isValidTableName('not_a_real_table')).toBe(false);
    });

    it('returns false for SQL injection attempts', () => {
      expect(isValidTableName('contacts; DROP TABLE users;')).toBe(false);
      expect(isValidTableName('contacts OR 1=1')).toBe(false);
      expect(isValidTableName("contacts'")).toBe(false);
      expect(isValidTableName('contacts"')).toBe(false);
    });

    it('is case-sensitive', () => {
      // Assuming it should be exact match. The Set has 'contacts', not 'CONTACTS'
      expect(isValidTableName('CONTACTS')).toBe(false);
    });

    it('returns false for empty strings', () => {
      expect(isValidTableName('')).toBe(false);
    });
  });

  describe('validateTableName', () => {
    it('returns the table name if valid', () => {
      expect(validateTableName('contacts')).toBe('contacts');
    });

    it('throws an error for an invalid table name', () => {
      expect(() => validateTableName('invalid_table')).toThrow('Invalid table name: "invalid_table"');
    });

    it('throws an error for SQL injection attempts', () => {
      expect(() => validateTableName('contacts; DROP TABLE users;')).toThrow('Invalid table name: "contacts; DROP TABLE users;"');
    });

    it('throws an error for an empty table name', () => {
      expect(() => validateTableName('')).toThrow('Invalid table name: ""');
    });
  });
});
