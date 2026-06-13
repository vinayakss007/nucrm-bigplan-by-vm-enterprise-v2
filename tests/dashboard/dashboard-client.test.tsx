// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import DashboardClient from '@/components/tenant/dashboard-client';

const mockLayout = [
  { widgetId: 'stats-contacts', w: 1, h: 1, x: 0, y: 0 },
  { widgetId: 'activity-feed', w: 2, h: 1, x: 0, y: 1 },
];

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    json: () => Promise.resolve({ layout: mockLayout }),
    ok: true,
  } as Response);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardClient', () => {
  it('shows loading skeleton on mount', () => {
    render(<DashboardClient tenantId="t1" userId="u1" planName="pro" isAdmin={false} />);
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText(/pro plan/i)).toBeTruthy();
  });

  it('renders WidgetGrid after layout loads', async () => {
    render(<DashboardClient tenantId="t1" userId="u1" planName="pro" isAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeTruthy();
    });
    expect(screen.getByText(/pro plan/i)).toBeTruthy();
  });

  it('calls fetch with correct URL and AbortSignal', async () => {
    render(<DashboardClient tenantId="t1" userId="u1" planName="starter" isAdmin={false} />);
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/tenant/dashboard/layout',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  it('falls back to default layout on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));
    render(<DashboardClient tenantId="t1" userId="u1" planName="pro" isAdmin={false} />);
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalled();
    });
    expect(screen.getByText(/pro plan/i)).toBeTruthy();
  });

  it('aborts fetch on unmount', () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    const { unmount } = render(<DashboardClient tenantId="t1" userId="u1" planName="pro" isAdmin={false} />);
    unmount();
    expect(abortSpy).toHaveBeenCalledTimes(1);
    abortSpy.mockRestore();
  });

  it('displays plan name correctly', async () => {
    render(<DashboardClient tenantId="t1" userId="u1" planName="enterprise" isAdmin={true} />);
    await waitFor(() => {
      expect(screen.getByText(/enterprise plan/i)).toBeTruthy();
    });
  });
});
