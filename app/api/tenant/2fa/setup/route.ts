/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import { generateTOTPSecret } from '@/lib/auth/totp';
import * as QRCode from 'qrcode';
import { withApiRoute } from '@/lib/api/with-api-route';

export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // RFC 4648 base32 secret — must match what verifyTOTP() decodes.
    // (Hex secrets silently fail verification: 8/9 are stripped as
    // non-base32 chars, decoding to the wrong key.)
    const secret = generateTOTPSecret();

    // Generate QR code
    const issuer = 'NuCRM';
    const email = ctx.user?.email ?? 'user@nucrm.com';
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    const qrCode = await QRCode.toDataURL(otpauth);

    // Generate 10 backup codes, 72 bits of entropy each (was: two
    // 6-hex-char halves = 24 bits each, trivially guessable).
    const backupCodes = Array(10).fill(0).map(() =>
      randomBytes(9).toString('hex')
    );

    // Hash backup codes for storage
    const hashedCodes = backupCodes.map(code => createHash('sha256').update(code.toUpperCase()).digest('hex'));

    // Store secret and backup codes (but don't enable yet - wait for verification)
    await db.update(users)
      .set({ 
        totpSecret: secret, 
        totpBackupCodes: hashedCodes,
        updatedAt: new Date()
      })
      .where(eq(users.id, ctx.userId));

    return NextResponse.json({
      qr_code: qrCode,
      backup_codes: backupCodes,
      note: 'Save your backup codes securely. They can be used to access your account if you lose your authenticator device.',
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});
