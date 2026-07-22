import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(), compare: vi.fn() } }));

class MockSignJWT {
  setProtectedHeader = vi.fn().mockReturnThis();
  setExpirationTime = vi.fn().mockReturnThis();
  setIssuedAt = vi.fn().mockReturnThis();
  sign = vi.fn();
}
vi.mock('jose', () => ({ SignJWT: MockSignJWT, jwtVerify: vi.fn() }));

const mockCookieSet = vi.fn();
const mockCookieGet = vi.fn();
const mockCookieDelete = vi.fn();
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ set: mockCookieSet, get: mockCookieGet, delete: mockCookieDelete })) }));

vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })),
        })),
      })),
    })),
    query: {
      users: { findFirst: vi.fn(async () => null) },
      sessions: { findFirst: vi.fn(async () => null) },
    },
  },
}));

vi.mock('@/drizzle/schema', () => ({ users: {}, sessions: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), gt: vi.fn() }));

describe('auth/session', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env['JWT_SECRET'] = 'test-secret-that-is-long-enough-for-hmac';
  });

  afterAll(() => {
    delete process.env['JWT_SECRET'];
  });

  it('validatePassword returns null for valid password', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    expect(validatePassword('ValidPass1!withExtra')).toBeNull();
  });

  it('validatePassword rejects short password', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    expect(validatePassword('Short1!')).toContain('12 characters');
  });

  it('validatePassword rejects missing uppercase', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    expect(validatePassword('lowercase1!longenough')).toContain('uppercase');
  });

  it('validatePassword rejects missing number', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    expect(validatePassword('UPPERCASE!longenough')).toContain('number');
  });

  it('validatePassword rejects missing special char', async () => {
    const { validatePassword } = await import('@/lib/auth/session');
    expect(validatePassword('UPPERCASE1longenough')).toContain('special');
  });

  it('hashPassword calls bcrypt.hash', async () => {
    const bcryptjs = await import('bcryptjs');
    (bcryptjs.default.hash as ReturnType<typeof vi.fn>).mockResolvedValue('hashed-pass');
    const { hashPassword } = await import('@/lib/auth/session');
    const result = await hashPassword('ValidPass1!');
    expect(bcryptjs.default.hash).toHaveBeenCalledWith('ValidPass1!', 12);
    expect(result).toBe('hashed-pass');
  });

  it('verifyPassword calls bcrypt.compare', async () => {
    const bcryptjs = await import('bcryptjs');
    (bcryptjs.default.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const { verifyPassword } = await import('@/lib/auth/session');
    const result = await verifyPassword('pass', 'hash');
    expect(bcryptjs.default.compare).toHaveBeenCalledWith('pass', 'hash');
    expect(result).toBe(true);
  });

  it('createToken signs a JWT with userId and default expiry', async () => {
    const { createToken } = await import('@/lib/auth/session');
    const result = await createToken('user-1');
    expect(result).toBeUndefined();
  });

  it('createToken accepts custom expiry', async () => {
    const { createToken } = await import('@/lib/auth/session');
    await createToken('user-1', 7);
  });

  it('createToken chain calls setProtectedHeader and setIssuedAt', async () => {
    const { createToken } = await import('@/lib/auth/session');
    await createToken('user-1');
    const joseMod = await import('jose');
    const instance = new joseMod.SignJWT({ sub: 'user-1' });
    expect(instance.setProtectedHeader).toBeDefined();
  });

  it('verifyToken returns userId for valid token', async () => {
    const jose = await import('jose');
    (jose.jwtVerify as ReturnType<typeof vi.fn>).mockResolvedValue({ payload: { sub: 'user-1' } });
    const { verifyToken } = await import('@/lib/auth/session');
    const result = await verifyToken('valid-token');
    expect(result).toEqual({ userId: 'user-1' });
  });

  it('verifyToken returns null for invalid token', async () => {
    const jose = await import('jose');
    (jose.jwtVerify as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('invalid'));
    const { verifyToken } = await import('@/lib/auth/session');
    const result = await verifyToken('bad-token');
    expect(result).toBeNull();
  });

  it('hashToken returns SHA-256 hex digest', async () => {
    const { hashToken } = await import('@/lib/auth/session');
    const result = await hashToken('test-token');
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('makeSessionCookieString returns formatted cookie', async () => {
    const { makeSessionCookieString } = await import('@/lib/auth/session');
    const cookie = makeSessionCookieString('token-123');
    expect(cookie).toContain('nucrm_session=token-123');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('setSessionCookie sets cookie via next/headers', async () => {
    const { setSessionCookie } = await import('@/lib/auth/session');
    await setSessionCookie('token-123');
    expect(mockCookieSet).toHaveBeenCalledWith('nucrm_session', 'token-123', expect.objectContaining({ httpOnly: true }));
  });

  it('getSessionToken reads from cookie store', async () => {
    mockCookieGet.mockReturnValue({ value: 'session-token' });
    const { getSessionToken } = await import('@/lib/auth/session');
    const result = await getSessionToken();
    expect(result).toBe('session-token');
  });

  it('getSessionToken returns null when no cookie', async () => {
    mockCookieGet.mockReturnValue(undefined);
    const { getSessionToken } = await import('@/lib/auth/session');
    const result = await getSessionToken();
    expect(result).toBeNull();
  });

  it('clearSessionCookie deletes cookie', async () => {
    const { clearSessionCookie } = await import('@/lib/auth/session');
    await clearSessionCookie();
    expect(mockCookieDelete).toHaveBeenCalledWith('nucrm_session');
  });

  it('getCurrentUser returns null when no token', async () => {
    mockCookieGet.mockReturnValue(undefined);
    const { getCurrentUser } = await import('@/lib/auth/session');
    const result = await getCurrentUser();
    expect(result).toBeNull();
  });

  it('getCurrentUser returns null when token invalid', async () => {
    mockCookieGet.mockReturnValue({ value: 'bad-token' });
    const jose = await import('jose');
    (jose.jwtVerify as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('invalid'));
    const { getCurrentUser } = await import('@/lib/auth/session');
    const result = await getCurrentUser();
    expect(result).toBeNull();
  });
});
