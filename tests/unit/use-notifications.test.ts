import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockSetState: any;
let cleanupRegistry: (() => void)[] = [];

vi.mock('react', () => ({
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  useState: (initial: any) => {
    mockSetState = vi.fn();
    return [initial, mockSetState];
  },
  useEffect: (fn: () => void | (() => void)) => {
    const cleanup = fn();
    if (cleanup) cleanupRegistry.push(cleanup);
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  useCallback: (fn: any) => fn,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  useRef: (initial: any) => ({ current: initial }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockEventSourceInstance: any;
let onOpenCallback: (() => void) | null = null;
let onErrorCallback: (() => void) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let messageHandlers: Map<string, ((event: any) => void)[]> = new Map();

class MockEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(public url: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    mockEventSourceInstance = this;
    this.onopen = () => {};
    this.onerror = () => {};
  }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, handler: (event: any) => void) {
    if (!messageHandlers.has(type)) messageHandlers.set(type, []);
    messageHandlers.get(type)!.push(handler);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function triggerSSEMessage(data: any) {
  const handlers = messageHandlers.get('message') || [];
  handlers.forEach(h => h({ data: JSON.stringify(data) }));
}

beforeEach(() => {
  cleanupRegistry = [];
  messageHandlers = new Map();
  mockEventSourceInstance = null;
  onOpenCallback = null;
  onErrorCallback = null;
  mockSetState = null;
  vi.clearAllMocks();
  vi.stubGlobal('EventSource', MockEventSource);
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (cleanupRegistry.length) {
    const cb = cleanupRegistry.shift();
    if (cb) cb();
  }
});

describe('useNotifications', () => {
  it('connects to SSE endpoint when enabled', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    expect(mockEventSourceInstance).toBeDefined();
    expect(mockEventSourceInstance.url).toBe('/api/tenant/notifications/stream');
  });

  it('does not connect when disabled', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(false);
    expect(mockEventSourceInstance).toBeNull();
  });

  it('updates unread count on message event', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    triggerSSEMessage({ type: 'unread', count: 5 });
    expect(mockSetState).toHaveBeenCalled();
  });

  it('ignores invalid JSON in SSE messages', async () => {
    const { useNotifications } = await import('@/lib/use-notifications');
    useNotifications(true);
    const handlers = messageHandlers.get('message') || [];
    expect(() => handlers.forEach(h => h({ data: 'not-json' }))).not.toThrow();
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
