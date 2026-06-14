import { logStream } from '@/lib/log-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
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
