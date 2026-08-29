/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { SWRConfig, type SWRConfiguration } from 'swr';

export interface FetchError extends Error {
  status: number;
  info: unknown;
}

export const defaultFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error('An error occurred while fetching the data.') as FetchError;
    const body = await res.json().catch(() => ({}));
    err.status = res.status;
    err.info = body;
    throw err;
  }
  return res.json();
};

export const swrConfig: SWRConfiguration = {
  fetcher: defaultFetcher,
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 5000,
  errorRetryCount: 2,
};

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return <SWRConfig value={swrConfig}>{children}</SWRConfig>;
}
