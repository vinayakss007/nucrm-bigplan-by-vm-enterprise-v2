import { NextResponse } from 'next/server';
import { generateCsrfToken, setCsrfCookie } from '@/lib/auth/csrf';

export async function GET() {
  const token = generateCsrfToken();
  const response = NextResponse.json({ ok: true });
  response.headers.append('Set-Cookie', setCsrfCookie(token, process.env.NODE_ENV === 'production'));
  return response;
}
