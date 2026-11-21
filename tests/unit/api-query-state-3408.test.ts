/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3408 PR-5C — one state discriminator for query-backed panels.
 *
 * The false-empty bug was a panel deriving "failed" from `error` while ignoring
 * that `data` was absent, so a failed read rendered as "0 items". These tests
 * pin the four exhaustive states and, crucially, that an empty collection is
 * still DATA (state 'ok'), not 'loading' and not 'failed'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: mocks.useQuery,
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: ReactNode }) => children,
}));

import { apiQueryState, useApiQuery } from '@/lib/query/client';

beforeEach(() => mocks.useQuery.mockReset());

describe('#3408 apiQueryState is exhaustive and mutually exclusive', () => {
  it('no data, no error → loading', () => {
    expect(apiQueryState({ data: undefined, error: null })).toBe('loading');
  });

  it('data, no error → ok', () => {
    expect(apiQueryState({ data: { id: '1' }, error: null })).toBe('ok');
  });

  it('data and error → stale (keep showing the last good data)', () => {
    expect(apiQueryState({ data: { id: '1' }, error: new Error('refetch failed') })).toBe('stale');
  });

  it('no data and error → failed (render failure, never empty)', () => {
    expect(apiQueryState({ data: undefined, error: new Error('500') })).toBe('failed');
  });

  it('an empty collection is still data, not a failure or a loading state', () => {
    expect(apiQueryState({ data: [], error: null })).toBe('ok');
    expect(apiQueryState({ data: {}, error: null })).toBe('ok');
  });

  it('null data with an error is a failure, not stale', () => {
    expect(apiQueryState({ data: null, error: new Error('500') })).toBe('failed');
  });
});

describe('#3408 useApiQuery exposes the state', () => {
  it('attaches state to the TanStack result without replacing it', () => {
    const query = { data: [], error: null, isPending: false, isFetching: false };
    mocks.useQuery.mockReturnValue(query);
    const result = useApiQuery(['deals'], '/api/tenant/deals');
    expect(result.state).toBe('ok');
    expect(result.data).toBe(query.data);
    expect(result.isPending).toBe(false);
  });

  it('a refused read with no cached data is failed', () => {
    mocks.useQuery.mockReturnValue({ data: undefined, error: new Error('boom'), isPending: false });
    expect(useApiQuery(['x'], '/api/x').state).toBe('failed');
  });

  it('a refused refetch with cached data is stale', () => {
    mocks.useQuery.mockReturnValue({ data: [{ id: '1' }], error: new Error('boom'), isPending: false });
    expect(useApiQuery(['x'], '/api/x').state).toBe('stale');
  });
});
