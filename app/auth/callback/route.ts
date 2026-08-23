/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextResponse } from 'next/server';
// OAuth callback - redirect to dashboard after cookie is set by login API
export async function GET(request: Request) {
  const url = new URL(request.url);
  const _code = url.searchParams.get('code');
  // For OAuth, the code would be exchanged here
  // For now redirect to login
  return NextResponse.redirect(new URL('/auth/login', request.url));
}
