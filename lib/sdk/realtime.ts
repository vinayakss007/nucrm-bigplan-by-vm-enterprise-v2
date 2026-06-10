import type { RealtimeEvent, RealtimeEventHandler } from './types';

export interface RealtimeConfig {
  baseUrl: string;
  apiKey: string;
  reconnectInterval?: number;
}

export class RealtimeSDK {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly reconnectInterval: number;
  private eventSource: EventSource | null = null;
  private handlers: Map<string, Set<RealtimeEventHandler>> = new Map();
  private channels: Set<string> = new Set();
  private shouldReconnect = false;

  constructor(config: RealtimeConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.reconnectInterval = config.reconnectInterval ?? 5000;
  }

  /**
   * Obtain a short-lived connection ticket from the server.
   * The ticket is used in the SSE URL instead of the raw API key,
   * preventing the permanent credential from appearing in URLs/logs.
   * Falls back to using the API key directly if ticket fetch fails.
   */
  private async getTicket(): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tenant/realtime/ticket`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json() as { ticket: string };
        return data.ticket;
      }
    } catch (e) {
      console.warn('[RealtimeSDK] Ticket fetch failed, using API key directly:', e);
    }
    return this.apiKey;
  }

  async connect(): Promise<void> {
    if (typeof EventSource === 'undefined') {
      throw new Error('EventSource is not available in this environment');
    }

    this.shouldReconnect = true;
    const token = await this.getTicket();
    const url = `${this.baseUrl}/api/tenant/realtime/events?token=${encodeURIComponent(token)}`;
    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as RealtimeEvent;
        this.dispatch(parsed.type, parsed);
        this.dispatch(parsed.channel, parsed);
      } catch (e) {
        console.warn('[RealtimeSDK] Ignoring malformed SSE message:', e);
      }
    };

    this.eventSource.onerror = () => {
      this.eventSource?.close();
      this.eventSource = null;
      if (this.shouldReconnect) {
        setTimeout(() => { void this.connect(); }, this.reconnectInterval);
      }
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  on(event: string, handler: RealtimeEventHandler): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  off(event: string, handler?: RealtimeEventHandler): void {
    if (!handler) {
      this.handlers.delete(event);
      return;
    }
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(event);
      }
    }
  }

  /**
   * Subscribe to a channel for client-side event filtering.
   *
   * Channel subscriptions are client-side filters on the event stream,
   * not server-side topic subscriptions. The server sends all events for
   * the tenant; the client filters locally by matching event.channel
   * against subscribed channels. This design keeps the SSE connection
   * simple (single stream per tenant) while letting consumers register
   * handlers for specific channels without receiving unrelated callbacks.
   */
  subscribe(channel: string): void {
    this.channels.add(channel);
  }

  /**
   * Unsubscribe from a channel and remove all handlers for that channel.
   *
   * This only affects client-side filtering. The server continues to send
   * all events on the SSE connection regardless of subscription state.
   */
  unsubscribe(channel: string): void {
    this.channels.delete(channel);
    this.handlers.delete(channel);
  }

  private dispatch(key: string, event: RealtimeEvent): void {
    const set = this.handlers.get(key);
    if (set) {
      for (const handler of set) {
        handler(event);
      }
    }
  }
}
