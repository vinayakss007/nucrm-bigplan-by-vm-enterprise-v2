/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateCsrfToken, setCsrfCookie, requestIsHttps } from '@/lib/auth/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, { action: 'csrf_token', max: 10, windowMinutes: 1 });
  if (limited) return limited;

  // Mark the cookie Secure when the request is over HTTPS or in production.
  const secure = requestIsHttps(request) || process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';

  const token = generateCsrfToken();
  const response = NextResponse.json({ ok: true, token });
  response.headers.append('Set-Cookie', setCsrfCookie(token, secure));
  return response;
}
