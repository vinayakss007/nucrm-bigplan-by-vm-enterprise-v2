import { NextRequest, NextResponse } from 'next/server';
import { generateCsrfToken, setCsrfCookie } from '@/lib/auth/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, { action: 'csrf_token', max: 10, windowMinutes: 1 });
  if (limited) return limited;

  const token = generateCsrfToken();
  const response = NextResponse.json({ ok: true });
  response.headers.append('Set-Cookie', setCsrfCookie(token, process.env.NODE_ENV === 'production'));
  return response;
}
