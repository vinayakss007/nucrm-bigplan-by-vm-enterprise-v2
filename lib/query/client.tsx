/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

/**
 * TanStack Query provider + shared client (#1328).
 *
 * Historically every page fetched with raw `fetch()` + `useEffect` + `useState`
 * (0% TanStack Query compliance) and there was no QueryClientProvider mounted at
 * all, so pages could not adopt `useQuery` even if they wanted to. This wires
 * the provider once at the root and exposes a small typed `useApiQuery` helper
 * so pages can migrate incrementally to cached, background-refetching queries.
 */
import { useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type UseQueryOptions,
} from '@tanstack/react-query';

/** Default fetcher — GETs JSON and throws a typed error on non-2xx. */
export class ApiQueryError extends Error {
  status: number;
  info: unknown;
  constructor(message: string, status: number, info: unknown) {
    super(message);
    this.name = 'ApiQueryError';
    this.status = status;
    this.info = info;
  }
}

/**
 * #3408 — a failure is a value, not a status code alone.
 *
 * `withApiRoute` returns `NextResponse.json({...}, {status: 4xx/5xx})` for the
 * errors it maps, but several handlers answer **200** with a failure body —
 * `{ ok: false }`, `{ success: false }`, or `{ error: { code, message } }`.
 * `apiFetcher` used to look only at `res.ok`, so those bodies were handed to
 * the panel as ordinary data and rendered as "no data"/"0 items" — exactly the
 * false-empty state the panel-error guards (#2829/#2872) exist to prevent.
 *
 * The shapes below are the four legacy envelopes the estate still emits. This
 * helper is pure (body, status in; error or null out) so the unit tests can
 * plant all four without a fetch mock. A body with BOTH a success marker and a
 * failure marker is treated as a failure: a handler that says `ok:true` while
 * carrying an `error` is lying, and the UI must not be the last to find out.
 */
export type ApiFailure = {
  /** The legacy shape that was recognised, for tests and telemetry. */
  shape: 'ok-false' | 'success-false' | 'error-object';
  message: string;
  code?: string;
};

export function failureFromBody(body: unknown, status: number): ApiFailure | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;

  const err = record.error;
  if (err && typeof err === 'object' && !Array.isArray(err)) {
    const detail = err as Record<string, unknown>;
    if (typeof detail.message === 'string') {
      return {
        shape: 'error-object',
        message: detail.message,
        ...(typeof detail.code === 'string' ? { code: detail.code } : {}),
      };
    }
  }

  if (record.ok === false) {
    const message = typeof record.error === 'string'
      ? record.error
      : `Request failed (${status})`;
    return { shape: 'ok-false', message };
  }

  if (record.success === false) {
    const message = typeof record.error === 'string'
      ? record.error
      : `Request failed (${status})`;
    return { shape: 'success-false', message };
  }

  // A bare `{ error: "..." }` is deliberately NOT treated as a transport
  // failure: 29 panels read that shape as a body-level refusal and render its
  // text (CSAT closing a survey is the clearest example). Only the explicit
  // boolean failure markers and a structured `{ error: { code, message } }`
  // are unambiguous. Widening this list means auditing those 29 panels first.
  return null;
}

export async function apiFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const info = await res.json().catch(() => ({}));
    throw new ApiQueryError(`Request failed (${res.status})`, res.status, info);
  }
  // A 200 is not proof of success: see failureFromBody above.
  const failure = failureFromBody(body, res.status);
  if (failure) {
    throw new ApiQueryError(failure.message, res.status, body);
  }
  return body as T;
}

/** Sensible defaults: no refetch-on-focus spam, short stale window, 2 retries. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 2,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // One client per browser session; created lazily so it isn't shared across
  // requests on the server.
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Thin wrapper over useQuery that defaults the fetcher to `apiFetcher(url)`.
 * `key` doubles as the URL when it's a single string.
 *
 *   const { data, isLoading, error } = useApiQuery<MyType>(['companies', id], `/api/.../${id}`);
 */
export function useApiQuery<T = unknown>(
  key: readonly unknown[],
  url: string,
  options?: Omit<UseQueryOptions<T, ApiQueryError>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<T, ApiQueryError>({
    queryKey: key,
    queryFn: () => apiFetcher<T>(url),
    ...options,
  });
}
