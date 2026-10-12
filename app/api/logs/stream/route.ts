/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest } from 'next/server';
import { getCurrentUserForToken } from '@/lib/auth/session';
import { logStream } from '@/lib/log-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('nucrm_session')?.value;
  if (!token) return new Response('Unauthorized', { status: 401 });

  // #2216: session-row-backed check — a signature-only verifyToken kept
  // working for 30 days after logout/admin revocation, and this stream
  // exposes other tenants' logs.
  const user = await getCurrentUserForToken(token);
  if (!user) return new Response('Unauthorized', { status: 401 });

  if (!user.isSuperAdmin) return new Response('Forbidden', { status: 403 });

  let clientId = '';

  const stream = new ReadableStream({
    start(controller) {
      clientId = logStream.subscribe(controller);
    },
    cancel() {
      logStream.unsubscribe(clientId);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
