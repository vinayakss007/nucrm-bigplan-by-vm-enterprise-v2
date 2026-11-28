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

export async function apiFetcher<T = unknown>(url: string, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, headers ? { headers } : undefined);
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
 * #3408 PR-5C — one state discriminator for every query-backed panel.
 *
 * Before this, each panel re-derived "failed" vs "stale" from `error` and
 * `data` by hand, and the common mistake was `Boolean(error) || !data` — which
 * renders a failed read as an empty list. The four states are exhaustive and
 * mutually exclusive:
 *
 *   loading — no data, no error (the first load is still in flight)
 *   ok      — data, no error
 *   stale   — data AND error (a background refetch failed; keep showing data)
 *   failed  — no data AND error (nothing to show; render a failure, not empty)
 *
 * Pure and structural so it can be tested without mounting React.
 */
export type ApiQueryState = 'loading' | 'ok' | 'stale' | 'failed';

export function apiQueryState(result: {
  data: unknown;
  error: unknown;
}): ApiQueryState {
  const hasData = result.data !== undefined && result.data !== null;
  const hasError = Boolean(result.error);
  if (hasError) return hasData ? 'stale' : 'failed';
  return hasData ? 'ok' : 'loading';
}

/**
 * Thin wrapper over useQuery that defaults the fetcher to `apiFetcher(url)`.
 * `key` doubles as the URL when it's a single string.
 *
 *   const { data, state } = useApiQuery<MyType>(['companies', id], `/api/.../${id}`);
 *   if (state === 'failed') return <Failure />;
 *
 * The extra `state` field is additive: existing callers destructuring
 * `data`/`isLoading`/`error` keep working unchanged.
 */
export function useApiQuery<T = unknown>(
  key: readonly unknown[],
  url: string,
  options?: Omit<UseQueryOptions<T, ApiQueryError>, 'queryKey' | 'queryFn'>,
  headers?: Record<string, string>,
) {
  const query = useQuery<T, ApiQueryError>({
    queryKey: key,
    queryFn: () => apiFetcher<T>(url, headers),
    ...options,
  });
  return { ...query, state: apiQueryState(query) };
}
