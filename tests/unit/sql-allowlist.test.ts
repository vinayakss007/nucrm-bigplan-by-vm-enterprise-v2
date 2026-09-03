import { describe, it, expect } from 'vitest';
import { validateTableName } from '@/lib/sql-allowlist';

describe('validateTableName', () => {
  it('returns the table name when passed a valid table', () => {
    expect(validateTableName('contacts')).toBe('contacts');
    expect(validateTableName('users')).toBe('users');
    expect(validateTableName('deals')).toBe('deals');
  });

  it('throws an Error when passed an invalid table name', () => {
    expect(() => validateTableName('invalid_table')).toThrow('Invalid table name: "invalid_table". Table names must be from the allowlist.');
    expect(() => validateTableName('users; DROP TABLE users;')).toThrow('Invalid table name: "users; DROP TABLE users;". Table names must be from the allowlist.');
    expect(() => validateTableName('')).toThrow('Invalid table name: "". Table names must be from the allowlist.');
  });
});
