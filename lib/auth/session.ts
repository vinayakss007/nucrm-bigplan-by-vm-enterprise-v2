import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { db } from '@/drizzle/db';
import { users, sessions } from '@/drizzle/schema';
import { eq, and, gt } from 'drizzle-orm';

// ✅ FIXED: JWT_SECRET must be set - throw error if missing
const JWT_SECRET_ENV = process.env['JWT_SECRET'];
if (!JWT_SECRET_ENV) {
  throw new Error(
    'JWT_SECRET environment variable is required. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
}
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_ENV);
const SESSION_COOKIE = 'nucrm_session';
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
export async function createToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(`${SESSION_EXPIRES_DAYS}d`)
    .setIssuedAt()
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { userId: payload.sub as string };
  } catch (e) {
    console.error('[Session] Token verification failed:', e);
    return null;
  }
}

export async function hashToken(token: string): Promise<string> {
  const { createHash } = await import('crypto');
  return createHash('sha256').update(token).digest('hex');
}

// ── Session cookie helpers ────────────────────────────────────
export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env['COOKIE_SECURE'] === 'false' ? false : process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    maxAge: SESSION_EXPIRES_DAYS * 24 * 60 * 60,
    path: '/',
  });
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

// ── Get current user from session ────────────────────────────
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCurrentUser(): Promise<any | null> {
  const token = await getSessionToken();
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  const tokenHash = await hashToken(token);

  // Verify session still exists in DB
  const results = await db.select({
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
  .limit(1);

  return results[0] ?? null;
}
