import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users, emailVerifications } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import { sendEmail } from '@/lib/email/service';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action:'resend_verification', max:3, windowMinutes:60 });
    if (limited) return limited;
    
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const user = await db.query.users.findFirst({
      columns: { email: true, fullName: true, emailVerified: true },
      where: eq(users.id, ctx.userId)
    });

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.emailVerified) return NextResponse.json({ error: 'Email already verified' }, { status: 400 });

    const token = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(token).digest('hex');

    await db.insert(emailVerifications).values({
      userId: ctx.userId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const url = `${process.env.NEXT_PUBLIC_APP_URL}/auth/verify-email?token=${token}`;
    
    await sendEmail({
      to: user.email,
      subject: 'Verify your NuCRM email address',
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto"><div style="height:4px;background:linear-gradient(90deg,#7c3aed,#4f46e5);border-radius:4px 4px 0 0"></div><div style="padding:40px 32px;background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px"><h2 style="margin:0 0 8px;color:#111827">Verify your email</h2><p style="color:#6b7280;margin:0 0 24px">Hi ${user.fullName ?? 'there'}, click below to verify your NuCRM account.</p><a href="${url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Verify Email →</a><p style="color:#9ca3af;font-size:12px;margin-top:24px">Link expires in 24 hours.</p></div></div>`,
      text: `Verify your NuCRM email: ${url}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) { 
    return NextResponse.json({ error: err.message }, { status: 500 }); 
  }
}
