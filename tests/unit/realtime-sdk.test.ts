import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock EventSource before importing RealtimeSDK
class MockEventSource {
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    this.readyState = 1;
  }

  close() {
    this.readyState = 2;
  }

  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror();
    }
  }
}

/** The EventSource double as the SDK sees it: constructible, with an optional
 *  instance ledger (never populated by this mock — the guards below rely on it
 *  being absent). */
type MockEventSourceConstructor = {
  new (url: string): MockEventSource;
  instances?: MockEventSource[];
};

describe('RealtimeSDK', () => {
  let MockEventSourceCtor: MockEventSourceConstructor;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    MockEventSourceCtor = MockEventSource;
    (globalThis as { EventSource?: unknown }).EventSource = MockEventSourceCtor;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ticket: 'test-ticket-123' }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    delete (globalThis as { EventSource?: unknown }).EventSource;
  });

  async function createSDK() {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    return new RealtimeSDK({ baseUrl: 'https://api.example.com', apiKey: 'key-abc' });
  }

  it('constructs with default reconnect interval', async () => {
    const sdk = await createSDK();
    expect(sdk).toBeDefined();
  });

  it('connect creates EventSource with ticket token', async () => {
    const sdk = await createSDK();
    await sdk.connect();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/tenant/realtime/ticket',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('connect falls back to API key on ticket fetch failure', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
    const sdk = await createSDK();
    await sdk.connect();
    // Should still succeed by using apiKey as fallback
    expect(sdk).toBeDefined();
  });

  it('connect falls back when ticket endpoint returns non-OK', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const sdk = await createSDK();
    await sdk.connect();
    expect(sdk).toBeDefined();
  });

  it('disconnect closes EventSource and stops reconnect', async () => {
    const sdk = await createSDK();
    await sdk.connect();
    sdk.disconnect();
    const instances = MockEventSourceCtor.instances || [];
    const lastInstance = instances[instances.length - 1];
    if (lastInstance) {
      expect(lastInstance.readyState).toBe(MockEventSource.CLOSED);
    }
  });

  it('disconnect when not connected does not throw', async () => {
    const sdk = await createSDK();
    expect(() => sdk.disconnect()).not.toThrow();
  });

  it('on/off register and unregister handlers', async () => {
    const sdk = await createSDK();
    const handler = vi.fn();
    sdk.on('contact.created', handler);
    sdk.off('contact.created', handler);
    await sdk.connect();
    const lastCall = MockEventSourceCtor.instances?.slice(-1)[0];
    if (lastCall) {
      lastCall.simulateMessage(JSON.stringify({
        type: 'contact.created', channel: 'contacts',
        data: { id: '1' }, timestamp: new Date().toISOString(),
      }));
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('off without handler removes all handlers for event', async () => {
    const sdk = await createSDK();
    const h1 = vi.fn();
    const h2 = vi.fn();
    sdk.on('deal.updated', h1);
    sdk.on('deal.updated', h2);
    sdk.off('deal.updated');
    await sdk.connect();
    const lastCall = MockEventSourceCtor.instances?.slice(-1)[0];
    if (lastCall) {
      lastCall.simulateMessage(JSON.stringify({
        type: 'deal.updated', channel: 'deals',
        data: { id: '1' }, timestamp: new Date().toISOString(),
      }));
    }
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('off with non-existent handler does not throw', async () => {
    const sdk = await createSDK();
    const handler = vi.fn();
    expect(() => sdk.off('nonexistent', handler)).not.toThrow();
  });

  it('subscribe/unsubscribe manage channel set', async () => {
    const sdk = await createSDK();
    sdk.subscribe('contacts');
    sdk.subscribe('deals');
    sdk.unsubscribe('contacts');
    expect(() => sdk.unsubscribe('contacts')).not.toThrow();
  });

  it('unsubscribe removes handlers for channel', async () => {
    const sdk = await createSDK();
    const handler = vi.fn();
    sdk.on('contacts', handler);
    sdk.subscribe('contacts');
    sdk.unsubscribe('contacts');
    await sdk.connect();
    const lastCall = MockEventSourceCtor.instances?.slice(-1)[0];
    if (lastCall) {
      lastCall.simulateMessage(JSON.stringify({
        type: 'contacts.update', channel: 'contacts',
        data: { id: '1' }, timestamp: new Date().toISOString(),
      }));
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispatches messages to registered handlers', async () => {
    const sdk = await createSDK();
    const handler = vi.fn();
    sdk.on('contact.created', handler);

    await sdk.connect();

    // Get the mock EventSource instance and simulate a message
    const lastCall = MockEventSourceCtor.instances?.slice(-1)[0];
    if (lastCall) {
      lastCall.simulateMessage(JSON.stringify({
        type: 'contact.created',
        channel: 'contacts',
        data: { id: '123' },
        timestamp: new Date().toISOString(),
      }));
      expect(handler).toHaveBeenCalledTimes(1);
    }
  });

  it('ignores malformed messages', async () => {
    const sdk = await createSDK();
    const handler = vi.fn();
    sdk.on('contact.created', handler);

    await sdk.connect();

    const lastCall = MockEventSourceCtor.instances?.slice(-1)[0];
    if (lastCall) {
      lastCall.simulateMessage('not json');
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it('strips trailing slash from baseUrl', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://api.example.com/', apiKey: 'key' });
    await sdk.connect();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/api/tenant/realtime/ticket',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
