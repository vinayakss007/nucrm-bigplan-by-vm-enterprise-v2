/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users, sessions } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'crypto';
import { readJsonBody } from '@/lib/api/validate';
import { deleteUserSessions } from '@/lib/cache/sessions';
import { RateLimiter } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';

/**
 * Emergency Admin Recovery Endpoint
 *
 * USE CASE: All normal auth paths have failed:
 * - Forgot password email not arriving (SMTP down)
 * - 2FA device lost and backup codes exhausted
 * - Only super admin locked out, no other admins exist
 * - Database accessible but no UI access
 *
 * SECURITY:
 * - Requires EMERGENCY_RECOVERY_KEY env variable (set on server only)
 * - Rate limited to 1 attempt per 5 minutes per IP
 * - Logs every attempt to stderr (visible in server logs)
 * - Only resets password — does NOT bypass 2FA (user must disable via DB if needed)
 * - Only works for super_admin accounts
 *
 * SETUP:
 *   Add to .env (NEVER commit this):
 *     EMERGENCY_RECOVERY_KEY=your-very-long-random-secret-min-64-chars
 *
 * USAGE:
 *   curl -X POST http://localhost:3000/api/emergency/recover \
 *     -H "Content-Type: application/json" \
 *     -d '{"emergency_key":"...", "email":"admin@...", "new_password":"..."}'
 *
 * POST /api/emergency/recover
 * Body: {
 *   emergency_key: string,  // Must match EMERGENCY_RECOVERY_KEY env
 *   email: string,          // Super admin email to recover
 *   new_password: string,   // New password (min 12 chars)
 *   disable_2fa?: boolean,  // Also disable TOTP (default: false)
 * }
 */

// Distributed rate limit: 1 attempt per 5 minutes per IP, shared across all
// instances via the repo's Redis-backed limiter (lib/rate-limit RateLimiter).
// The previous implementation used a per-process in-memory Map, so the limit
// was enforced PER INSTANCE (bypassable behind a load balancer). RateLimiter
// counts through lib/cache (Redis when available, per-process fallback only if
// Redis is down) and fails OPEN if Redis errors mid-request — the shared
// helper's own behavior, which we intentionally do not reimplement here.
const MAX_ATTEMPTS = 1;
const WINDOW_SECONDS = 5 * 60; // 5 minutes
const emergencyLimiter = new RateLimiter({ max: MAX_ATTEMPTS, window: WINDOW_SECONDS });

async function checkEmergencyRateLimit(ip: string): Promise<boolean> {
  const result = await emergencyLimiter.check(`emergency-recover:${ip}`);
  return result.allowed;
}

export async function POST(request: NextRequest) {
  // #1249: header values only honored when TRUST_PROXY=true (see getClientIp)
  const ip = getClientIp(request);
  const timestamp = new Date().toISOString();

  // Always log attempts
  console.error(`[EMERGENCY RECOVERY] Attempt from IP: ${ip} at ${timestamp}`);

  // 1. Check if emergency recovery is configured
  const emergencyKey = process.env['EMERGENCY_RECOVERY_KEY'];
  if (!emergencyKey || emergencyKey.length < 32) {
    console.error(`[EMERGENCY RECOVERY] REJECTED — EMERGENCY_RECOVERY_KEY not configured or too short`);
    return NextResponse.json(
      { error: 'Emergency recovery is not configured on this server.' },
      { status: 503 }
    );
  }

  // 2. Rate limit (distributed, shared across instances)
  if (!(await checkEmergencyRateLimit(ip))) {
    console.error(`[EMERGENCY RECOVERY] RATE LIMITED — IP: ${ip}`);
    return NextResponse.json(
      { error: 'Too many attempts. Wait 5 minutes.' },
      { status: 429 }
    );
  }

  // 3. Parse and validate body
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await readJsonBody(request);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { emergency_key, email, new_password, disable_2fa = false } = body;

  if (!emergency_key || !email || !new_password) {
    return NextResponse.json(
      { error: 'Required: emergency_key, email, new_password' },
      { status: 400 }
    );
  }

  // 4. Verify emergency key (constant-time comparison)
  const keyBuffer = Buffer.from(emergency_key);
  const expectedBuffer = Buffer.from(emergencyKey);
  const keyValid = keyBuffer.length === expectedBuffer.length &&
    timingSafeEqual(keyBuffer, expectedBuffer);

  if (!keyValid) {
    console.error(`[EMERGENCY RECOVERY] INVALID KEY — IP: ${ip}, email: ${email}`);
    // #1253: identical generic response — never reveal which branch failed
    return NextResponse.json({
      message: 'If the account exists, recovery instructions were sent',
    });
  }

  // 5. Validate new password strength
  if (new_password.length < 12) {
    console.error(`[EMERGENCY RECOVERY] WEAK PASSWORD — IP: ${ip}`);
    return NextResponse.json({
      message: 'If the account exists, recovery instructions were sent',
    });
  }

  // 6. Find the user (must be super admin)
  const user = await db.query.users.findFirst({
    where: eq(sql`lower(${users.email})`, email.toLowerCase().trim()),
    columns: { id: true, email: true, isSuperAdmin: true, fullName: true },
  });

  if (!user) {
    console.error(`[EMERGENCY RECOVERY] USER NOT FOUND — email: ${email}`);
    // #1253: identical generic response — never reveal user existence
    return NextResponse.json({
      message: 'If the account exists, recovery instructions were sent',
    });
  }

  if (!user.isSuperAdmin) {
    console.error(`[EMERGENCY RECOVERY] NOT SUPER ADMIN — email: ${email}`);
    return NextResponse.json({
      message: 'If the account exists, recovery instructions were sent',
    });
  }

  // 7. Reset password
  const hashedPassword = await bcrypt.hash(new_password, 12);

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateFields: any = {
    passwordHash: hashedPassword,
    updatedAt: new Date(),
  };

  // Optionally disable 2FA
  if (disable_2fa) {
    updateFields.totpEnabled = false;
    updateFields.totpSecret = null;
    updateFields.totpBackupCodes = null;
  }

  await db.update(users)
    .set(updateFields)
    .where(eq(users.id, user.id));

  // CRITICAL: Invalidate all existing sessions so stolen cookies are immediately revoked
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await deleteUserSessions(user.id);

  console.error(`[EMERGENCY RECOVERY] SUCCESS — email: ${email}, 2FA disabled: ${disable_2fa}, IP: ${ip}`);

  return NextResponse.json({
    success: true,
    message: `Password reset for ${email}. ${disable_2fa ? '2FA has been disabled. ' : ''}You can now login with the new password.`,
    user: {
      email: user.email,
      name: user.fullName,
      twofa_disabled: disable_2fa,
    },
  });
}

/**
 * GET /api/emergency/recover
 * Returns status of emergency recovery configuration (no secrets exposed).
 */
export async function GET() {
  const isConfigured = !!(process.env['EMERGENCY_RECOVERY_KEY'] && process.env['EMERGENCY_RECOVERY_KEY'].length >= 32);

  return NextResponse.json({
    configured: isConfigured,
    description: 'Emergency recovery endpoint for super admin accounts when all other auth methods fail.',
    usage: isConfigured
      ? 'POST with { emergency_key, email, new_password, disable_2fa? }'
      : 'Set EMERGENCY_RECOVERY_KEY environment variable (min 32 chars) to enable.',
    security: [
      'Requires server-side EMERGENCY_RECOVERY_KEY env variable',
      'Rate limited to 1 attempt per 5 minutes per IP',
      'Only works for super_admin accounts',
      'Every attempt is logged to server stderr',
      'Password must be 12+ characters',
    ],
  });
}
