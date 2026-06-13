'use client';
import { useState, useEffect, useCallback } from 'react';

interface NotificationState {
  unreadCount: number;
  connected: boolean;
}

export function useNotifications(enabled = true) {
  const [state, setState] = useState<NotificationState>({ unreadCount: 0, connected: false });

  useEffect(() => {
    if (!enabled) return;

    let eventSource: EventSource | null = null;
    let reconnectTimer: NodeJS.Timeout;
    let reconnectAttempts = 0;

    const connect = () => {
      try {
        eventSource = new EventSource('/api/tenant/notifications/stream');

        eventSource.onopen = () => {
          setState(prev => ({ ...prev, connected: true }));
          reconnectAttempts = 0;
        };

        eventSource.addEventListener('message', (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'unread') {
              setState(prev => ({ ...prev, unreadCount: data.count }));
            }
          } catch { /* Fallback to default on corrupted storage data */ }
        });

        eventSource.onerror = () => {
          eventSource?.close();
          setState(prev => ({ ...prev, connected: false }));
          // Exponential backoff reconnect
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          reconnectTimer = setTimeout(connect, delay);
          reconnectAttempts++;
        };
      } catch { /* Fallback to default on corrupted storage data */ }
    };

    connect();

    return () => {
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
