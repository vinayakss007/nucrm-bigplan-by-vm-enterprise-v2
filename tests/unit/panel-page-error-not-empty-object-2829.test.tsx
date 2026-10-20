// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All rights reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2829, second slice — the panels that bind the query result as an object.
 *
 * `check-panel-error-state.mjs`'s first pass recognised only
 * `const { data, isLoading } = useApiQuery(...)`. Eighteen files instead do
 * `const usersQuery = useApiQuery(...)` and read `usersQuery.data`, so the guard
 * counted zero hooks in them and passed them as clean. Six of the eighteen print
 * an empty sentence; two of those (`token-control`, `selective-restore`) already
 * read `.error` and show `role="alert"` — they were fixed under #2823 and the
 * guard simply could not see them. The other four are here:
 *
 *   - `superadmin/users`  → "No users found"          (the operator's own list)
 *   - `superadmin/tenants`→ "No organizations found"  (every customer, gone)
 *   - `superadmin/backups`→ three reads, three claims, including
 *                           "No deleted data in backup / All critical data is
 *                           intact" — the strongest all-clear in the app, made by
 *                           a request that never reached the table.
 *   - `tenant/reports`    → toasts the failure from a `useEffect`, then leaves
 *                           "No data found for this period" on screen forever.
 *
 * Each case asserts the distinction, not the wording: with the read stubbed to
 * fail there is an alert and no empty sentence; with the read succeeding and
 * returning nothing there is the sentence and no alert; with rows neither shows.
 * A page that rendered the alert unconditionally would fail the second case, and
 * a page that never left the branch would fail the first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

/** url → the result the page should see for that read. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ??
    { data: undefined, error: null, isError: false, isLoading: false, isFetching: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/confirm-dialog')>();
  return {
    ...actual,
    confirmThen: (_message: string, fn: () => unknown) => fn(),
    ConfirmDialog: () => null,
  };
});

import UsersPage from '@/app/superadmin/users/page';
import TenantsPage from '@/app/superadmin/tenants/page';
import BackupsPage from '@/app/superadmin/backups/page';
import ReportsPage from '@/app/tenant/reports/page';

const USERS_URL = '/api/superadmin/users';
const TENANTS_URL = '/api/superadmin/tenants';
const ME_URL = '/api/superadmin/me';
const SCHEDULES_URL = '/api/superadmin/backups';
const HISTORY_URL = '/api/superadmin/backups?list=recent';
const CRITICAL_URL = '/api/superadmin/backups?critical=true';
const REPORT_URL = '/api/tenant/reports?type=contacts&days=30';

const ok = (data: unknown): QueryResult => ({
  data, error: null, isError: false, isLoading: false, isFetching: false, refetch: vi.fn(),
});
const failed = (message: string): QueryResult => ({
  data: undefined,
  error: new Error(message),
  isError: true,
  isLoading: false,
  isFetching: false,
  refetch: vi.fn(),
});

function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const userRow = {
  id: 'u1',
  email: 'admin@example.test',
  full_name: 'Ada Operator',
  is_super_admin: true,
  created_at: new Date().toISOString(),
  memberships: [{ tenant_name: 'Analytical Co', plan: 'Growth' }],
};
const tenantRow = {
  id: 't1',
  name: 'Analytical Co',
  plan_id: 'p1',
  plan_name: 'Growth',
  status: 'active',
  owner_name: 'Ada Operator',
  owner_email: 'admin@example.test',
  created_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
  member_count: 3,
};
const scheduleRow = {
  id: 's1',
  schedule_type: 'daily' as const,
  backup_type: 'full' as const,
  retention_days: 7,
  enabled: true,
};

beforeEach(() => {
  registry.byUrl = {};
});

describe('superadmin users table (#2829, object-bound read)', () => {
  it('says the read failed instead of "No users found"', () => {
    registry.byUrl[USERS_URL] = failed('Request failed (500)');
    mount(<UsersPage />);
    expect(screen.getByRole('alert').textContent).toContain('Could not load the user list');
    expect(screen.queryByText('No users found')).toBeNull();
  });

  it('still says "No users found" when the read succeeds with none', () => {
    registry.byUrl[USERS_URL] = ok({ data: [] });
    mount(<UsersPage />);
    expect(screen.getByText('No users found')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the accounts a successful read returns', () => {
    registry.byUrl[USERS_URL] = ok({ data: [userRow] });
    registry.byUrl[ME_URL] = ok({ data: { userId: 'u1' } });
    mount(<UsersPage />);
    expect(screen.getByText('Ada Operator')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No users found')).toBeNull();
  });

  it('retries the failed read', () => {
    const refetch = vi.fn();
    registry.byUrl[USERS_URL] = { ...failed('Request failed (500)'), refetch };
    mount(<UsersPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe('superadmin organizations table (#2829, object-bound read)', () => {
  it('says the read failed instead of "No organizations found"', () => {
    registry.byUrl[TENANTS_URL] = failed('Request failed (500)');
    mount(<TenantsPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load organizations');
    expect(screen.queryByText('No organizations found')).toBeNull();
  });

  it('still says "No organizations found" when the read succeeds with none', () => {
    registry.byUrl[TENANTS_URL] = ok({ data: [] });
    mount(<TenantsPage />);
    expect(screen.getByText('No organizations found')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a successful read of rows showing rows', () => {
    registry.byUrl[TENANTS_URL] = ok({ data: [tenantRow] });
    registry.byUrl[ME_URL] = ok({ data: { userId: 'u1', ownTenantId: 't1' } });
    mount(<TenantsPage />);
    expect(screen.getByText('Analytical Co')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('superadmin backups panel (#2829, three object-bound reads)', () => {
  it('does not claim no schedules are configured when the schedule read failed', () => {
    registry.byUrl[SCHEDULES_URL] = failed('Request failed (500)');
    mount(<BackupsPage />);
    expect(screen.getByRole('alert').textContent).toContain('Could not load the backup schedules');
    expect(screen.queryByText('No backup schedules configured')).toBeNull();
    expect(screen.queryByText('Default monthly backup will run automatically')).toBeNull();
  });

  it('still says no schedules are configured when the read succeeds with none', () => {
    registry.byUrl[SCHEDULES_URL] = ok({ data: [] });
    mount(<BackupsPage />);
    expect(screen.getByText('No backup schedules configured')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not claim a backup ran nothing when the history read failed', () => {
    registry.byUrl[HISTORY_URL] = failed('Request failed (500)');
    mount(<BackupsPage />);
    fireEvent.click(screen.getByRole('button', { name: /backup history/i }));
    expect(screen.getByRole('alert').textContent).toContain('Could not list the recent backups');
    expect(screen.queryByText('No backups yet')).toBeNull();
  });

  it('does not certify critical data intact when the deleted-data read failed', () => {
    registry.byUrl[CRITICAL_URL] = failed('Request failed (500)');
    mount(<BackupsPage />);
    fireEvent.click(screen.getByRole('button', { name: /deleted data/i }));
    expect(screen.getByRole('alert').textContent).toContain('nothing here is evidence');
    expect(screen.queryByText('No deleted data in backup')).toBeNull();
    expect(screen.queryByText('All critical data is intact')).toBeNull();
  });

  it('renders the schedule a successful read returns', () => {
    registry.byUrl[SCHEDULES_URL] = ok({ data: [scheduleRow] });
    mount(<BackupsPage />);
    expect(screen.getByText('Global Backup (All Tenants)')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('tenant reports panel (#2829, toasted failure and a permanent sentence)', () => {
  const run = () => {
    mount(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));
  };

  it('says the report did not run instead of "No data found for this period"', () => {
    registry.byUrl[REPORT_URL] = failed('Request failed (500)');
    run();
    expect(screen.getByRole('alert').textContent).toContain('This report did not run');
    expect(screen.queryByText('No data found for this period')).toBeNull();
  });

  it('still says "No data found for this period" when the report ran and returned none', () => {
    registry.byUrl[REPORT_URL] = ok({ data: [] });
    run();
    expect(screen.getByText('No data found for this period')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the rows of a report that ran while a later refetch fails', () => {
    registry.byUrl[REPORT_URL] = {
      data: { data: [{ name: 'Ada Operator', deals_won: 2 }] },
      error: new Error('Request failed (500)'),
      isError: true,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    };
    run();
    expect(screen.getByText(/Ada Operator/)).toBeTruthy();
    // #2872 pinned this as "no alert at all", which was the other half of the bug: the
    // rows staying is only honest if the page also says they are the last read. The
    // caveat itself belongs to panel-page-error-not-empty-forms-reports-stale-2872.
    expect(screen.queryByText('This report did not run')).toBeNull();
  });
});
