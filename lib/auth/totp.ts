/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Verify a 6-digit TOTP code against a base32 secret.
 * @param secret - The base32 encoded TOTP secret.
 * @param token - The 6-digit code to verify.
 * @param window - Number of adjacent 30s time steps to accept on each side.
 * @returns boolean - True if the code is valid.
 */
export function verifyTOTP(secret: string, token: string, window = 1): boolean {
  if (!secret || !token) return false;
  if (!/^\d{6}$/.test(token)) return false;

  const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0;
  const kb: number[] = [];

  for (const c of secret.replace(/[^A-Za-z0-7]/g, '').toUpperCase()) {
    const idx = b32.indexOf(c);
    if (idx === -1) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      kb.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  if (kb.length === 0) return false;
  const key = Buffer.from(kb);
  const counter = Math.floor(Date.now() / 30000);

  // Check current and adjacent time windows
  for (let i = -window; i <= window; i++) {
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

    // Constant-time comparison of the derived code against the submitted token.
    // Both are exactly 6 ASCII digits (token is validated by /^\d{6}$/ above and
    // the derived code is left-padded to 6), so the buffers are equal length and
    // timingSafeEqual is safe. Avoids the timing leak of a short-circuiting `===`.
    const codeBuf = Buffer.from(code.toString().padStart(6, '0'), 'utf8');
    const tokenBuf = Buffer.from(token, 'utf8');
    if (codeBuf.length === tokenBuf.length && timingSafeEqual(codeBuf, tokenBuf)) {
      return true;
    }
  }

  return false;
}

/**
 * Generate a random 20-byte TOTP secret, base32-encoded.
 * Consolidated here so all 2FA routes share one implementation (Issue #1263).
 */
export function generateTOTPSecret(): string {
  const bytes = randomBytes(20);
  const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let bits = 0, value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += b32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += b32[(value << (5 - bits)) & 31];
  return result;
}
