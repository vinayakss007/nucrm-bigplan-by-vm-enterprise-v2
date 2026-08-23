/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useRef } from 'react';
import { RealtimeEvent, REALTIME_PATH } from '@/lib/realtime/events';

interface NotificationState {
  unreadCount: number;
  connected: boolean;
  /** Which mechanism is currently delivering updates. */
  transport: 'socket' | 'sse' | 'none';
}

/** Fetch the authoritative unread count. Used on connect and as SSE's payload. */
async function fetchUnreadCount(signal?: AbortSignal): Promise<number | null> {
  try {
    // The list endpoint returns the unread total alongside the page.
    const res = await fetch('/api/tenant/notifications?limit=1', { signal });
    if (!res.ok) return null;
    const json = await res.json();
    const count = json?.unread;
    return typeof count === 'number' ? count : null;
  } catch {
    return null;
  }
}

/**
 * Live unread-notification count.
 *
 * Prefers a socket.io push connection (issue #644): the previous implementation
 * held an SSE stream that re-queried the database every 30s per connected client,
 * so cost scaled with connections rather than with events.
 *
 * SSE is kept as an automatic fallback. The realtime process is deployed
 * separately, so it may legitimately be absent (local dev, a partial rollout) —
 * in that case notifications must keep working, just less efficiently.
 */
export function useNotifications(enabled = true) {
  const [state, setState] = useState<NotificationState>({
    unreadCount: 0,
    connected: false,
    transport: 'none',
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;

    const abort = new AbortController();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let socket: any = null;
    let eventSource: EventSource | null = null;
    let sseReconnectTimer: ReturnType<typeof setTimeout>;
    let sseAttempts = 0;
    let usingSse = false;

    const setUnread = (count: number) =>
      setState((prev) => ({ ...prev, unreadCount: Math.max(0, count) }));

    // ── SSE fallback (previous behaviour) ─────────────────────────────────
    const connectSse = () => {
      if (!mountedRef.current || usingSse) return;
      usingSse = true;
      const open = () => {
        if (!mountedRef.current) return;
        try {
          eventSource = new EventSource('/api/tenant/notifications/stream');
          eventSource.onopen = () => {
            if (!mountedRef.current) return;
            setState((prev) => ({ ...prev, connected: true, transport: 'sse' }));
            sseAttempts = 0;
          };
          eventSource.addEventListener('message', (event) => {
            if (!mountedRef.current) return;
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'unread') setUnread(data.count);
            } catch {
              /* ignore malformed frame */
            }
          });
          eventSource.onerror = () => {
            if (!mountedRef.current) return;
            eventSource?.close();
            setState((prev) => ({ ...prev, connected: false }));
            const delay = Math.min(1000 * Math.pow(2, sseAttempts), 30000);
            sseReconnectTimer = setTimeout(open, delay);
            sseAttempts++;
          };
        } catch {
          if (process.env.NODE_ENV === 'development') {
            console.error('[useNotifications] Failed to create EventSource');
          }
        }
      };
      open();
    };

    // ── preferred: socket.io push ─────────────────────────────────────────
    (async () => {
      try {
        const { io } = await import('socket.io-client');
        if (!mountedRef.current) return;

        socket = io({
          path: REALTIME_PATH,
          withCredentials: true,
          transports: ['websocket', 'polling'],
          reconnectionAttempts: 5,
          timeout: 8000,
        });

        socket.on('connect', async () => {
          if (!mountedRef.current) return;
          setState((prev) => ({ ...prev, connected: true, transport: 'socket' }));
          // The socket carries deltas, so seed the absolute count once.
          const count = await fetchUnreadCount(abort.signal);
          if (mountedRef.current && count !== null) setUnread(count);
        });

        // A new notification arrived: increment rather than re-query, which is
        // the entire point of moving off polling.
        socket.on(RealtimeEvent.NotificationNew, () => {
          if (!mountedRef.current) return;
          setState((prev) => ({ ...prev, unreadCount: prev.unreadCount + 1 }));
        });

        // Server can also send an authoritative count (e.g. after mark-all-read).
        socket.on(RealtimeEvent.NotificationUnread, (payload: { count?: number }) => {
          if (!mountedRef.current) return;
          if (typeof payload?.count === 'number') setUnread(payload.count);
        });

        socket.on('disconnect', () => {
          if (!mountedRef.current) return;
          setState((prev) => ({ ...prev, connected: false }));
        });

        // No realtime process reachable — degrade to SSE instead of going dark.
        socket.on('connect_error', () => {
          if (!mountedRef.current) return;
          socket?.close();
          socket = null;
          connectSse();
        });
      } catch {
        // socket.io-client unavailable for any reason: fall back.
        if (mountedRef.current) connectSse();
      }
    })();

    return () => {
      mountedRef.current = false;
      abort.abort();
      socket?.close();
      eventSource?.close();
      clearTimeout(sseReconnectTimer);
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
