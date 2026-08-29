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

export async function apiFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const info = await res.json().catch(() => ({}));
    throw new ApiQueryError(`Request failed (${res.status})`, res.status, info);
  }
  return res.json() as Promise<T>;
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
