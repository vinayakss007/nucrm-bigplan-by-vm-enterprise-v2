// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2823 — a super-admin panel must not answer "there is none" when the read failed.
 *
 * `app/superadmin/selective-restore/page.tsx` and
 * `app/superadmin/token-control/page.tsx` both rendered their empty state from
 * `query.data?.X ?? []` and never looked at `query.error`. Both reads 404 today —
 * `app/api/superadmin/selective-restore/` has no `logs/` handler (#2822) and
 * `app/api/superadmin/token-control/` has no `report/` one — so the operator is
 * told, forever, that no restore has ever run and that no tenant has spending.
 *
 * That matters most on the restore panel: the history is the only record of
 * whether a restore ran, on which tenant, and whether it completed. #2539 made
 * the same argument for cron ("a skip is not a success") and fixed it by refusing
 * to let two outcomes share one status; here the two outcomes shared one string.
 *
 * The fix is not new design — `app/tenant/settings/rbac/page.tsx` already
 * distinguishes the three states, with the sentence "An empty list here means the
 * endpoint responded successfully with no rules; this message means it did
 * not." These two panels now do the same.
 *
 * Each case drives the panel through `@/lib/query/client`'s `useApiQuery` — the
 * seam the page actually has — and asserts the *distinction*, not the wording:
 * `role="alert"` present and the empty-state copy absent when the read fails,
 * and the reverse when it succeeds with nothing to show.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

/** url → the result the page should see for that read. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
}));

import SelectiveRestorePage from '@/app/superadmin/selective-restore/page';
import TokenControlPage from '@/app/superadmin/token-control/page';

const LOGS_URL = '/api/superadmin/selective-restore/logs';
const SPENDERS_URL = '/api/superadmin/token-control/report/top-spenders';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message: string): QueryResult => ({
  data: undefined,
  error: new Error(message),
  isLoading: false,
  refetch: vi.fn(),
});

function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  registry.byUrl = {};
});

describe('Selective Restore history panel (#2823)', () => {
  const openPanel = () => {
    mount(<SelectiveRestorePage />);
    fireEvent.click(screen.getByRole('button', { name: /restore history/i }));
  };

  it('says the read failed instead of "No restore operations yet" when the fetch errors', () => {
    registry.byUrl[LOGS_URL] = failed('Request failed (404)');
    openPanel();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load restore history');
    expect(screen.queryByText(/No restore operations yet/)).toBeNull();
  });

  it('still says "No restore operations yet" when the read succeeds and there are none', () => {
    registry.byUrl[LOGS_URL] = ok({ logs: [] });
    openPanel();
    expect(screen.getByText(/No restore operations yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the rows a successful read returns', () => {
    registry.byUrl[LOGS_URL] = ok({
      logs: [{
        id: 'r1',
        target_tenant_id: '11111111-1111-1111-1111-111111111111',
        tenant_name: 'Analytical Co',
        status: 'completed',
        restore_mode: 'upsert',
        tables_selected: ['contacts'],
        duration_ms: 1500,
        started_at: new Date(Date.now() - 60_000).toISOString(),
      }],
    });
    openPanel();
    expect(screen.getByText('Analytical Co')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/No restore operations yet/)).toBeNull();
  });

  it('keeps rows on screen when a later refetch fails (stale data beats an alert)', () => {
    registry.byUrl[LOGS_URL] = {
      data: { logs: [{ id: 'r1', tenant_name: 'Analytical Co', status: 'completed', started_at: new Date().toISOString() }] },
      error: new Error('Request failed (500)'),
      isLoading: false,
      refetch: vi.fn(),
    };
    openPanel();
    expect(screen.getByText('Analytical Co')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('Token Control top-spenders tab (#2823)', () => {
  const openTab = () => {
    mount(<TokenControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /top spenders/i }));
  };

  it('says the read failed instead of "No spending data yet" when the fetch errors', () => {
    registry.byUrl[SPENDERS_URL] = failed('Request failed (404)');
    openTab();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load top spenders');
    expect(screen.queryByText(/No spending data yet/)).toBeNull();
  });

  it('still says "No spending data yet" when the read succeeds and there are none', () => {
    registry.byUrl[SPENDERS_URL] = ok({ tenants: [] });
    openTab();
    expect(screen.getByText(/No spending data yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the tenants a successful read returns', () => {
    registry.byUrl[SPENDERS_URL] = ok({
      tenants: [{ tenant_id: 't1', tenant_name: 'Analytical Co', openai_cents: 1200, total_cents: 1500, pct_of_total: 60 }],
    });
    openTab();
    expect(screen.getByText('Analytical Co')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
