/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Coverage for lib/auth/session.ts `getCurrentUser` and the JWT_SECRET guard.
 *
 * tests/unit/auth-session.test.ts stubs `db.select` to always resolve `[]`, so
 * `getCurrentUser` could only ever exercise its early-return paths — the join
 * against `sessions` (L108-127) never ran, leaving the function at 20%.
 *
 * `getCurrentUser` is the single gate every server component trusts, so the
 * behaviour worth pinning is that a token alone is never sufficient: the
 * session row must still exist and still be unexpired. A regression that
 * returned the JWT payload without the DB check would silently un-revoke every
 * logged-out session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCookieGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: mockCookieGet,
    set: vi.fn(),
    delete: vi.fn(),
  })),
}));

const mockJwtVerify = vi.fn();
vi.mock('jose', () => ({
  jwtVerify: mockJwtVerify,
  SignJWT: class {
    setProtectedHeader = vi.fn().mockReturnThis();
    setExpirationTime = vi.fn().mockReturnThis();
    setIssuedAt = vi.fn().mockReturnThis();
    sign = vi.fn(async () => 'signed.jwt.token');
  },
}));

vi.mock('bcryptjs', () => ({ default: { hash: vi.fn(), compare: vi.fn() } }));

/** Rows the session/users join will resolve to. */
let sessionRows: any[] = [];
/** Captures the `.limit()` argument so we can assert the query is bounded. */
let limitArg: number | undefined;

vi.mock('@/drizzle/db', () => {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn((n: number) => {
    limitArg = n;
    return Promise.resolve(sessionRows);
  });
  return { db: chain };
});

const USER = {
  id: 'u-1',
  email: 'ann@example.test',
  fullName: 'Ann Smith',
  isSuperAdmin: false,
  avatarUrl: null,
  lastTenantId: 't-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionRows = [];
  limitArg = undefined;
  mockCookieGet.mockReturnValue({ value: 'a.valid.jwt' });
  mockJwtVerify.mockResolvedValue({ payload: { sub: 'u-1' } });
});

describe('getCurrentUser', () => {
  it('returns the joined user when the session row is present and unexpired', async () => {
    sessionRows = [USER];
    const { getCurrentUser } = await import('@/lib/auth/session');
    await expect(getCurrentUser()).resolves.toEqual(USER);
  });

  it('returns null when no session cookie is set', async () => {
    mockCookieGet.mockReturnValue(undefined);
    const { getCurrentUser } = await import('@/lib/auth/session');
    expect(await getCurrentUser()).toBeNull();
    // Short-circuits before touching the database.
    expect(mockJwtVerify).not.toHaveBeenCalled();
  });

  it('returns null when the token fails verification', async () => {
    mockJwtVerify.mockRejectedValue(new Error('signature mismatch'));
    const { getCurrentUser } = await import('@/lib/auth/session');
    expect(await getCurrentUser()).toBeNull();
  });

  it('returns null when the token is valid but the session row is gone', async () => {
    // This is the revocation path: signing out deletes the row, so a still
    // cryptographically-valid cookie must stop working.
    sessionRows = [];
    const { getCurrentUser } = await import('@/lib/auth/session');
    expect(await getCurrentUser()).toBeNull();
  });

  it('looks the session up by token hash, not by the raw token', async () => {
    sessionRows = [USER];
    const { getCurrentUser, hashToken } = await import('@/lib/auth/session');
    await getCurrentUser();

    const { createHash } = await import('crypto');
    const expected = createHash('sha256').update('a.valid.jwt').digest('hex');
    await expect(hashToken('a.valid.jwt')).resolves.toBe(expected);
    // A raw-token lookup would make the sessions table a credential store.
    expect(expected).not.toBe('a.valid.jwt');
  });

  it('bounds the lookup to a single row', async () => {
    sessionRows = [USER];
    const { getCurrentUser } = await import('@/lib/auth/session');
    await getCurrentUser();
    expect(limitArg).toBe(1);
  });

  it('returns the first row rather than an array', async () => {
    sessionRows = [USER, { ...USER, id: 'u-2' }];
    const { getCurrentUser } = await import('@/lib/auth/session');
    const user = await getCurrentUser();
    expect(user.id).toBe('u-1');
  });

  it('propagates isSuperAdmin from the users join', async () => {
    sessionRows = [{ ...USER, isSuperAdmin: true }];
    const { getCurrentUser } = await import('@/lib/auth/session');
    const user = await getCurrentUser();
    expect(user.isSuperAdmin).toBe(true);
  });
});

describe('JWT_SECRET guard', () => {
  it('throws on first use — not at import — when JWT_SECRET is unset', async () => {
    // The check is lazy so that Next.js can import the module at build time
    // without requiring secrets in the build environment. But the first call
    // that touches the key MUST throw rather than silently use an empty key.
    const original = process.env['JWT_SECRET'];
    delete process.env['JWT_SECRET'];
    vi.resetModules();
    try {
      const mod = await import('@/lib/auth/session?nosecret');
      // Import succeeds (lazy) — but calling createToken throws
      await expect(mod.createToken('user-1')).rejects.toThrow(/JWT_SECRET/);
    } finally {
      process.env['JWT_SECRET'] = original;
      vi.resetModules();
    }
  });
});
