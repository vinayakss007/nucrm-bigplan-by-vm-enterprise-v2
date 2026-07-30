import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => mockSelect()),
        })),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => mockSelect()),
          })),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => mockInsert()),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => mockUpdate()),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => mockDelete()),
    })),
  },
}));

vi.mock('@/lib/email/service', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/auth/session', () => ({
  hashPassword: vi.fn().mockResolvedValue('$hashed$'),
  validatePassword: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/dev-logger', () => ({
  devLogger: { error: vi.fn(), log: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

describe('Password Reset Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockResolvedValue([]);
    mockInsert.mockResolvedValue([{}]);
    mockUpdate.mockResolvedValue([{}]);
    mockDelete.mockResolvedValue({ catch: vi.fn() });
  });

  describe('requestPasswordReset', () => {
    it('returns success even when email not found (prevents enumeration)', async () => {
      const { requestPasswordReset } = await import('@/lib/auth/password-reset');
      mockSelect.mockResolvedValue([]);

      const result = await requestPasswordReset('unknown@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toContain('If that email exists');
    });

    it('generates token and sends email for existing user', async () => {
      const { requestPasswordReset } = await import('@/lib/auth/password-reset');
      const { sendEmail } = await import('@/lib/email/service');

      mockSelect.mockResolvedValue([{ id: 'user-1', email: 'test@co.com', fullName: 'Test User' }]);

      // Mock env for email sending
      process.env.RESEND_API_KEY = 'test-key';

      const result = await requestPasswordReset('test@co.com', 'https://app.nucrm.com');

      expect(result.success).toBe(true);
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@co.com',
          subject: expect.stringContaining('Reset'),
        })
      );

      delete process.env.RESEND_API_KEY;
    });

    it('handles errors gracefully without revealing internals', async () => {
      const { requestPasswordReset } = await import('@/lib/auth/password-reset');
      mockSelect.mockRejectedValue(new Error('DB connection failed'));

      const result = await requestPasswordReset('test@co.com');

      // Still returns success to prevent enumeration even on errors
      expect(result.success).toBe(true);
    });
  });

  describe('verifyResetToken', () => {
    it('rejects empty token', async () => {
      const { verifyResetToken } = await import('@/lib/auth/password-reset');
      const result = await verifyResetToken('');
      expect(result.valid).toBe(false);
    });

    it('rejects token with wrong length', async () => {
      const { verifyResetToken } = await import('@/lib/auth/password-reset');
      const result = await verifyResetToken('short');
      expect(result.valid).toBe(false);
    });

    it('rejects expired token (not found in DB)', async () => {
      const { verifyResetToken } = await import('@/lib/auth/password-reset');
      mockSelect.mockResolvedValue([]);

      // 64 chars = 32 bytes hex
      const fakeToken = 'a'.repeat(64);
      const result = await verifyResetToken(fakeToken);

      expect(result.valid).toBe(false);
    });

    it('returns valid with userId for good token', async () => {
      const { verifyResetToken } = await import('@/lib/auth/password-reset');

      // First call: find reset record
      mockSelect.mockResolvedValueOnce([{
        id: 'reset-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 3600000),
      }]);
      // Second call: get user email
      mockSelect.mockResolvedValueOnce([{ email: 'test@co.com' }]);

      const fakeToken = 'b'.repeat(64);
      const result = await verifyResetToken(fakeToken);

      expect(result.valid).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(result.email).toBe('test@co.com');
    });

    it('handles DB errors gracefully', async () => {
      const { verifyResetToken } = await import('@/lib/auth/password-reset');
      mockSelect.mockRejectedValue(new Error('DB down'));

      const result = await verifyResetToken('c'.repeat(64));
      expect(result.valid).toBe(false);
    });
  });

  describe('resetPassword', () => {
    it('fails with invalid token', async () => {
      const { resetPassword } = await import('@/lib/auth/password-reset');
      mockSelect.mockResolvedValue([]);

      const result = await resetPassword('bad-token', 'NewPassword123!');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid or expired');
    });

    it('fails with weak password', async () => {
      const { resetPassword } = await import('@/lib/auth/password-reset');
      const { validatePassword } = await import('@/lib/auth/session');

      // Token valid
      mockSelect.mockResolvedValueOnce([{
        id: 'reset-1', userId: 'user-1', expiresAt: new Date(Date.now() + 3600000),
      }]);
      mockSelect.mockResolvedValueOnce([{ email: 'test@co.com' }]);

      // Password too weak
      (validatePassword as ReturnType<typeof vi.fn>).mockReturnValue('Password must be at least 12 characters');

      const result = await resetPassword('d'.repeat(64), 'short');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Password must be');
    });

    it('succeeds with valid token and strong password', async () => {
      const { resetPassword } = await import('@/lib/auth/password-reset');
      const { hashPassword, validatePassword } = await import('@/lib/auth/session');

      // Token valid
      mockSelect.mockResolvedValueOnce([{
        id: 'reset-1', userId: 'user-1', expiresAt: new Date(Date.now() + 3600000),
      }]);
      mockSelect.mockResolvedValueOnce([{ email: 'test@co.com' }]);

      (validatePassword as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (hashPassword as ReturnType<typeof vi.fn>).mockResolvedValue('$new-hash$');
      mockDelete.mockReturnValue({ catch: vi.fn() });

      const result = await resetPassword('e'.repeat(64), 'StrongPassword123!@#');

      expect(result.success).toBe(true);
      expect(result.message).toContain('reset successfully');
      expect(hashPassword).toHaveBeenCalledWith('StrongPassword123!@#');
    });
  });

  describe('clearResetToken', () => {
    it('soft-deletes reset tokens for user', async () => {
      const { clearResetToken } = await import('@/lib/auth/password-reset');
      await clearResetToken('user-1');
      // Should not throw
    });

    it('handles errors gracefully', async () => {
      const { clearResetToken } = await import('@/lib/auth/password-reset');
      mockUpdate.mockRejectedValue(new Error('DB error'));
      // Should not throw
      await expect(clearResetToken('user-1')).resolves.toBeUndefined();
    });
  });

  describe('Security properties', () => {
    it('uses crypto.randomBytes for token generation (not Math.random)', async () => {
      // Verify by importing and checking the module uses createHash/randomBytes
      const moduleCode = await import('fs').then(fs =>
        fs.readFileSync('lib/auth/password-reset.ts', 'utf-8')
      );
      expect(moduleCode).toContain('randomBytes');
      expect(moduleCode).not.toContain('Math.random');
    });

    it('token expiry is 1 hour', async () => {
      const moduleCode = await import('fs').then(fs =>
        fs.readFileSync('lib/auth/password-reset.ts', 'utf-8')
      );
      expect(moduleCode).toContain('RESET_TOKEN_EXPIRY_HOURS = 1');
    });

    it('hashes token before storing (uses SHA-256)', async () => {
      const moduleCode = await import('fs').then(fs =>
        fs.readFileSync('lib/auth/password-reset.ts', 'utf-8')
      );
      expect(moduleCode).toContain("createHash('sha256')");
    });
  });
});
