/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateCsrfToken, setCsrfCookie } from '@/lib/auth/csrf';
import { cookieSecureForRequest } from '@/lib/auth/cookie-security';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, { action: 'csrf_token', max: 10, windowMinutes: 1 });
  if (limited) return limited;

  // #2275: central resolution — COOKIE_SECURE wins, production fail-closed,
  // otherwise Secure whenever the request arrived over HTTPS.
  const secure = cookieSecureForRequest(request);

  const token = generateCsrfToken();
  const response = NextResponse.json({ ok: true, token });
  response.headers.append('Set-Cookie', setCsrfCookie(token, secure));
  return response;
}
