// @vitest-environment jsdom
/**
 * Regression guard for the /tenant/leaderboards "Something went wrong" crash.
 *
 * The page's SWR fetcher throws an Error OBJECT on a failed response (e.g. the
 * by-design 403 when the tenant lacks the analytics-pro module). The old
 * render inlined that object as a React child ({error}) — React cannot render
 * objects, so ANY API failure took the whole page to the error boundary.
 * These tests pin the contract: failures render a safe human string, never the
 * object, and never throw out of render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockUseSWR = vi.fn();
vi.mock('swr', () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

// jsdom has no ResizeObserver, which recharts' ResponsiveContainer needs.
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub,
    Bar: Stub,
    XAxis: Stub,
    YAxis: Stub,
    CartesianGrid: Stub,
    Tooltip: Stub,
    ResponsiveContainer: Stub,
  };
});

import LeaderboardsPage from '@/app/tenant/leaderboards/leaderboards-client';

function fetchError(status: number): Error & { status: number; info: unknown } {
  const err = new Error('An error occurred while fetching the data.') as Error & {
    status: number;
    info: unknown;
  };
  err.status = status;
  err.info = { error: 'forbidden' };
  return err;
}

describe('leaderboards-client error rendering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a safe message (not the raw Error object) on a 403', () => {
    mockUseSWR.mockReturnValue({ data: undefined, error: fetchError(403), isLoading: false });
    expect(() => render(<LeaderboardsPage />)).not.toThrow();
    expect(
      screen.getByText('Leaderboards require the Analytics Pro module for this workspace.'),
    ).toBeTruthy();
  });

  it('renders a generic message on a non-403 failure', () => {
    mockUseSWR.mockReturnValue({ data: undefined, error: fetchError(500), isLoading: false });
    render(<LeaderboardsPage />);
    expect(screen.getByText('Failed to load leaderboard data. Please try again.')).toBeTruthy();
  });

  it('renders rows on success and no error box', () => {
    mockUseSWR.mockReturnValue({
      data: { data: [{ userId: 'u1', name: 'Ada', value: 7, rank: 1 }] },
      error: undefined,
      isLoading: false,
    });
    render(<LeaderboardsPage />);
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.queryByText(/Failed to load/)).toBeNull();
  });
});
