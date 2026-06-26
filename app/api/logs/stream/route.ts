import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth/session';
import { db } from '@/drizzle/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { logStream } from '@/lib/log-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const token = request.cookies.get('nucrm_session')?.value;
  if (!token) return new Response('Unauthorized', { status: 401 });

  const payload = await verifyToken(token);
  if (!payload) return new Response('Unauthorized', { status: 401 });

  const [user] = await db.select({ isSuperAdmin: users.isSuperAdmin })
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);

  if (!user?.isSuperAdmin) return new Response('Forbidden', { status: 403 });

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
