import { createHmac } from 'crypto';

/**
 * Verify a 6-digit TOTP code against a base32 secret.
 * @param secret - The base32 encoded TOTP secret.
 * @param token - The 6-digit code to verify.
 * @returns boolean - True if the code is valid.
 */
export function verifyTOTP(secret: string, token: string): boolean {
  if (!secret || !token) return false;

  const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0;
  const kb: number[] = [];
  
  for (const c of secret.toUpperCase()) {
    const idx = b32.indexOf(c);
    if (idx === -1) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      kb.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  
  const key = Buffer.from(kb);
  const counter = Math.floor(Date.now() / 30000);
  
  // Check current and adjacent time windows (±1)
  for (let i = -1; i <= 1; i++) {
    const buf = Buffer.alloc(8);
    // writeBigInt64BE expects a BigInt. BigInt(counter + i) is correct.
    buf.writeBigInt64BE(BigInt(counter + i));
    
    const hmac = createHmac('sha1', key);
    hmac.update(buf);
    const digest = hmac.digest();
    
    const offset = digest[digest.length - 1]! & 0xf;
    const code = ((digest[offset]! & 0x7f) << 24 |
                  (digest[offset + 1]! & 0xff) << 16 |
                  (digest[offset + 2]! & 0xff) << 8 |
                  (digest[offset + 3]! & 0xff)) % 1000000;
    
    if (code.toString().padStart(6, '0') === token) {
      return true;
    }
  }
  
  return false;
}
