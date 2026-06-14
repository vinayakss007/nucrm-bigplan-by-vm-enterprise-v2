import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { notifications } from '@/drizzle/schema';
import { eq, and, isNull, sql } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof Response) return ctx;

    const tid = ctx.tenantId;
    const uid = ctx.userId;

    // SSE headers
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let interval: ReturnType<typeof setInterval> | undefined;
        let keepalive: ReturnType<typeof setInterval> | undefined;

        const sendUnread = async () => {
          try {
            const [row] = await db.select({
              count: sql<number>`COUNT(*)::int`,
            })
            .from(notifications)
            .where(and(
              eq(notifications.tenantId, tid),
              eq(notifications.userId, uid),
              isNull(notifications.readAt),
              isNull(notifications.deletedAt),
            ));

            const data = JSON.stringify({ type: 'unread', count: row?.count ?? 0 });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          } catch {
            console.error('[notifications-stream] Failed to send unread count');
            controller.close();
            if (interval) clearInterval(interval);
            if (keepalive) clearInterval(keepalive);
          }
        };

        // Poll every 30 seconds
        interval = setInterval(sendUnread, 30000);

        // Keep-alive every 10 seconds
        keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            // client disconnected
          }
        }, 10000);

        // Send initial count
        await sendUnread();

        request.signal.addEventListener('abort', () => {
          if (interval) clearInterval(interval);
          if (keepalive) clearInterval(keepalive);
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    console.error('[notifications-stream] Auth failed', err);
    return new Response('Unauthorized', { status: 401 });
  }
}
