import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/service';

/**
 * Test Email Endpoint
 * 
 * Use this to test if email is working
 * 
 * Usage:
 * curl -X POST http://localhost:3000/api/test-email \
 *   -H "Content-Type: application/json" \
 *   -d '{"to":"your-email@example.com"}'
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const to = body.to;
    
    if (!to) {
      return NextResponse.json({ error: 'Email address required' }, { status: 400 });
    }
    
    console.log('[TestEmail] Sending test email to:', to);
    
    const result = await sendEmail({
      to,
      subject: '🧪 NuCRM Email Test',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <div style="height:4px;background:linear-gradient(90deg,#7c3aed,#4f46e5);border-radius:4px 4px 0 0"></div>
          <div style="padding:40px 32px;background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
            <h2 style="margin:0 0 8px;color:#111827">🧪 Email Test Successful!</h2>
            <p style="color:#6b7280;margin:0 0 24px">
              Your NuCRM email system is working correctly. This is a test email.
            </p>
            <div style="background:#f3f4f6;padding:16px;border-radius:8px;margin-bottom:24px">
              <p style="margin:0;font-size:14px;color:#6b7280">
                <strong>Sent at:</strong> ${new Date().toLocaleString()}<br/>
                <strong>To:</strong> ${to}<br/>
                <strong>Provider:</strong> Brevo SMTP
              </p>
            </div>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">
              If you received this, your email system is configured correctly!
            </p>
          </div>
        </div>
      `,
      text: `🧪 Email Test Successful!\n\nYour NuCRM email system is working correctly.\nSent at: ${new Date().toLocaleString()}\nTo: ${to}`,
    });
    
    if (result.success) {
      return NextResponse.json({ 
        ok: true, 
        message: 'Test email sent successfully!',
        provider: result.provider,
      });
    } else {
      return NextResponse.json({ 
        error: result.error || 'Failed to send',
        details: 'Check console for Brevo error details',
      }, { status: 500 });
    }
    
  } catch (err: any) {
    console.error('[TestEmail] Error:', err.message);
    return NextResponse.json({ 
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Email test endpoint',
    usage: 'POST with { "to": "your@email.com" }',
    configured: !!(process.env.BREVO_SMTP_HOST && process.env.BREVO_SMTP_USER),
  });
}
