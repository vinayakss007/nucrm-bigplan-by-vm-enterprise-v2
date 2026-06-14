'use client';
import { useState, useEffect, useRef } from 'react';

interface NotificationState {
  unreadCount: number;
  connected: boolean;
}

export function useNotifications(enabled = true) {
  const [state, setState] = useState<NotificationState>({ unreadCount: 0, connected: false });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectAttempts = 0;

    const connect = () => {
      if (!mountedRef.current) return;
      try {
        eventSource = new EventSource('/api/tenant/notifications/stream');

        eventSource.onopen = () => {
          if (!mountedRef.current) return;
          setState(prev => ({ ...prev, connected: true }));
          reconnectAttempts = 0;
        };

        eventSource.addEventListener('message', (event) => {
          if (!mountedRef.current) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'unread') {
              setState(prev => ({ ...prev, unreadCount: data.count }));
            }
          } catch (e) { console.warn('[Notifications] SSE parse error:', e); }
        });

        eventSource.onerror = () => {
          if (!mountedRef.current) return;
          eventSource?.close();
          setState(prev => ({ ...prev, connected: false }));
          if (!mountedRef.current) return;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectTimer = setTimeout(connect, delay);
          reconnectAttempts++;
        };
      } catch (e) { console.warn('[Notifications] SSE not supported:', e); }
    };

    connect();

    return () => {
      mountedRef.current = false;
      eventSource?.close();
      clearTimeout(reconnectTimer);
    };
  }, [enabled]);

  return state;
}

/**
 * Mark all notifications as read
 */
export async function markAllRead(): Promise<void> {
  await fetch('/api/tenant/notifications', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'mark_all_read' }),
  });
}
