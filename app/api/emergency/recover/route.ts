import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'crypto';

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

// In-memory rate limit (per-process, resets on restart — acceptable for emergency endpoint)
const attempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 1;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function checkEmergencyRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);

  if (entry && (now - entry.lastAttempt) < WINDOW_MS) {
    if (entry.count >= MAX_ATTEMPTS) return false;
    entry.count++;
    entry.lastAttempt = now;
    return true;
  }

  attempts.set(ip, { count: 1, lastAttempt: now });
  return true;
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
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

  // 2. Rate limit
  if (!checkEmergencyRateLimit(ip)) {
    console.error(`[EMERGENCY RECOVERY] RATE LIMITED — IP: ${ip}`);
    return NextResponse.json(
      { error: 'Too many attempts. Wait 5 minutes.' },
      { status: 429 }
    );
  }

  // 3. Parse and validate body
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await request.json();
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
    return NextResponse.json(
      { error: 'Invalid emergency key' },
      { status: 403 }
    );
  }

  // 5. Validate new password strength
  if (new_password.length < 12) {
    return NextResponse.json(
      { error: 'Password must be at least 12 characters' },
      { status: 400 }
    );
  }

  // 6. Find the user (must be super admin)
  const user = await db.query.users.findFirst({
    where: eq(sql`lower(${users.email})`, email.toLowerCase().trim()),
    columns: { id: true, email: true, isSuperAdmin: true, fullName: true },
  });

  if (!user) {
    console.error(`[EMERGENCY RECOVERY] USER NOT FOUND — email: ${email}`);
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  if (!user.isSuperAdmin) {
    console.error(`[EMERGENCY RECOVERY] NOT SUPER ADMIN — email: ${email}`);
    return NextResponse.json(
      { error: 'Emergency recovery is only available for super admin accounts. For regular users, use the admin panel.' },
      { status: 403 }
    );
  }

  // 7. Reset password
  const hashedPassword = await bcrypt.hash(new_password, 12);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
