/**
 * 2FA Setup — generates a TOTP secret and QR code URI.
 * User scans QR in Google Authenticator, then calls /verify to confirm.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { createHmac, randomBytes } from 'crypto';

function generateTOTPSecret(): string {
  // 20-byte random secret, base32-encoded
  const bytes = randomBytes(20);
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let bits = 0, value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += base32chars[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += base32chars[(value << (5 - bits)) & 31];
  return result;
}

function generateOTPAuthURL(secret: string, email: string, issuer = 'NuCRM'): string {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(email)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Simple TOTP verification (without external library)
function verifyTOTP(secret: string, token: string, window = 1): boolean {
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  // Decode base32 secret
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const char of secret.toUpperCase()) {
    const idx = base32chars.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const key = Buffer.from(bytes);
  const counter = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i++) {
    const c = counter + i;
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(c / 0x100000000), 0);
    buf.writeUInt32BE(c >>> 0, 4);
    const hmac = createHmac('sha1', key).update(buf).digest();
    const offset = hmac[hmac.length - 1]! & 0xf;
    const code = ((hmac[offset]! & 0x7f) << 24 | hmac[offset+1]! << 16 | hmac[offset+2]! << 8 | hmac[offset+3]!) % 1000000;
    if (String(code).padStart(6, '0') === token) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
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
      secret, 
      otpauth, 
      note: 'Scan QR or enter secret in authenticator app, then POST to /api/auth/2fa/verify with a token to activate.' 
    });
  } catch (err: any) { 
    return NextResponse.json({ error: err.message }, { status: 500 }); 
  }
}

// Export verifyTOTP for use in login
export { verifyTOTP, generateTOTPSecret };
