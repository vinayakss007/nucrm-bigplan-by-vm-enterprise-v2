/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { users, sessions } from '@/drizzle/schema';
import { eq, and, gt } from 'drizzle-orm';
import { withAuthResolutionContext } from '@/lib/db/rls';
import { resolveCookieSecure, resolveCookieSecureFromHeaders } from '@/lib/auth/cookie-security';

// Lazy-initialise so that importing this module at build time (Next.js static
// analysis) does not throw. The check is deferred to the first call that
// actually needs the key — at runtime there is always exactly one call to
// getJwtSecret() before any cryptographic operation.
let _jwtSecret: Uint8Array | null = null;

function getJwtSecret(): Uint8Array {
  if (!_jwtSecret) {
    const raw = process.env['JWT_SECRET'];
    if (!raw) {
      throw new Error(
        'JWT_SECRET environment variable is required. ' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
    _jwtSecret = new TextEncoder().encode(raw);
  }
  return _jwtSecret;
}
const SESSION_COOKIE = 'nucrm_session';
const IMPERSONATION_COOKIE = 'nucrm_impersonation';
const SESSION_EXPIRES_DAYS = 30;

// ── Password validation ──────────────────────────────────────
export function validatePassword(password: string): string | null {
  if (!password || password.length < 12)
    return 'Password must be at least 12 characters';
  if (!/[A-Z]/.test(password))
    return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(password))
    return 'Password must contain at least one number';
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password))
    return 'Password must contain at least one special character';
  return null;
}

// ── Password hashing ──────────────────────────────────────────
const BCRYPT_ROUNDS = parseInt(process.env['BCRYPT_ROUNDS'] || '12', 10);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── JWT tokens ────────────────────────────────────────────────
export async function createToken(userId: string, expiresInDays?: number): Promise<string> {
  const expiry = expiresInDays ?? SESSION_EXPIRES_DAYS;
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${expiry}d`)
    .setIssuedAt()
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    // A signed token with a valid signature+expiry but no `sub` claim must NOT
    // be treated as a valid identity. Without this guard verifyToken could
    // return { userId: undefined }, which downstream callers (middleware,
    // requireTenantCtx, setTenantContext, cache keys) treat as a real user id
    // and can poison identity/tenant scoping. Fail closed instead.
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return null;
    }
    return { userId: payload.sub };
  } catch (e) {
    console.error('[Session] Token verification failed', e);
    return null;
  }
}

export async function hashToken(token: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(token).digest('hex');
}

// ── Session cookie helpers ────────────────────────────────────
export async function setSessionCookie(token: string, maxAgeDays?: number) {
  const cookieStore = await cookies();
  const maxAge = (maxAgeDays ?? SESSION_EXPIRES_DAYS) * 24 * 60 * 60;
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // #2275: single resolution — COOKIE_SECURE always wins; production is
    // fail-closed Secure; elsewhere Secure when the request is https.
    secure: await resolveCookieSecureFromHeaders(),
    sameSite: 'strict',
    maxAge,
    path: '/',
  });
}

export function makeSessionCookieString(token: string, maxAgeDays?: number, requestHttps = false): string {
  const maxAge = (maxAgeDays ?? SESSION_EXPIRES_DAYS) * 24 * 60 * 60;
  const secure = resolveCookieSecure(requestHttps);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

// ── Impersonation cookie ─────────────────────────────────────
export const IMPERSONATION_COOKIE_NAME = IMPERSONATION_COOKIE;

/**
 * Park the super admin's own credential while `nucrm_session` carries the
 * impersonated tenant user's token. Without this, starting an impersonation
 * would log the admin out of the console with no way back: the stop endpoint
 * needs a super admin, and the only session the browser still presents is the
 * target user's.
 *
 * The value is a separate short-lived token, never a copy of the admin's
 * login cookie, so it can be revoked with the impersonation record that
 * created it, and it only ever reaches the browser that started the
 * impersonation.
 */
export async function setImpersonationTokenCookie(token: string, maxAgeDays = 1) {
  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE, token, {
    httpOnly: true,
    // #2275: same central Secure resolution as the session cookie.
    secure: await resolveCookieSecureFromHeaders(),
    sameSite: 'strict',
    maxAge: maxAgeDays * 24 * 60 * 60,
    path: '/',
  });
}

export async function clearImpersonationTokenCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_COOKIE);
}

// ── Get current user from session ────────────────────────────
 
export interface CurrentUser {
  id: string;
  email: string;
  fullName: string | null;
  isSuperAdmin: boolean | null;
  avatarUrl: string | null;
  lastTenantId: string | null;
}

/**
 * Resolve the account a token belongs to.
 *
 * `getCurrentUser()` is the normal path (the request's own session cookie).
 * Impersonation stop needs the same check for a *different* cookie — the
 * admin's parked credential — so the lookup is shared rather than duplicated.
 *
 * It runs in the pre-auth resolution context: this resolves an identity *from*
 * a token, so no tenant GUC can be trusted to be set yet — the only user that
 * may be named is the one the verified token already carries, which is why the
 * read stays scoped to that principal's own rows.
 */
export async function getCurrentUserForToken(token: string): Promise<CurrentUser | null> {
  const payload = await verifyToken(token);
  if (!payload) return null;

  const tokenHash = await hashToken(token);

  // Verify the session row still exists — PP-026: this is a *pre-auth* read,
  // performing it is what proves who the caller is, so it cannot run on the
  // plain pool, where every policy on `sessions`/`users` keys off an identity
  // that does not exist yet.
  const results = await withAuthResolutionContext<CurrentUser[]>(payload.userId, async (tx) =>
    await tx.select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      isSuperAdmin: users.isSuperAdmin,
      avatarUrl: users.avatarUrl,
      lastTenantId: users.lastTenantId,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(
      eq(sessions.tokenHash, tokenHash),
      gt(sessions.expiresAt, new Date())
    ))
    .limit(1)
  );

  return results[0] ?? null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = await getSessionToken();
  if (!token) return null;

  return getCurrentUserForToken(token);
}
