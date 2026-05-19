import { NextResponse } from 'next/server';
// OAuth callback - redirect to dashboard after cookie is set by login API
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  // For OAuth, the code would be exchanged here
  // For now redirect to login
  return NextResponse.redirect(new URL('/auth/login', request.url));
}
