import { checkRateLimit } from '@/lib/rate-limit';
import { NextRequest, NextResponse } from 'next/server';
import { validateBody } from '@/lib/api/validate';
import { testEmailSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { sendEmail } from '@/lib/email/service';

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action:'email_test', max:5, windowMinutes:60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rawBody = await request.json();
    const validated = validateBody(testEmailSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { to, provider, config } = validated.data;
    if (!to) return NextResponse.json({ error: 'Recipient email required' }, { status: 400 });

    // Override env vars with provided config for this test
    const result = await sendEmail({
      to,
      subject: 'NuCRM Email Test ✅',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 20px">
          <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);height:4px;border-radius:4px;margin-bottom:32px"></div>
          <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Email delivery is working! 🎉</h2>
          <p style="color:#6b7280;margin:0 0 24px">Your NuCRM email configuration is set up correctly.</p>
          <div style="background:#f9fafb;border-radius:8px;padding:16px;font-size:13px;color:#374151">
            <strong>Provider:</strong> ${provider}<br>
            <strong>Sent at:</strong> ${new Date().toLocaleString()}
          </div>
          <p style="color:#9ca3af;font-size:12px;margin-top:24px">This is a test email from NuCRM.</p>
        </div>`,
      text: `NuCRM email test — Your email configuration is working! Sent at ${new Date().toLocaleString()}`,
    });

    if (result.success) {
      return NextResponse.json({ ok: true, provider: result.provider, messageId: result.messageId });
    } else {
      return NextResponse.json({ ok: false, error: result.error || 'Failed to send' }, { status: 500 });
    }
  } catch (err: any) {
    console.error('[email/test]', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
