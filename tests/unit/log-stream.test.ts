import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('log-stream', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  function createMockController() {
    return { enqueue: vi.fn(), close: vi.fn() } as unknown as ReadableStreamDefaultController;
  }

  it('subscribe adds a client and returns an id', async () => {
    const { logStream } = await import('@/lib/log-stream');
    const ctrl = createMockController();
    const id = logStream.subscribe(ctrl);
    expect(id).toBeTruthy();
    expect(logStream.clientCount).toBe(1);
    logStream.unsubscribe(id);
  });

  it('subscribe sends a connected event', async () => {
    const { logStream } = await import('@/lib/log-stream');
    const ctrl = createMockController();
    const id = logStream.subscribe(ctrl);
    expect(ctrl.enqueue).toHaveBeenCalled();
    const call = ctrl.enqueue.mock.calls[0][0];
    expect(call).toBeInstanceOf(Uint8Array);
    logStream.unsubscribe(id);
  });

  it('unsubscribe removes a client', async () => {
    const { logStream } = await import('@/lib/log-stream');
    const ctrl = createMockController();
    const id = logStream.subscribe(ctrl);
    expect(logStream.clientCount).toBe(1);
    logStream.unsubscribe(id);
    expect(logStream.clientCount).toBe(0);
  });

  it('broadcast sends data to all clients', async () => {
    const { logStream } = await import('@/lib/log-stream');
    const ctrl1 = createMockController();
    const ctrl2 = createMockController();
    const id1 = logStream.subscribe(ctrl1);
    const id2 = logStream.subscribe(ctrl2);
    logStream.broadcast({ level: 'info', ts: '2026-01-01T00:00:00Z', msg: 'test' });
    expect(ctrl1.enqueue).toHaveBeenCalledTimes(2);
    expect(ctrl2.enqueue).toHaveBeenCalledTimes(2);
    logStream.unsubscribe(id1);
    logStream.unsubscribe(id2);
  });

  it('broadcast removes clients that fail', async () => {
    const { logStream } = await import('@/lib/log-stream');
    let callCount = 0;
    const badCtrl = { enqueue: vi.fn().mockImplementation(() => { if (callCount++ > 0) throw new Error('broken'); }) } as unknown as ReadableStreamDefaultController;
    logStream.subscribe(badCtrl);
    expect(logStream.clientCount).toBe(1);
    logStream.broadcast({ level: 'error', ts: '', msg: 'boom' });
    expect(logStream.clientCount).toBe(0);
  });

  it('clientCount returns 0 when no clients', async () => {
    const { logStream } = await import('@/lib/log-stream');
    expect(logStream.clientCount).toBe(0);
  });

  it('streamLog calls broadcast with a log entry', async () => {
    const { logStream, streamLog } = await import('@/lib/log-stream');
    const ctrl = createMockController();
    const id = logStream.subscribe(ctrl);
    streamLog('info', 'hello', { key: 'val' });
    const lastCall = ctrl.enqueue.mock.calls[ctrl.enqueue.mock.calls.length - 1][0];
    const decoded = new TextDecoder().decode(lastCall);
    expect(decoded).toContain('hello');
    expect(decoded).toContain('"level":"info"');
    expect(decoded).toContain('"key":"val"');
    logStream.unsubscribe(id);
  });

  it('streamLog attaches stack for error level', async () => {
    const { logStream, streamLog } = await import('@/lib/log-stream');
    const ctrl = createMockController();
    const id = logStream.subscribe(ctrl);
    streamLog('error', 'oops');
    const lastCall = ctrl.enqueue.mock.calls[ctrl.enqueue.mock.calls.length - 1][0];
    const decoded = new TextDecoder().decode(lastCall);
    expect(decoded).toContain('"level":"error"');
    expect(decoded).toContain('"stack"');
    logStream.unsubscribe(id);
  });
});
