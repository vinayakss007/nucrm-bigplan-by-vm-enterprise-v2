 
import { describe, it, expect, afterEach } from 'vitest';

// Set JWT_SECRET before importing the module under test
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-only-32chars!';

const mod = await import('@/lib/auth/session');

const {
  makeSessionCookieString,
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  hashToken,
  validatePassword,
} = mod;

// ─── validatePassword ──────────────────────────────────────────
describe('validatePassword', () => {
  it('returns null for a valid password', () => {
    expect(validatePassword('Str0ng!Pass#123')).toBeNull();
  });

  it('rejects password shorter than 12 characters', () => {
    expect(validatePassword('Ab1!')).toBe(
      'Password must be at least 12 characters'
    );
  });

  it('rejects password with no uppercase', () => {
    expect(validatePassword('lowercase123!')).toBe(
      'Password must contain at least one uppercase letter'
    );
  });

  it('rejects password with no digit', () => {
    expect(validatePassword('NoDigitsHere!X')).toBe(
      'Password must contain at least one number'
    );
  });

  it('rejects password with no special character', () => {
    expect(validatePassword('NoSpecialChar123X')).toBe(
      'Password must contain at least one special character'
    );
  });

  it('returns null for password with all required elements at exactly 12 chars', () => {
    expect(validatePassword('Abcdef1!xxxx')).toBeNull();
  });

  it('accepts all special characters', () => {
    const specials = '!@#$%^&*(),.?":{}|<>';
    for (const ch of specials) {
      const pw = `Test${ch}1234567`;
      expect(validatePassword(pw)).toBeNull();
    }
  });
});

// ─── hashPassword / verifyPassword ─────────────────────────────
describe('hashPassword + verifyPassword', () => {
  it('hashes and verifies a password', async () => {
    const pw = 'TestPassword123!';
    const hash = await hashPassword(pw);
    expect(typeof hash).toBe('string');
    expect(hash).not.toBe(pw);
    expect(await verifyPassword(pw, hash)).toBe(true);
  });

  it('rejects wrong password', async () => {
    const hash = await hashPassword('Correct123!pass');
    expect(await verifyPassword('Wrong123!pass!!', hash)).toBe(false);
  });

  it('produces different hashes (salt)', async () => {
    const pw = 'SamePassword123!';
    const h1 = await hashPassword(pw);
    const h2 = await hashPassword(pw);
    expect(h1).not.toBe(h2);
    expect(await verifyPassword(pw, h1)).toBe(true);
    expect(await verifyPassword(pw, h2)).toBe(true);
  });
});

// ─── createToken / verifyToken ─────────────────────────────────
describe('createToken + verifyToken', () => {
  it('creates and verifies a token', async () => {
    const token = await createToken('user-123');
    const result = await verifyToken(token);
    expect(result).toEqual({ userId: 'user-123' });
  });

  it('creates a token with custom expiry', async () => {
    const token = await createToken('user-456', 1);
    const result = await verifyToken(token);
    expect(result?.userId).toBe('user-456');
  });

  it('returns null for invalid token', async () => {
    const result = await verifyToken('not.a.valid.token');
    expect(result).toBeNull();
  });

  it('returns null for empty string', async () => {
    const result = await verifyToken('');
    expect(result).toBeNull();
  });

  it('returns null for token signed with different secret', async () => {
    const { SignJWT } = await import('jose');
    const otherSecret = new TextEncoder().encode('wrong-secret-key-32-chars-long!!!');
    const badToken = await new SignJWT({ sub: 'user-789' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .setIssuedAt()
      .sign(otherSecret);
    const result = await verifyToken(badToken);
    expect(result).toBeNull();
  });
});

// ─── hashToken ─────────────────────────────────────────────────
describe('hashToken', () => {
  it('returns a sha256 hex string', async () => {
    const hash = await hashToken('hello');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic', async () => {
    const h1 = await hashToken('test-input');
    const h2 = await hashToken('test-input');
    expect(h1).toBe(h2);
  });

  it('different inputs produce different hashes', async () => {
    const h1 = await hashToken('input-a');
    const h2 = await hashToken('input-b');
    expect(h1).not.toBe(h2);
  });
});

// ─── makeSessionCookieString ───────────────────────────────────
describe('makeSessionCookieString', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.COOKIE_SECURE;
  });

  it('builds cookie string with default expiry (30 days)', () => {
    const result = makeSessionCookieString('tok_abc');
    expect(result).toContain('nucrm_session=tok_abc');
    expect(result).toContain('Path=/');
    expect(result).toContain('HttpOnly');
    expect(result).toContain('SameSite=Strict');
    expect(result).toContain('Max-Age=2592000'); // 30 * 86400
  });

  it('builds cookie string with custom expiry', () => {
    const result = makeSessionCookieString('tok_xyz', 7);
    expect(result).toContain('Max-Age=604800'); // 7 * 86400
  });

  it('includes Secure flag in production', () => {
    delete process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const result = makeSessionCookieString('tok_sec');
    expect(result).toContain('; Secure');
  });

  it('excludes Secure flag in development', () => {
    delete process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const result = makeSessionCookieString('tok_dev');
    expect(result).not.toContain('; Secure');
  });

  it('excludes Secure when COOKIE_SECURE=false', () => {
    delete process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECURE = 'false';
    const result = makeSessionCookieString('tok_nosec');
    expect(result).not.toContain('; Secure');
  });
});
