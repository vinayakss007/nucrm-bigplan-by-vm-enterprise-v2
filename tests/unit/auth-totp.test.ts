import { describe, it, expect } from 'vitest';

describe('TOTP Verification', () => {
  it('exports verifyTOTP function', async () => {
    const { verifyTOTP } = await import('@/lib/auth/totp');
    expect(typeof verifyTOTP).toBe('function');
  });

  it('returns false for empty secret', async () => {
    const { verifyTOTP } = await import('@/lib/auth/totp');
    expect(verifyTOTP('', '123456')).toBe(false);
  });

  it('returns false for empty token', async () => {
    const { verifyTOTP } = await import('@/lib/auth/totp');
    expect(verifyTOTP('JBSWY3DPEHPK3PXP', '')).toBe(false);
  });

  it('returns false for non-numeric token', async () => {
    const { verifyTOTP } = await import('@/lib/auth/totp');
    expect(verifyTOTP('JBSWY3DPEHPK3PXP', 'abcde')).toBe(false);
  });

  it('returns false for token not 6 digits', async () => {
    const { verifyTOTP } = await import('@/lib/auth/totp');
    expect(verifyTOTP('JBSWY3DPEHPK3PXP', '12345')).toBe(false);
    expect(verifyTOTP('JBSWY3DPEHPK3PXP', '1234567')).toBe(false);
  });

  it('returns false for invalid base32 secret', async () => {
    const { verifyTOTP } = await import('@/lib/auth/totp');
    expect(verifyTOTP('!!!!!!', '123456')).toBe(false);
  });

  it('handles secrets with padding and special chars', async () => {
    const { verifyTOTP } = await import('@/lib/auth/totp');
    expect(verifyTOTP('JBSWY3D?P EHP@K3PXP', '123456')).toBe(false);
  });

  it('returns false for wrong code', async () => {
    const { verifyTOTP } = await import('@/lib/auth/totp');
    const result = verifyTOTP('JBSWY3DPEHPK3PXP', '000000');
    expect(result).toBe(false);
  });
});
