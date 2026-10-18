// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All rights reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2841 — the pages #2829's guard passes because *one* of their reads was fixed.
 *
 * `check-panel-error-state.mjs` asks a page-level question: does this file bind
 * an `error` anywhere, and does it render a failure affordance anywhere. Six
 * pages answer both with the error of one query, while their second, third and
 * fourth reads still turn a refused request into a sentence about the tenant's
 * data. `token-control` is the worst of them: with `/alerts` unread it renders a
 * green checkmark and "No alerts — everything is within budget", and that
 * sentence is not even in the guard's `EMPTY_SENTENCE` suffix list, so nothing
 * about the page is visible to the screen at all.
 *
 * Each site gets the three-way check the #2829 tests use, because any one of the
 * three assertions alone can be satisfied by a page that cheats:
 *   - read fails      → the failure is on screen, the false sentence is not;
 *   - read succeeds,
 *     returns nothing → the sentence is on screen, no alert (the page is still
 *                       allowed to say "there are none" when it knows it);
 *   - read succeeds
 *     with rows       → the rows are on screen and neither message is.
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
    ConfirmWithInput: () => null,
  };
});

import TokenControlPage from '@/app/superadmin/token-control/page';
import TenantsPage from '@/app/superadmin/tenants/page';
import SelectiveRestorePage from '@/app/superadmin/selective-restore/page';
import ServicesPage from '@/app/tenant/services/page';
import CallsPage from '@/app/tenant/calls/page';
import TenantBackupSettingsPage from '@/app/tenant/settings/backup/page';

const BUDGETS_URL = '/api/superadmin/token-control/budgets';
const SPENDERS_URL = '/api/superadmin/token-control/report/top-spenders';
const ALERTS_URL = '/api/superadmin/token-control/alerts?limit=20';
const KEYS_URL = '/api/superadmin/token-control/keys';
const TENANTS_URL = '/api/superadmin/tenants';
const ME_URL = '/api/superadmin/me';
const MODULES_URL = '/api/superadmin/tenants/t1/modules';
const BACKUPS_URL = '/api/superadmin/selective-restore/backups';
const RESTORE_LOGS_URL = '/api/superadmin/selective-restore/logs';
const SERVICES_URL = '/api/tenant/services';
const SERVICE_CONTACTS_URL = '/api/tenant/contacts?limit=500';
const CALLS_URL = '/api/tenant/calls?limit=100';
const CALL_CONTACTS_URL = '/api/tenant/contacts?limit=200';
const BACKUP_CONFIG_URL = '/api/tenant/backup/config';
const BACKUP_HISTORY_URL = '/api/tenant/backup';

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

/** The summary card a label belongs to — its own text, as the operator reads it. */
function card(label: string): string {
  return (screen.getByText(label).closest('.bg-gradient-to-br') as HTMLElement | null)?.textContent ?? '';
}

function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Every alert text on the screen, joined — a page may already show another. */
function alerts(): string {
  return screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
}

const ALL_CLEAR = 'No alerts — everything is within budget';
const budgetRow = {
  id: 'b1', service: 'openai', current_month_cents: 12_500, monthly_budget_cents: 100_000,
  hard_cap_enabled: false, alert_at_50pct: true, alert_at_80pct: true, alert_at_100pct: true,
};
const alertRow = {
  id: 'a1', acknowledged: false, alert_type: 'budget_80_percent',
  target_type: 'platform', service: 'openai', message: '80% of budget used',
  created_at: new Date().toISOString(),
};
const keyRow = {
  id: 'k1', service: 'openai', key_prefix: 'sk-abc', is_primary: true, is_active: true,
  current_month_cents: 4_200, last_used_at: new Date().toISOString(),
};
const tenantRow = {
  id: 't1', name: 'Analytical Co', plan_id: 'p1', plan_name: 'Growth', status: 'active',
  owner_name: 'Ada Operator', owner_email: 'admin@example.test',
  created_at: new Date(Date.now() - 40 * 86_400_000).toISOString(), member_count: 3,
};
const moduleRow = {
  id: 'm1', name: 'Invoicing', category: 'billing', status: 'active',
  planAllowed: true, features: ['invoices'], enabledFeatures: ['invoices'], icon: '🧾',
};
const backupFile = {
  id: 'bk1', file_name: 'tenant-2026-10-01.sql.gz', file_size: 1_200, file_size_formatted: '1.2 KB',
  backup_type: 'full', parse_status: 'completed' as const, total_record_count: 42,
  tenants_included: [], uploaded_at: new Date().toISOString(),
};
const serviceRow = {
  id: 's1', name: 'Managed Hosting', category: 'hosting', price: 4_999, contactId: 'c1',
  companyId: null, isActive: true,
};
const before = () => { registry.byUrl = {}; };

describe('superadmin token control — the four reads (#2841)', () => {
  beforeEach(before);

  it('does not print the green all-clear when the alerts read failed', () => {
    registry.byUrl[ALERTS_URL] = failed('Request failed (500)');
    mount(<TokenControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
    expect(alerts()).toContain('Failed to load usage alerts');
    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
  });

  it('still prints the all-clear when the alerts read succeeded with nothing', () => {
    registry.byUrl[ALERTS_URL] = ok({ alerts: [] });
    mount(<TokenControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
    expect(screen.getByText(ALL_CLEAR)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stops the summary card from reporting zero alerts the page never read', () => {
    registry.byUrl[ALERTS_URL] = failed('Request failed (500)');
    mount(<TokenControlPage />);
    expect(card('Active Alerts')).toContain('—');
    expect(card('Active Alerts')).not.toContain('0 total');
  });

  it('shows an alert row where the budgets tab would otherwise be blank', () => {
    registry.byUrl[BUDGETS_URL] = failed('Request failed (500)');
    mount(<TokenControlPage />);
    expect(alerts()).toContain('Failed to load token budgets');
    expect(card('Total Spent')).toContain('—');
  });

  it('keeps the money cards reporting ₹0 when the budgets read succeeds with none', () => {
    registry.byUrl[BUDGETS_URL] = ok({ budgets: [] });
    mount(<TokenControlPage />);
    expect(card('Total Spent')).toContain('₹0');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the budgets a successful read returns, with no alert', () => {
    registry.byUrl[BUDGETS_URL] = ok({ budgets: [budgetRow] });
    mount(<TokenControlPage />);
    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the key list failed rather than showing an empty table under the headers', () => {
    registry.byUrl[KEYS_URL] = failed('Request failed (500)');
    mount(<TokenControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /API Keys/ }));
    expect(alerts()).toContain('Failed to load API keys');
  });

  it('lists the keys a successful read returns, with no alert', () => {
    registry.byUrl[KEYS_URL] = ok({ keys: [keyRow] });
    mount(<TokenControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /API Keys/ }));
    expect(screen.getByText('sk-abc')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lists the alerts a successful read returns, and drops the all-clear for them', () => {
    registry.byUrl[ALERTS_URL] = ok({ alerts: [alertRow] });
    mount(<TokenControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
    expect(screen.getByText(/80% of budget used/)).toBeTruthy();
    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries the alerts read from its own failure branch', () => {
    const refetch = vi.fn();
    registry.byUrl[ALERTS_URL] = { ...failed('Request failed (500)'), refetch };
    mount(<TokenControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('leaves the read it already answered for — top spenders still 404s (#2823)', () => {
    registry.byUrl[SPENDERS_URL] = failed('404');
    mount(<TokenControlPage />);
    fireEvent.click(screen.getByRole('button', { name: /Top Spenders/ }));
    expect(alerts()).toContain('Failed to load top spenders');
  });
});

describe('superadmin tenant module dialog (#2841)', () => {
  beforeEach(before);

  const openDialog = () => {
    registry.byUrl[TENANTS_URL] = ok({ data: [tenantRow] });
    registry.byUrl[ME_URL] = ok({ data: { userId: 'u1', ownTenantId: 't1' } });
    mount(<TenantsPage />);
    fireEvent.click(screen.getByTitle(/Manage modules for this tenant/));
  };

  it('does not claim "No modules available" when the module read failed', () => {
    registry.byUrl[MODULES_URL] = failed('Request failed (500)');
    openDialog();
    expect(screen.queryByText('No modules available')).toBeNull();
    expect(alerts()).toContain('Failed to read');
  });

  it('does not report the tenant as being on the free plan it could not read', () => {
    registry.byUrl[MODULES_URL] = failed('Request failed (500)');
    openDialog();
    expect(screen.getByText('unknown — read failed')).toBeTruthy();
  });

  it('still says "No modules available" when the read succeeds with none', () => {
    registry.byUrl[MODULES_URL] = ok({ data: [], plan: 'pro' });
    openDialog();
    expect(screen.getByText('No modules available')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the modules and the plan a successful read returns', () => {
    registry.byUrl[MODULES_URL] = ok({ data: [moduleRow], plan: 'pro' });
    openDialog();
    expect(screen.getByText('Invoicing')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('superadmin selective restore — the backup list (#2841)', () => {
  beforeEach(before);

  it('does not say nothing was uploaded when the backup read failed', () => {
    registry.byUrl[BACKUPS_URL] = failed('Request failed (500)');
    mount(<SelectiveRestorePage />);
    expect(screen.queryByText('No backups uploaded yet')).toBeNull();
    expect(alerts()).toContain('Failed to load the backup list');
  });

  it('still says nothing is uploaded when the read succeeds with none', () => {
    registry.byUrl[BACKUPS_URL] = ok({ backups: [] });
    mount(<SelectiveRestorePage />);
    expect(screen.getByText('No backups uploaded yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lists the backups a successful read returns', () => {
    registry.byUrl[BACKUPS_URL] = ok({ backups: [backupFile] });
    registry.byUrl[RESTORE_LOGS_URL] = ok({ logs: [] });
    mount(<SelectiveRestorePage />);
    expect(screen.getByText(/tenant-2026-10-01.sql.gz/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('tenant services — the second and third reads (#2841)', () => {
  beforeEach(before);

  const openContactsTab = () => {
    registry.byUrl[SERVICES_URL] = failed('Request failed (500)');
    mount(<ServicesPage />);
    fireEvent.click(screen.getByRole('button', { name: /Contacts \(\d+\)/ }));
  };

  it('does not blame the contacts tab on the tenant when services could not be read', () => {
    openContactsTab();
    expect(screen.queryByText('No contacts linked to services yet')).toBeNull();
    expect(alerts()).toContain('Failed to load services');
  });

  it('still says nothing is linked when services read successfully with none', () => {
    registry.byUrl[SERVICES_URL] = ok({ services: [] });
    mount(<ServicesPage />);
    fireEvent.click(screen.getByRole('button', { name: /Contacts \(\d+\)/ }));
    expect(screen.getByText('No contacts linked to services yet')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says why the contact picker has no options', () => {
    registry.byUrl[SERVICES_URL] = ok({ services: [serviceRow] });
    registry.byUrl[SERVICE_CONTACTS_URL] = failed('Request failed (500)');
    mount(<ServicesPage />);
    fireEvent.click(screen.getByText('Add Service'));
    expect(screen.getByText(/Contacts could not be loaded/)).toBeTruthy();
  });
});

describe('tenant calls — the contact picker (#2841)', () => {
  beforeEach(before);

  it('tells the operator why there is no contact to log against', () => {
    registry.byUrl[CALLS_URL] = ok({ data: [] });
    registry.byUrl[CALL_CONTACTS_URL] = failed('Request failed (500)');
    mount(<CallsPage />);
    fireEvent.click(screen.getByText('Log Call'));
    expect(alerts()).toContain('The contact list did not load');
  });

  it('offers the contacts a successful read returns, with no alert', () => {
    registry.byUrl[CALLS_URL] = ok({ data: [] });
    registry.byUrl[CALL_CONTACTS_URL] = ok({ data: [{ id: 'c1', firstName: 'Ada', lastName: 'Quill' }] });
    mount(<CallsPage />);
    fireEvent.click(screen.getByText('Log Call'));
    expect(screen.getByRole('option', { name: 'Ada Quill' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('tenant backup settings — the config read (#2841)', () => {
  beforeEach(before);

  it('does not present the form defaults as the workspace saved configuration', () => {
    registry.byUrl[BACKUP_CONFIG_URL] = failed('Request failed (500)');
    registry.byUrl[BACKUP_HISTORY_URL] = ok({ data: [] });
    mount(<TenantBackupSettingsPage />);
    expect(alerts()).toContain('could not be read');
    expect(alerts()).toContain("this form's defaults");
    expect(screen.getByRole('button', { name: /Configuration not read/ }).hasAttribute('disabled')).toBe(true);
  });

  it('saves normally when the configuration read succeeds', () => {
    registry.byUrl[BACKUP_CONFIG_URL] = ok({ data: { bucket: 'nucrm-backups', enabled: true } });
    registry.byUrl[BACKUP_HISTORY_URL] = ok({ data: [] });
    mount(<TenantBackupSettingsPage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save Configuration' }).hasAttribute('disabled')).toBe(false);
  });
});
