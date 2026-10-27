/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, readJsonBody, InvalidJsonBodyError } from '@/lib/api/validate';
import { users, passwordResets } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import { sendEmail } from '@/lib/email/service';
import { checkRateLimit, limiters, getRateLimitHeaders } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { logError } from '@/lib/errors-server';
import { withAuthLookupContext, withTokenIssueContext } from '@/lib/db/rls';

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
    //
    // #3288: this read is the reason the route was silently dead. `users` carries
    // no SELECT policy an unprivileged connection can satisfy — users_read_self
    // needs app.current_user, users_super_admin_read needs app.is_super_admin, and
    // neither exists before anyone has logged in — so on the bare pool
    // (`lib/db/pool.ts` clears every app.* GUC on acquire and release) the
    // statement matched zero rows for *every* address, including a real one. The
    // `if (!user)` branch below is the correct answer for an unknown address, and
    // was the only answer the route ever gave: same 200 {"ok":true}, no token, no
    // email, nothing logged.
    //
    // users_auth_lookup (0088) is the shipped arm for exactly this lookup, and
    // withAuthLookupContext is what the sibling lib/auth/password-reset.ts:68 —
    // which performs the identical read — had already been moved behind (#3218,
    // PP-026). The transaction-locals cannot leak: the privilege ends at COMMIT.
    const [user] = await withAuthLookupContext(async (tx) =>
      await tx
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(eq(sql`lower(${users.email})`, email.toLowerCase().trim()))
        .limit(1)
    );

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

        // #3102: this is the pre-auth path — nobody has a session yet, so
        // `app.current_user` is empty and `password_resets_user_own` (0088, FOR
        // ALL, keyed on it) refuses the INSERT outright with 42501. 0134 added
        // `password_resets_token_issue` for exactly this write: INSERT only,
        // behind app.token_issue, WITH CHECK-ing a non-null user_id and a future
        // expires_at. The helper opens its own transaction so the SET LOCAL
        // privilege cannot outlive this one statement.
        await withTokenIssueContext(async (tx) => {
          await tx.insert(passwordResets).values({
            userId: user.id,
            token: tokenHash,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
          });
        });

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
        const resetUrl = `${appUrl}/auth/reset-password?token=${token}`;

        // #3045: sendEmail resolves {success:false} on provider rejection —
        // log it, or the user waits forever for a reset link nobody sent.
        const emailResult = await sendEmail({
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
        if (!emailResult.success) {
          void logError({ error: new Error(`Password reset email rejected: ${emailResult.error ?? 'provider failure'}`), context: 'auth/forgot-password email send', requestUrl: request.url, requestMethod: request.method });
        }
      } catch (bgErr) {
        void logError({ error: bgErr, context: 'auth/forgot-password background token/email', requestUrl: request.url, requestMethod: request.method });
      }
    })();

    await normalizeTiming(startedAt);
    return NextResponse.json({ ok: true });
 
 
  } catch (err) {
    // A malformed JSON body is a client error, not a server fault: answer 400
    // without logging it to Sentry. This never reveals whether the email
    // exists (the body wasn't even parsed to an email), so it's enumeration-safe.
    if (err instanceof InvalidJsonBodyError) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    void logError({ error: err, context: 'auth/forgot-password POST', requestUrl: request.url, requestMethod: request.method });
    await normalizeTiming(startedAt);
    return NextResponse.json({ ok: true }); // Don't reveal errors
  }
}
