/**
 * POST /api/v1/auth/login - User login
 * POST /api/v1/auth/logout - User logout  
 * POST /api/v1/auth/signup - User signup
 * GET /api/v1/auth/me - Get current user
 *
 * ⚠️ DEPRECATED: Use /api/auth/* endpoints instead
 * These v1 auth handlers are kept for backward compatibility only
 * and will be removed in a future version.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { hashPassword, verifyPassword, createToken, setSessionCookie, clearSessionCookie, validatePassword, getCurrentUser } from '@/lib/auth/session';
import { limiters } from '@/lib/rate-limit';
import { handleError, ValidationError, AuthError, ConflictError, ErrorCode } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';

/**
 * POST /api/v1/auth/login
 * ⚠️ DEPRECATED: Use /api/auth/login instead
 */
export async function POST(request: NextRequest) {
  // Log deprecation warning
  console.warn('DEPRECATED: /api/v1/auth/login called - use /api/auth/login instead');
  
  try {
    // Rate limiting for auth endpoints
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    const rateCheck = await limiters.auth.check(`auth:login:${ip}`);
    
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Try again later.', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.reset) } }
      );
    }

    const body = await request.json();

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

    // Create JWT token
    const token = await createToken(user.id);

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
 * POST /api/v1/auth/logout
 * ⚠️ DEPRECATED: Use /api/auth/logout instead
 */
export async function POST_LOGOUT(request: NextRequest) {
  console.warn('DEPRECATED: /api/v1/auth/logout called - use /api/auth/logout instead');
  try {
    await clearSessionCookie();
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/v1/auth/signup
 * ⚠️ DEPRECATED: Use /api/auth/signup instead - this v1 version does NOT create tenant/workspace
 */
export async function POST_SIGNUP(request: NextRequest) {
  console.warn('DEPRECATED: /api/v1/auth/signup called - use /api/auth/signup instead');
  try {
    const body = await request.json();

    // Validate
    if (!body.email || !body.password) {
      throw new ValidationError('email and password are required');
    }

    const passwordError = validatePassword(body.password);
    if (passwordError) {
      throw new ValidationError(passwordError);
    }

    // Check if user exists
    const [existing] = await db.select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, body.email.toLowerCase()))
      .limit(1);

    if (existing) {
      throw new ConflictError('User with this email already exists');
    }

    // Hash password
    const password_hash = await hashPassword(body.password);

    // Create user
    const [user] = await db.insert(users)
      .values({
        email: body.email.toLowerCase(),
        passwordHash: password_hash,
        emailVerified: true,
      })
      .returning({
        id: users.id,
        email: users.email,
        isSuperAdmin: users.isSuperAdmin,
      });

    if (!user) {
      throw new Error('Failed to create user');
    }

    // Create token and set cookie
    const token = await createToken(user.id);
    await setSessionCookie(token);

    devLogger.auth('Signup', true, body.email, user.id);

    return NextResponse.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          is_super_admin: user.isSuperAdmin,
        }
      }
    }, { status: 201 });
  } catch (error) {
    devLogger.error(error as Error, 'POST /api/v1/auth/signup');
    return handleError(error);
  }
}

/**
 * GET /api/v1/auth/me
 */
export async function GET(request: NextRequest) {
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
