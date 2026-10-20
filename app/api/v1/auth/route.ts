/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * This module routes two URLs:
 *   POST /api/v1/auth/login - User login
 *   GET  /api/v1/auth/me    - Get current user
 *
 * ⚠️ DEPRECATED: Use /api/auth/* endpoints instead
 * These v1 auth handlers are kept for backward compatibility only
 * and will be removed in a future version.
 *
 * #2884: the header used to promise `POST /api/v1/auth/logout` and
 * `POST /api/v1/auth/signup` as well. They were exported as `POST_LOGOUT` and
 * `POST_SIGNUP`, which Next.js never dispatches, so those two paths have been 404s
 * for their whole history — the removals took nothing away that was reachable.
 * `/api/auth/logout` and `/api/auth/signup` are the live ones.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/api/validate';
import { db } from '@/drizzle/db';
import { users, sessions } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { verifyPassword, createToken, hashToken, setSessionCookie, getCurrentUser } from '@/lib/auth/session';
import { verifyTOTP } from '@/lib/auth/totp';
import { limiters } from '@/lib/rate-limit';
import { handleError, ValidationError, AuthError, ErrorCode } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';
import { getClientIp } from '@/lib/client-ip';
import { createHash } from 'crypto';
import { withUserContext } from '@/lib/db/rls';

// Mirrors the private SESSION_EXPIRES_DAYS in lib/auth/session.ts (the default
// createToken() lifetime); the sessions row must expire with the JWT it hashes
// so #2215's revocation path works for v1-issued tokens too.
const V1_SESSION_EXPIRES_DAYS = 30;

/**
 * POST /api/v1/auth/login
 * ⚠️ DEPRECATED: Use /api/auth/login instead
 */
export async function POST(request: NextRequest) {
  // Log deprecation warning
  console.warn('DEPRECATED: /api/v1/auth/login called - use /api/auth/login instead');
  
  try {
    // Rate limiting for auth endpoints.
    // #2215: use the central TRUST_PROXY-gated client IP — the old code trusted
    // the raw first x-forwarded-for entry, which nginx APPENDS to (#2219), so
    // rotating XFF per attempt let an anonymous brute-forcer skip the limiter
    // entirely.
    const ip = getClientIp(request);
    const rateCheck = await limiters.auth.check(`auth:login:${ip}`);
    
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Try again later.', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.reset) } }
      );
    }

    const body = await readJsonBody(request);

    if (!body.email || !body.password) {
      throw new ValidationError('email and password are required');
    }

    // Find user by email
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      isSuperAdmin: users.isSuperAdmin,
      emailVerified: users.emailVerified,
      totpEnabled: users.totpEnabled,
      totpSecret: users.totpSecret,
      totpBackupCodes: users.totpBackupCodes,
    })
    .from(users)
    .where(and(
      eq(sql`lower(${users.email})`, body.email.toLowerCase()),
      sql`${users.deletedAt} IS NULL`
    ))
    .limit(1);

    if (!user) {
      devLogger.auth('Login', false, body.email);
      throw new AuthError('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    // Verify password
    const valid = await verifyPassword(body.password, user.passwordHash || '');
    if (!valid) {
      devLogger.auth('Login', false, body.email);
      throw new AuthError('Invalid credentials', ErrorCode.AUTH_INVALID_CREDENTIALS);
    }

    // Check email verification
    if (!user.emailVerified) {
      throw new AuthError('Please verify your email', ErrorCode.AUTH_EMAIL_NOT_VERIFIED);
    }

    // #2215: 2FA is now enforced here, matching the canonical login pipeline
    // (lib/auth/api-handlers.ts). Without it this deprecated route was a
    // 2FA-free back door: password-only even for users with TOTP enabled.
    if (user.totpEnabled) {
      const totpToken = body.totp_token;
      if (!totpToken) {
        return NextResponse.json({ requires_2fa: true, email: user.email });
      }
      let valid = verifyTOTP(user.totpSecret ?? '', String(totpToken));
      if (!valid && user.totpBackupCodes) {
        const incoming = createHash('sha256').update(String(totpToken).toUpperCase()).digest('hex');
        const codes: string[] = typeof user.totpBackupCodes === 'string' ? JSON.parse(user.totpBackupCodes) : (user.totpBackupCodes as string[]);
        if (codes.includes(incoming)) {
          valid = true;
          await withUserContext(user.id, async (tx) =>
            await tx.update(users)
              .set({ totpBackupCodes: codes.filter((x: string) => x !== incoming) })
              .where(eq(users.id, user.id))
          ).catch((e) => devLogger.warn('[v1 auth] Failed to update backup codes', e));
        }
      }
      if (!valid) {
        devLogger.auth('Login', false, body.email);
        return NextResponse.json({ error: 'Invalid 2FA code', requires_2fa: true }, { status: 401 });
      }
    }

    // Create JWT token
    const token = await createToken(user.id);

    // #2215: persist the session row (token hash + expiry), which the old v1
    // handler never did. A JWT with no public.sessions row is invisible to
    // session revocation — logout/admin-kill switches could never invalidate a
    // token minted here. Mirrors the canonical login's insert (scoped via
    // withUserContext because the sessions RLS policy is keyed on
    // app.current_user, which a pre-auth connection lacks).
    const tokenHash = await hashToken(token);
    await withUserContext(user.id, async (tx) => {
      await tx.insert(sessions).values({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + V1_SESSION_EXPIRES_DAYS * 24 * 60 * 60 * 1000),
        ipAddress: ip,
        userAgent: request.headers.get('user-agent')?.slice(0, 255),
      });
    });

    // Set session cookie
    await setSessionCookie(token);

    // Log successful login
    devLogger.auth('Login', true, body.email, user.id);

    return NextResponse.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          is_super_admin: user.isSuperAdmin,
        },
      },
    });
  } catch (error) {
    devLogger.error(error as Error, 'POST /api/v1/auth/login');
    return handleError(error);
  }
}

/**
 * GET /api/v1/auth/me
 */
export async function GET(_request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          is_super_admin: user.isSuperAdmin,
        },
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
