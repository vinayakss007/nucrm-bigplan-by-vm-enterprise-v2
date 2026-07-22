import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockResolve: ReturnType<typeof vi.fn>;

const makeChain = () => ({
  from: vi.fn(() => chain),
  innerJoin: vi.fn(() => chain),
  where: vi.fn(() => chain),
  limit: vi.fn(() => mockResolve()),
  values: vi.fn(() => Promise.resolve()),
  set: vi.fn(() => ({ where: mockResolve })),
});
const chain = makeChain();

let mockSelect: ReturnType<typeof vi.fn>;
let mockUpdate: ReturnType<typeof vi.fn>;
let mockInsert: ReturnType<typeof vi.fn>;

vi.mock('@/drizzle/db', () => ({
  get db() {
    return { select: mockSelect, update: mockUpdate, insert: mockInsert };
  },
}));
vi.mock('@/drizzle/schema', () => ({ users: {}, passwordResets: {} }));
vi.mock('@/drizzle/relations', () => ({}));
vi.mock('@/lib/email/service', () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/dev-logger', () => ({ devLogger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/session', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed'),
  validatePassword: vi.fn().mockReturnValue(null),
}));

const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  mockResolve = vi.fn();
  mockSelect = vi.fn(() => chain);
  mockUpdate = vi.fn(() => chain);
  mockInsert = vi.fn(() => chain);
  process.env.NEXT_PUBLIC_APP_URL = 'http://test.app';
});

afterAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
});

describe('clearResetToken', () => {
  it('updates passwordResets with deletedAt', async () => {
    mockResolve.mockResolvedValue(undefined);
    const { clearResetToken } = await import('@/lib/auth/password-reset');
    await clearResetToken('u-1');
    expect(mockUpdate).toHaveBeenCalled();
    expect(chain.set).toHaveBeenCalledWith({ deletedAt: expect.any(Date) });
    expect(mockResolve).toHaveBeenCalled();
  });

  it('does not throw on error', async () => {
    mockResolve.mockRejectedValue(new Error('DB error'));
    const { clearResetToken } = await import('@/lib/auth/password-reset');
    await expect(clearResetToken('u-1')).resolves.not.toThrow();
  });
});

describe('requestPasswordReset', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.SMTP_HOST = '';
  });

  it('returns success when user not found (prevents enumeration)', async () => {
    mockResolve.mockResolvedValue([]);
    const { requestPasswordReset } = await import('@/lib/auth/password-reset');
    const result = await requestPasswordReset('nobody@test.com');
    expect(result.success).toBe(true);
    expect(mockSelect).toHaveBeenCalled();
  });

  it('creates token and sends email when user exists', async () => {
    mockResolve
      .mockResolvedValueOnce([{ id: 'u-1', email: 'user@test.com', fullName: 'Test User' }])
      .mockResolvedValueOnce(undefined);
    const { sendEmail } = await import('@/lib/email/service');
    const { requestPasswordReset } = await import('@/lib/auth/password-reset');
    const result = await requestPasswordReset('user@test.com');
    expect(result.success).toBe(true);
    expect(chain.values).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@test.com', subject: expect.stringContaining('Reset') })
    );
  });

  it('logs token when email not configured', async () => {
    process.env.RESEND_API_KEY = '';
    process.env.SMTP_HOST = '';
    mockResolve.mockResolvedValue([{ id: 'u-2', email: 'u@test.com', fullName: 'User' }]);
    const { requestPasswordReset } = await import('@/lib/auth/password-reset');
    const result = await requestPasswordReset('u@test.com');
    expect(result.success).toBe(true);
    expect(chain.values).toHaveBeenCalled();
  });

  it('returns success on DB error', async () => {
    mockResolve.mockRejectedValue(new Error('DB fail'));
    const { requestPasswordReset } = await import('@/lib/auth/password-reset');
    const result = await requestPasswordReset('user@test.com');
    expect(result.success).toBe(true);
  });

  it('normalizes email to lowercase', async () => {
    mockResolve.mockResolvedValue([{ id: 'u-3', email: 'UPPER@test.com', fullName: 'Upper' }]);
    const { requestPasswordReset } = await import('@/lib/auth/password-reset');
    await requestPasswordReset('UPPER@test.com');
    expect(mockResolve).toHaveBeenCalled();
  });
});

describe('verifyResetToken', () => {
  it('returns valid false for empty token', async () => {
    const { verifyResetToken } = await import('@/lib/auth/password-reset');
    const result = await verifyResetToken('');
    expect(result.valid).toBe(false);
  });

  it('returns valid false for short token', async () => {
    const { verifyResetToken } = await import('@/lib/auth/password-reset');
    const result = await verifyResetToken('abc');
    expect(result.valid).toBe(false);
  });

  it('returns valid true with userId and email for valid token', async () => {
    mockResolve
      .mockResolvedValueOnce([{ id: 'pr-1', userId: 'u-1', expiresAt: new Date(Date.now() + 3600000) }])
      .mockResolvedValueOnce([{ email: 'user@test.com' }]);
    const { verifyResetToken } = await import('@/lib/auth/password-reset');
    const token = 'a'.repeat(64);
    const result = await verifyResetToken(token);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe('u-1');
    expect(result.email).toBe('user@test.com');
  });

  it('returns valid false when no reset record found', async () => {
    mockResolve.mockResolvedValue([]);
    const token = 'a'.repeat(64);
    const { verifyResetToken } = await import('@/lib/auth/password-reset');
    const result = await verifyResetToken(token);
    expect(result.valid).toBe(false);
  });

  it('returns valid false on error', async () => {
    mockResolve.mockRejectedValue(new Error('DB error'));
    const { verifyResetToken } = await import('@/lib/auth/password-reset');
    const result = await verifyResetToken('a'.repeat(64));
    expect(result.valid).toBe(false);
  });
});

describe('resetPassword', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.SMTP_HOST = '';
  });

  it('rejects invalid token', async () => {
    mockResolve.mockResolvedValue([]);
    const { resetPassword } = await import('@/lib/auth/password-reset');
    const result = await resetPassword('abc', 'NewPass123!');
    expect(result.success).toBe(false);
  });

  it('rejects weak password', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    vi.mocked(validatePassword).mockReturnValue('Password too weak');
    mockResolve
      .mockResolvedValueOnce([{ id: 'pr-1', userId: 'u-1', expiresAt: new Date(Date.now() + 3600000) }])
      .mockResolvedValueOnce([{ email: 'u@test.com' }]);
    const { resetPassword } = await import('@/lib/auth/password-reset');
    const result = await resetPassword('a'.repeat(64), 'weak');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Password too weak');
  });

  it('updates password on valid token and password', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    vi.mocked(validatePassword).mockReturnValue(null);
    mockResolve
      .mockResolvedValueOnce([{ id: 'pr-1', userId: 'u-1', expiresAt: new Date(Date.now() + 3600000) }])
      .mockResolvedValueOnce([{ email: 'u@test.com' }])
      .mockResolvedValueOnce(undefined);
    const { hashPassword } = await import('@/lib/auth/session');
    const { resetPassword } = await import('@/lib/auth/password-reset');
    const result = await resetPassword('a'.repeat(64), 'NewPass123!');
    expect(result.success).toBe(true);
    expect(hashPassword).toHaveBeenCalledWith('NewPass123!');
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('returns error on DB failure', async () => {
    mockResolve.mockRejectedValue(new Error('DB error'));
    const { resetPassword } = await import('@/lib/auth/password-reset');
    const result = await resetPassword('a'.repeat(64), 'NewPass123!');
    expect(result.success).toBe(false);
  });
});
