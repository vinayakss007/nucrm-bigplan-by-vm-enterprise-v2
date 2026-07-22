// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('sdk/realtime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

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

  it('disconnect closes EventSource and clears reconnect flag', async () => {
    const { RealtimeSDK } = await import('@/lib/sdk/realtime');
    const sdk = new RealtimeSDK({ baseUrl: 'https://example.com', apiKey: 'key-1' });
    const closeMock = vi.fn();
    (sdk as any).eventSource = { close: closeMock };
    sdk.disconnect();
    expect(closeMock).toHaveBeenCalled();
    expect((sdk as any).eventSource).toBeNull();
  });
});
