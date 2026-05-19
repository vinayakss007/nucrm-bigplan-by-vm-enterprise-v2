import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { createHmac, randomBytes, createHash } from 'crypto';

function verifyTOTP(secret: string, token: string, window = 1): boolean {
  const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
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

function generateBackupCodes(count = 8): { plain: string[]; hashed: string[] } {
  const plain = Array.from({length: count}, () => randomBytes(4).toString('hex').toUpperCase());
  const hashed = plain.map(c => createHash('sha256').update(c).digest('hex'));
  return { plain, hashed };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const { token } = await req.json();
    if (!token || !/^\d{6}$/.test(token)) {
      return NextResponse.json({ error: 'Provide 6-digit TOTP token' }, { status: 400 });
    }

    const user = await db.query.users.findFirst({
      columns: { totpSecret: true, totpEnabled: true },
      where: eq(users.id, ctx.userId)
    });

    if (!user?.totpSecret) {
      return NextResponse.json({ error: 'Setup 2FA first via POST /api/auth/2fa/setup' }, { status: 400 });
    }
    if (user.totpEnabled) {
      return NextResponse.json({ error: '2FA already verified/enabled' }, { status: 400 });
    }

    if (!verifyTOTP(user.totpSecret, token)) {
      return NextResponse.json({ error: 'Invalid token. Check your authenticator app time sync.' }, { status: 401 });
    }

    const { plain, hashed } = generateBackupCodes(8);
    
    await db.update(users)
      .set({ 
        totpEnabled: true, 
        totpVerifiedAt: new Date(), 
        totpBackupCodes: hashed 
      })
      .where(eq(users.id, ctx.userId));

    return NextResponse.json({ 
      ok: true, 
      backup_codes: plain, 
      note: 'Save these backup codes — each can only be used once.' 
    });
  } catch (err: any) { 
    return NextResponse.json({ error: err.message }, { status: 500 }); 
  }
}
