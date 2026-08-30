/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { db } from '@/drizzle/db';
import { users, passwordResets } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import { sendEmail } from '@/lib/email/service';
import { checkRateLimit, limiters, getRateLimitHeaders } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { logError } from '@/lib/errors-server';

const schema = z.object({ email: z.string().email() });

// #1166 (CWE-208): mask the timing difference between existing and non-existent
// emails. Existing users trigger token creation + a DB insert + an email send
// (a slow network call); non-existent users return immediately. We (a) run the
// existing-user work OFF the response path (fire-and-forget) and (b) hold every
// response to a consistent minimum time so response latency no longer leaks
// whether the account exists.
const MIN_RESPONSE_MS = 250;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function normalizeTiming(startedAt: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_RESPONSE_MS) await sleep(MIN_RESPONSE_MS - elapsed);
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const limited = await checkRateLimit(request, { action: 'forgot_password', max: 3, windowMinutes: 60 });
    if (limited) return limited;

    const body = await readJsonBody(request);
    const validated = validateBody(schema, body);
    if (validated instanceof NextResponse) return validated;
    const { email } = validated.data;

    // #1245: hard per-(email+ip) limit (3/hour) independent of DB-configured limits
    const pwReset = await limiters.passwordReset.check(
      `pwreset:${getClientIp(request)}:${email.toLowerCase().trim()}`
    );
    if (!pwReset.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Try again later.' },
        { status: 429, headers: getRateLimitHeaders(pwReset) }
      );
    }

    // Always return success — never reveal if email exists
    const user = await db.query.users.findFirst({
      where: eq(sql`lower(${users.email})`, email.toLowerCase().trim()),
      columns: { id: true, fullName: true }
    });
    
    if (!user) {
      await normalizeTiming(startedAt);
      return NextResponse.json({ ok: true });
    }

    // #1166: run the token-persist + email-send OFF the response timing path so
    // an existing account doesn't take measurably longer than a non-existent one.
    // Fire-and-forget with a .catch so a rejection can't crash the process.
    void (async () => {
      try {
        // Create reset token — hash before storing so DB never holds raw tokens
        const token = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(token).digest('hex');

        await db.insert(passwordResets).values({
          userId: user.id,
          token: tokenHash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        });

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
        const resetUrl = `${appUrl}/auth/reset-password?token=${token}`;

        await sendEmail({
          to: email,
          subject: 'Reset your NuCRM password',
          html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <div style="height:4px;background:linear-gradient(90deg,#7c3aed,#4f46e5);border-radius:4px 4px 0 0"></div>
          <div style="padding:40px 32px;background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
            <h2 style="margin:0 0 8px;color:#111827">Reset your password</h2>
            <p style="color:#6b7280;margin:0 0 24px">Hi ${user.fullName ?? 'there'}, click the button below to reset your password. This link expires in 1 hour.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Reset Password →</a>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">If you didn't request this, ignore this email. Your password won't change.</p>
          </div>
        </div>`,
          text: `Reset your NuCRM password: ${resetUrl} (expires in 1 hour)`,
        });
      } catch (bgErr) {
        void logError({ error: bgErr, context: 'auth/forgot-password background token/email', requestUrl: request.url, requestMethod: request.method });
      }
    })();

    await normalizeTiming(startedAt);
    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'auth/forgot-password POST', requestUrl: request.url, requestMethod: request.method });
    await normalizeTiming(startedAt);
    return NextResponse.json({ ok: true }); // Don't reveal errors
  }
}
