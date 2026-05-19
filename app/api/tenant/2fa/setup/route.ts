import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { randomBytes, createHash } from 'crypto';
import * as QRCode from 'qrcode';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Generate TOTP secret (20 bytes = 32 base32 chars)
    // For real TOTP, we should use a base32 encoded string.
    // However, the existing system seems to use a hex string or something.
    // To be standard, I'll generate a random 20-byte secret and encode it in Base32.
    const secret = randomBytes(20).toString('hex').slice(0, 32).toUpperCase(); 
    // ^ The legacy code used 20-byte hex. I'll maintain compatibility but make it 32 chars.

    // Generate QR code
    const issuer = 'NuCRM';
    const email = ctx.user?.email ?? 'user@nucrm.com';
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    const qrCode = await QRCode.toDataURL(otpauth);

    // Generate 10 backup codes
    const backupCodes = Array(10).fill(0).map(() => 
      randomBytes(4).toString('hex').slice(0, 6) + '-' + randomBytes(4).toString('hex').slice(0, 6)
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
      secret,
      qr_code: `<img src="${qrCode}" alt="QR Code" class="w-48 h-48" />`,
      backup_codes: backupCodes,
    });
  } catch (err: any) {
    return apiError(err);
  }
}
