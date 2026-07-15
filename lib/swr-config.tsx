'use client';

import { SWRConfig, type SWRConfiguration } from 'swr';

export const defaultFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error('An error occurred while fetching the data.');
    const body = await res.json().catch(() => ({}));
    (err as any).status = res.status;
    (err as any).info = body;
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
