/**
 * Log Stream Hub — real-time log broadcasting via SSE
 *
 * Collects log entries from logger.ts and dev-logger.ts
 * and pushes them to all connected SSE clients.
 */

type LogEntry = {
  level: 'info' | 'warn' | 'error' | 'debug' | 'success';
  ts: string;
  msg: string;
  meta?: Record<string, unknown>;
  stack?: string;
};

type SSEClient = {
  id: string;
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
};

let clientId = 0;
const clients = new Map<string, SSEClient>();

const encoder = new TextEncoder();

export const logStream = {
  subscribe(controller: ReadableStreamDefaultController): string {
    const id = String(++clientId);
    clients.set(id, { id, controller, encoder });
    controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ clientId: id })}\n\n`));
    return id;
  },

  unsubscribe(id: string) {
    clients.delete(id);
  },

  broadcast(entry: LogEntry) {
    const data = `data: ${JSON.stringify(entry)}\n\n`;
    const bytes = encoder.encode(data);
    for (const [id, client] of clients) {
      try {
        client.controller.enqueue(bytes);
      } catch {

        clients.delete(id);
      }
    }
  },

  get clientCount(): number {
    return clients.size;
  },
};

export function streamLog(level: LogEntry['level'], msg: string, meta?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    ts: new Date().toISOString(),
    msg,
    meta,
    stack: level === 'error' ? new Error().stack?.split('\n').slice(2).join('\n') : undefined,
  };
  logStream.broadcast(entry);
}
