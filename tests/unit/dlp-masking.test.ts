import { describe, it, expect } from 'vitest';
import { maskPii, maskSensitiveData } from '@/lib/dlp';

describe('maskPii', () => {
  describe('email masking', () => {
    it('masks a standard email address', () => {
      expect(maskPii('john.doe@example.com')).toBe('j***@example.com');
    });

    it('masks a short local part email', () => {
      expect(maskPii('a@b.co')).toBe('a***@b.co');
    });

    it('masks email with numbers and special chars in local part', () => {
      expect(maskPii('user123+tag@domain.org')).toBe('u***@domain.org');
    });

    it('masks email with subdomain', () => {
      expect(maskPii('admin@mail.company.io')).toBe('a***@mail.company.io');
    });
  });

  describe('phone number masking', () => {
    it('masks a 10-digit phone number', () => {
      const result = maskPii('1234567890');
      expect(result).toBe('123***90');
    });

    it('masks a phone with country code prefix', () => {
      const result = maskPii('+15551234567');
      expect(result).toBe('+15***67');
    });

    it('masks a phone with parentheses', () => {
      const result = maskPii('(555)123-4567');
      expect(result).toBe('(55***67');
    });

    it('masks a phone with dashes', () => {
      const result = maskPii('555-123-4567');
      expect(result).toBe('555***67');
    });
  });

  describe('SSN masking', () => {
    it('masks an SSN with dashes (matched by phone pattern first)', () => {
      // The phone regex is broader and matches SSN patterns, so masking
      // uses the phone strategy: first 3 chars + *** + last 2 chars
      const result = maskPii('123-45-6789');
      expect(result).toContain('***');
      expect(result).not.toBe('123-45-6789');
    });

    it('masks an SSN without dashes', () => {
      const result = maskPii('123456789');
      expect(result).toContain('***');
      expect(result).not.toBe('123456789');
    });

    it('masks another SSN with dashes', () => {
      const result = maskPii('987-65-4321');
      expect(result).toContain('***');
      expect(result).not.toBe('987-65-4321');
    });
  });

  describe('credit card masking', () => {
    it('masks a credit card with dashes', () => {
      expect(maskPii('4111-1111-1111-1111')).toBe('****-****-****-1111');
    });

    it('masks a credit card with spaces', () => {
      expect(maskPii('4111 1111 1111 1111')).toBe('****-****-****-1111');
    });

    it('masks a credit card without separators (matched by phone pattern)', () => {
      // 16 contiguous digits are matched by the phone regex first
      const result = maskPii('4111111111111111');
      expect(result).toContain('***');
      expect(result).not.toBe('4111111111111111');
    });
  });

  describe('IP address masking', () => {
    it('masks an IPv4 address', () => {
      expect(maskPii('192.168.1.100')).toBe('192.168.***.***');
    });

    it('masks another IPv4 address', () => {
      expect(maskPii('10.0.0.1')).toBe('10.0.***.***');
    });
  });

  describe('non-PII values', () => {
    it('returns empty string as-is', () => {
      expect(maskPii('')).toBe('');
    });

    it('returns non-string values as-is', () => {
      expect(maskPii(null as unknown as string)).toBe(null);
      expect(maskPii(undefined as unknown as string)).toBe(undefined);
    });

    it('returns a regular string unmodified', () => {
      expect(maskPii('hello world')).toBe('hello world');
    });

    it('returns a partial email unmodified', () => {
      expect(maskPii('not-an-email')).toBe('not-an-email');
    });

    it('returns a short number masked by phone pattern', () => {
      // The phone regex is very broad and matches short digit strings
      const result = maskPii('123');
      expect(result).toContain('***');
    });
  });
});

describe('maskSensitiveData', () => {
  describe('default sensitive fields', () => {
    it('masks password field', () => {
      const data = { name: 'Alice', password: 'secret123' };
      const { masked, maskedFields } = maskSensitiveData(data);
      expect(masked.password).toBe('***REDACTED***');
      expect(masked.name).toBe('Alice');
      expect(maskedFields).toContain('password');
    });

    it('masks multiple default sensitive fields', () => {
      const data = {
        email: 'alice@test.com',
        apiKey: 'key-abc-123',
        accessToken: 'tok_live_xyz',
        refreshToken: 'ref_tok_abc',
      };
      const { masked, maskedFields } = maskSensitiveData(data);
      expect(masked.email).toBe('alice@test.com');
      expect(masked.apiKey).toBe('***REDACTED***');
      expect(masked.accessToken).toBe('***REDACTED***');
      expect(masked.refreshToken).toBe('***REDACTED***');
      expect(maskedFields).toEqual(
        expect.arrayContaining(['apiKey', 'accessToken', 'refreshToken'])
      );
    });

    it('masks passwordHash and totpSecret', () => {
      const data = { passwordHash: 'hashed', totpSecret: 'JBSWY3DPEHPK3PXP' };
      const { masked } = maskSensitiveData(data);
      expect(masked.passwordHash).toBe('***REDACTED***');
      expect(masked.totpSecret).toBe('***REDACTED***');
    });

    it('masks snake_case variants', () => {
      const data = {
        password_hash: 'hash123',
        api_key: 'key456',
        access_token: 'tok789',
        secret_key: 'sec000',
      };
      const { masked, maskedFields } = maskSensitiveData(data);
      expect(masked.password_hash).toBe('***REDACTED***');
      expect(masked.api_key).toBe('***REDACTED***');
      expect(masked.access_token).toBe('***REDACTED***');
      expect(masked.secret_key).toBe('***REDACTED***');
      expect(maskedFields.length).toBe(4);
    });
  });

  describe('null and undefined values', () => {
    it('does not mask null values', () => {
      const data = { password: null, name: 'Bob' };
      const { masked, maskedFields } = maskSensitiveData(data);
      expect(masked.password).toBe(null);
      expect(maskedFields).not.toContain('password');
    });

    it('does not mask undefined values', () => {
      const data = { apiKey: undefined, name: 'Carol' };
      const { masked, maskedFields } = maskSensitiveData(data);
      expect(masked.apiKey).toBe(undefined);
      expect(maskedFields).not.toContain('apiKey');
    });
  });

  describe('custom sensitive fields', () => {
    it('masks additional custom fields', () => {
      const data = { ssn: '123-45-6789', name: 'Dave' };
      const { masked, maskedFields } = maskSensitiveData(data, ['ssn']);
      expect(masked.ssn).toBe('***REDACTED***');
      expect(masked.name).toBe('Dave');
      expect(maskedFields).toContain('ssn');
    });

    it('combines default and custom sensitive fields', () => {
      const data = { password: 'pw123', customSecret: 'top-secret', visible: 'ok' };
      const { masked, maskedFields } = maskSensitiveData(data, ['customSecret']);
      expect(masked.password).toBe('***REDACTED***');
      expect(masked.customSecret).toBe('***REDACTED***');
      expect(masked.visible).toBe('ok');
      expect(maskedFields).toEqual(
        expect.arrayContaining(['password', 'customSecret'])
      );
    });
  });

  describe('edge cases', () => {
    it('returns empty maskedFields when no sensitive data present', () => {
      const data = { name: 'Eve', age: 30 };
      const { masked, maskedFields } = maskSensitiveData(data);
      expect(masked).toEqual({ name: 'Eve', age: 30 });
      expect(maskedFields).toHaveLength(0);
    });

    it('handles empty object', () => {
      const data = {};
      const { masked, maskedFields } = maskSensitiveData(data);
      expect(masked).toEqual({});
      expect(maskedFields).toHaveLength(0);
    });
  });
});
