/* eslint-disable @typescript-eslint/no-explicit-any -- react/socket mocks are intentionally loose */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let mockSetState: any;
let cleanupRegistry: (() => void)[] = [];

vi.mock('react', () => ({
  useState: (initial: any) => {
    mockSetState = vi.fn();
    return [initial, mockSetState];
  },
  useEffect: (fn: () => void | (() => void)) => {
    const cleanup = fn();
    if (cleanup) cleanupRegistry.push(cleanup);
  },
  useCallback: (fn: any) => fn,
  useRef: (initial: unknown) => ({ current: initial }),
}));

// ── socket.io-client mock ────────────────────────────────────────────────────
// The hook dynamically imports this, so the mock must be hoisted by vi.mock.
let socketHandlers: Map<string, ((payload?: any) => void)[]>;
let mockSocket: any;
let socketFactoryOpts: any;
let socketCreated = false;

vi.mock('socket.io-client', () => ({
  io: (opts: any) => {
    socketCreated = true;
    socketFactoryOpts = opts;
    return mockSocket;
  },
}));

function emitSocket(event: string, payload?: any) {
  (socketHandlers.get(event) ?? []).forEach((h) => h(payload));
}

// ── EventSource (SSE fallback) mock ──────────────────────────────────────────
let mockEventSourceInstance: any;
let messageHandlers: Map<string, ((event: any) => void)[]>;

class MockEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    mockEventSourceInstance = this;
  }
  addEventListener(type: string, handler: (event: any) => void) {
    if (!messageHandlers.has(type)) messageHandlers.set(type, []);
    messageHandlers.get(type)!.push(handler);
  }
}

function triggerSSEMessage(data: any) {
  (messageHandlers.get('message') ?? []).forEach((h) => h({ data: JSON.stringify(data) }));
}

/** Yields once to the event loop. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Waits until the hook's async bootstrap has actually finished wiring the socket.
 * A fixed `setTimeout(0)` is not enough: the hook `await`s a dynamic
 * `import('socket.io-client')`, whose resolution takes a variable number of
 * microtask turns, which made these tests flaky (~2 in 3 failing).
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await tick();
    if (socketHandlers.has('connect_error')) return;
  }
}

beforeEach(() => {
  cleanupRegistry = [];
  messageHandlers = new Map();
  socketHandlers = new Map();
  mockEventSourceInstance = null;
  mockSetState = null;
  socketFactoryOpts = null;
  socketCreated = false;
  mockSocket = {
    on: (event: string, handler: (payload?: any) => void) => {
      if (!socketHandlers.has(event)) socketHandlers.set(event, []);
      socketHandlers.get(event)!.push(handler);
    },
    close: vi.fn(),
  };
  vi.clearAllMocks();
  vi.stubGlobal('EventSource', MockEventSource);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unread: 3 }) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (cleanupRegistry.length) {
    const cb = cleanupRegistry.shift();
    if (cb) cb();
  }
});

describe('useNotifications — socket transport (preferred)', () => {
  it('opens a socket on the shared realtime path, not an SSE stream', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    await flush();

    expect(socketCreated).toBe(true);
    expect(socketFactoryOpts.path).toBe('/socket.io');
    expect(socketFactoryOpts.withCredentials).toBe(true);
    // Polling must stay available for restrictive proxies.
    expect(socketFactoryOpts.transports).toContain('polling');
    // The whole point of #644: no SSE stream while the socket is healthy.
    expect(mockEventSourceInstance).toBeNull();
  });

  it('seeds the absolute unread count once on connect', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    await flush();

    emitSocket('connect');
    await flush();

    expect(fetch).toHaveBeenCalledWith(
      '/api/tenant/notifications?limit=1',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(mockSetState).toHaveBeenCalled();
  });

  it('increments on a pushed notification instead of re-querying', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    await flush();

    const fetchCallsBefore = (fetch as any).mock.calls.length;
    emitSocket('notification:new', { title: 'hi' });

    expect(mockSetState).toHaveBeenCalled();
    // No extra network round-trip — that is the efficiency win.
    expect((fetch as any).mock.calls.length).toBe(fetchCallsBefore);
  });

  it('accepts an authoritative count push (e.g. after mark-all-read)', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    await flush();

    emitSocket('notification:unread', { count: 0 });
    expect(mockSetState).toHaveBeenCalled();
  });

  it('ignores a malformed count payload', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    await flush();

    expect(() => emitSocket('notification:unread', { count: 'lots' })).not.toThrow();
  });
});

describe('useNotifications — SSE fallback', () => {
  it('falls back to SSE when the realtime process is unreachable', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    await flush();

    expect(mockEventSourceInstance).toBeNull();

    // No realtime server deployed → must degrade, not go dark.
    emitSocket('connect_error', new Error('xhr poll error'));
    await flush();

    expect(mockSocket.close).toHaveBeenCalled();
    expect(mockEventSourceInstance).not.toBeNull();
    expect(mockEventSourceInstance.url).toBe('/api/tenant/notifications/stream');
  });

  it('updates the unread count from an SSE message', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    await flush();
    emitSocket('connect_error', new Error('down'));
    await flush();

    expect(mockEventSourceInstance).not.toBeNull();
    const before = mockSetState.mock.calls.length;
    triggerSSEMessage({ type: 'unread', count: 5 });
    expect(mockSetState.mock.calls.length).toBeGreaterThan(before);
  });

  it('ignores invalid JSON in SSE messages', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    await flush();
    emitSocket('connect_error', new Error('down'));
    await flush();

    const handlers = messageHandlers.get('message') ?? [];
    expect(() => handlers.forEach((h) => h({ data: 'not-json' }))).not.toThrow();
  });

  it('does not open a second SSE stream on repeated connect_error', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    await flush();

    emitSocket('connect_error', new Error('down'));
    await flush();
    const first = mockEventSourceInstance;

    emitSocket('connect_error', new Error('down again'));
    await flush();

    expect(mockEventSourceInstance).toBe(first);
  });
});

describe('useNotifications — disabled', () => {
  it('connects to nothing when disabled', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(false);
    await flush();

    expect(socketCreated).toBe(false);
    expect(mockEventSourceInstance).toBeNull();
  });
});

describe('markAllRead', () => {
  it('sends PATCH request', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    const { markAllRead } = await import('@/lib/use-notifications');
    await markAllRead();
    expect(mockFetch).toHaveBeenCalledWith('/api/tenant/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mark_all_read' }),
    });
  });
});
