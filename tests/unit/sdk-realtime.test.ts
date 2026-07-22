/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-this-alias */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock EventSource for jsdom ───────────────────────────────────────
let esInstance: MockEventSource | null = null;

class MockEventSource {
  static last: MockEventSource | null = null;
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(url: string) {
    this.url = url;
    MockEventSource.last = this;
    esInstance = this;
  }
}

describe('sdk/realtime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    esInstance = null;
    // Ensure EventSource is available for every test
    (globalThis as any).EventSource = MockEventSource;
    // Mock fetch for getTicket
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ticket: 'ticket-abc' }),
    }));
  });

  // ── Constructor ────────────────────────────────────────────────────
  it('constructor stores config and strips trailing slash', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com/', apiKey: 'key-1' });
    expect((sdk as any).baseUrl).toBe('https://example.com');
    expect((sdk as any).apiKey).toBe('key-1');
    expect((sdk as any).reconnectInterval).toBe(5000);
  });

  it('constructor uses custom reconnect interval', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'key-1', reconnectInterval: 3000 });
    expect((sdk as any).reconnectInterval).toBe(3000);
  });

  // ── on / off ───────────────────────────────────────────────────────
  it('on registers event handler', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'key-1' });
    const handler = vi.fn();
    sdk.on('event1', handler);
    expect((sdk as any).handlers.get('event1')?.has(handler)).toBe(true);
  });

  it('on creates new Set for first handler on event', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'key-1' });
    const handler = vi.fn();
    sdk.on('event1', handler);
    sdk.on('event1', handler);
    expect((sdk as any).handlers.get('event1')?.size).toBe(1);
  });

  it('off removes specific handler', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'key-1' });
    const h1 = vi.fn();
    const h2 = vi.fn();
    sdk.on('evt', h1);
    sdk.on('evt', h2);
    sdk.off('evt', h1);
    expect((sdk as any).handlers.get('evt')?.has(h1)).toBe(false);
    expect((sdk as any).handlers.get('evt')?.has(h2)).toBe(true);
  });

  it('off with no handler removes all handlers for event', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'key-1' });
    sdk.on('evt', vi.fn());
    sdk.off('evt');
    expect((sdk as any).handlers.has('evt')).toBe(false);
  });

  it('off deletes event set when last handler removed', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'key-1' });
    const h = vi.fn();
    sdk.on('evt', h);
    sdk.off('evt', h);
    expect((sdk as any).handlers.has('evt')).toBe(false);
  });

  // ── subscribe / unsubscribe ────────────────────────────────────────
  it('subscribe adds channel', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'key-1' });
    sdk.subscribe('channel-1');
    expect((sdk as any).channels.has('channel-1')).toBe(true);
  });

  it('unsubscribe removes channel and its handlers', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'key-1' });
    sdk.subscribe('ch');
    sdk.on('ch', vi.fn());
    sdk.unsubscribe('ch');
    expect((sdk as any).channels.has('ch')).toBe(false);
    expect((sdk as any).handlers.has('ch')).toBe(false);
  });

  // ── disconnect (standalone) ────────────────────────────────────────
  it('disconnect closes EventSource and clears reconnect flag', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'key-1' });
    const closeMock = vi.fn();
    (sdk as any).eventSource = { close: closeMock };
    (sdk as any).shouldReconnect = true;
    sdk.disconnect();
    expect(closeMock).toHaveBeenCalled();
    expect((sdk as any).eventSource).toBeNull();
    expect((sdk as any).shouldReconnect).toBe(false);
  });

  it('disconnect is safe when no EventSource exists', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'key-1' });
    // Should not throw
    sdk.disconnect();
    expect((sdk as any).eventSource).toBeNull();
    expect((sdk as any).shouldReconnect).toBe(false);
  });

  // ── connect: ticket fetch ──────────────────────────────────────────
  it('connect fetches ticket and builds SSE URL', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ticket: 'tk-123' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://api.example.com', apiKey: 'secret-key' });
    await sdk.connect();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/api/tenant/realtime/ticket',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(esInstance).not.toBeNull();
    expect(esInstance!.url).toContain('token=tk-123');
    sdk.disconnect();
  });

  it('connect falls back to API key when ticket fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://api.example.com', apiKey: 'fallback-key' });
    await sdk.connect();

    expect(esInstance).not.toBeNull();
    expect(esInstance!.url).toContain('token=fallback-key');
    sdk.disconnect();
  });

  it('connect falls back to API key when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://api.example.com', apiKey: 'fb2' });
    await sdk.connect();

    expect(esInstance!.url).toContain('token=fb2');
    sdk.disconnect();
  });

  // ── connect: throws without EventSource ────────────────────────────
  it('connect throws when EventSource is not available', async () => {
    delete (globalThis as any).EventSource;

    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'k' });
    await expect(sdk.connect()).rejects.toThrow('EventSource is not available');

    // Restore for other tests
    (globalThis as any).EventSource = MockEventSource;
  });

  // ── connect: onmessage dispatching ─────────────────────────────────
  it('dispatches message to handlers by type and channel', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'k' });
    const typeHandler = vi.fn();
    const channelHandler = vi.fn();
    sdk.on('deal.created', typeHandler);
    sdk.on('deals', channelHandler);

    await sdk.connect();

    const evt = { type: 'deal.created', channel: 'deals', data: { id: 1 }, timestamp: '2026-01-01' };
    esInstance!.onmessage!({ data: JSON.stringify(evt) } as MessageEvent);

    expect(typeHandler).toHaveBeenCalledTimes(1);
    expect(typeHandler).toHaveBeenCalledWith(evt);
    expect(channelHandler).toHaveBeenCalledTimes(1);
    expect(channelHandler).toHaveBeenCalledWith(evt);
    sdk.disconnect();
  });

  it('ignores malformed JSON in onmessage', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'k' });
    const handler = vi.fn();
    sdk.on('anything', handler);

    await sdk.connect();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    esInstance!.onmessage!({ data: 'NOT-JSON' } as MessageEvent);

    expect(handler).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[RealtimeSDK] Malformed message received');
    warnSpy.mockRestore();
    sdk.disconnect();
  });

  // ── connect: onerror reconnects ────────────────────────────────────
  it('onerror closes EventSource and reconnects after interval', async () => {
    vi.useFakeTimers();
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'k', reconnectInterval: 1000 });
    await sdk.connect();

    const firstES = esInstance;
    expect(firstES).not.toBeNull();

    // Trigger error
    firstES!.onerror!();

    // EventSource should be closed and nulled
    expect(firstES!.close).toHaveBeenCalled();
    expect((sdk as any).eventSource).toBeNull();

    // Advance timer to trigger reconnect
    await vi.advanceTimersByTimeAsync(1100);

    // A new EventSource should have been created
    expect(esInstance).not.toBeNull();
    expect(esInstance).not.toBe(firstES);
    sdk.disconnect();
    vi.useRealTimers();
  });

  it('onerror does not reconnect when shouldReconnect is false', async () => {
    vi.useFakeTimers();
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'k' });
    await sdk.connect();
    const firstES = esInstance;

    sdk.disconnect(); // sets shouldReconnect = false
    firstES!.onerror!();

    await vi.advanceTimersByTimeAsync(6000);
    // No new EventSource should be created
    expect(esInstance).toBe(firstES);
    vi.useRealTimers();
  });
});
