/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { apiError } from '@/lib/api-error';
/**
 * 2FA Setup — generates a TOTP secret and QR code URI.
 * User scans QR in Google Authenticator, then calls /verify to confirm.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { verifyTOTP, generateTOTPSecret } from '@/lib/auth/totp';
import { checkRateLimit } from '@/lib/rate-limit';

function generateOTPAuthURL(secret: string, email: string, issuer = 'NuCRM'): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(email)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const rateLimited = await checkRateLimit(req, { action: '2fa-setup', max: 3, windowMinutes: 15 });
    if (rateLimited) return rateLimited;
    
    const user = await db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: { email: true, totpEnabled: true }
    });

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    if (user.totpEnabled) return NextResponse.json({ error: '2FA is already enabled' }, { status: 400 });
    
    const secret = generateTOTPSecret();
    
    // Store temp secret (not yet enabled — needs verify step)
    await db.update(users)
      .set({ totpSecret: secret })
      .where(eq(users.id, ctx.userId));

    const otpauth = generateOTPAuthURL(secret, user.email || '');
    return NextResponse.json({ 
      otpauth, 
      note: 'Scan QR or enter secret in authenticator app, then POST to /api/auth/2fa/verify with a token to activate.' 
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}

// Re-export the canonical TOTP helpers for any existing importers
export { verifyTOTP, generateTOTPSecret };
