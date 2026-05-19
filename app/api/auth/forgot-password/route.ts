import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { users, passwordResets } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'crypto';
import { sendEmail } from '@/lib/email/service';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'forgot_password', max: 3, windowMinutes: 60 });
    if (limited) return limited;

    const { email } = await request.json();
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

    // Always return success — never reveal if email exists
    const user = await db.query.users.findFirst({
      where: eq(sql`lower(${users.email})`, email.toLowerCase().trim()),
      columns: { id: true, fullName: true }
    });
    
    if (!user) return NextResponse.json({ ok: true });

    // Create reset token
    const token = randomBytes(32).toString('hex');

    await db.insert(passwordResets).values({
      userId: user.id,
      token: token, // Store raw token (not hashed)
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

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[forgot-password]', err);
    return NextResponse.json({ ok: true }); // Don't reveal errors
  }
}
