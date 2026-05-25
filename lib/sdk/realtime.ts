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

  connect(): void {
    if (typeof EventSource === 'undefined') {
      throw new Error('EventSource is not available in this environment');
    }

    this.shouldReconnect = true;
    const url = `${this.baseUrl}/api/tenant/realtime/events?token=${encodeURIComponent(this.apiKey)}`;
    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as RealtimeEvent;
        this.dispatch(parsed.type, parsed);
        this.dispatch(parsed.channel, parsed);
      } catch {
        // Ignore malformed messages
      }
    };

    this.eventSource.onerror = () => {
      this.eventSource?.close();
      this.eventSource = null;
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectInterval);
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

  subscribe(channel: string): void {
    this.channels.add(channel);
  }

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
