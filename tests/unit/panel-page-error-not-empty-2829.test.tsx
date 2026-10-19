// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2829 — the panel half: eight operational pages read `{ data, isLoading }`
 * from `useApiQuery`, never bind `error`, and print a sentence about the
 * tenant's data whenever the array comes back empty.
 *
 * A screen can be grepped for; only a render test can prove the distinction.
 * Each page here is mounted with `@/lib/query/client` stubbed at its own seam
 * (`useApiQuery(key, url)`), which is what #2823 established for the two
 * super-admin panels it fixed, and each is shown three ways:
 *
 *   failed read, nothing cached → `role="alert"`, and NOT the empty sentence;
 *   successful empty read      → the empty sentence, no alert;
 *   successful non-empty read  → the rows, no alert, no sentence.
 *
 * Three pages carry a fourth case, because the honest answer is not always the
 * alert: trash's filter tabs keep their own sentence (#2825's KB rule — a search
 * miss is not a failed read), usage must keep showing cached rows when a later
 * refetch fails, and rate-limits warns above a form it still renders — the form
 * is the danger, since saving an all-empty read writes emptiness back.
 *
 * Fixtures are documentation-only (`corp.test`, RFC 5737 addresses).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
// jsdom has no ResizeObserver, which recharts' ResponsiveContainer needs.
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub,
    CartesianGrid: Stub, Tooltip: Stub, ResponsiveContainer: Stub,
  };
});

import SessionsPage from '@/app/tenant/settings/sessions/page';
import ApiKeysPage from '@/app/tenant/settings/api-keys/page';
import DlqPage from '@/app/tenant/settings/webhooks/dlq/page';
import TrashPage from '@/app/tenant/trash/page';
import BackupPage from '@/app/tenant/settings/backup/page';
import AnnouncementsPage from '@/app/superadmin/announcements/page';
import RateLimitsPage from '@/app/superadmin/rate-limits/page';
import UsagePage from '@/app/superadmin/usage/page';

const SESSIONS = '/api/user/sessions';
const KEYS = '/api/tenant/api-keys';
const DLQ = '/api/tenant/webhooks/dlq?page=1&limit=20';
const TRASH = '/api/tenant/trash';
const TRASH_DEALS = '/api/tenant/trash?type=deal';
const BACKUP_CONFIG = '/api/tenant/backup/config';
const BACKUPS = '/api/tenant/backup';
const ANNOUNCEMENTS = '/api/superadmin/announcements';
const RATE_LIMITS = '/api/superadmin/rate-limits';
const USAGE = '/api/superadmin/usage';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (): QueryResult => ({
  data: undefined,
  error: new Error('Request failed (500)'),
  isLoading: false,
  refetch: vi.fn(),
});

const sessionRow = {
  id: 'c1', user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0.0.0',
  ip_address: '198.51.100.24', is_current: true, created_at: '2026-02-01T10:00:00.000Z',
};
const keyRow = {
  id: 'k1', name: 'Reporting integration', key_prefix: 'nucrm_abc', scopes: ['leads:read'],
  is_active: true, created_at: '2026-01-04T00:00:00.000Z', last_used_at: null, expires_at: null,
};
const dlqRow = {
  id: 'd1', jobType: 'webhook:deliver', jobId: 'job-4471', queue: 'webhooks',
  payload: { eventId: 'evt-12' }, errorMessage: 'Connection refused',
  attempts: 3, maxAttempts: 5, status: 'failed', createdAt: '2026-02-02T08:00:00.000Z',
};
const trashRow = {
  id: 't1', name: 'Wayne Enterprises', resource_type: 'company', email: null, extra: null,
  deleted_at: '2026-02-01T00:00:00.000Z', days_remaining: 18,
};
const backupRow = {
  id: 'b1', backup_type: 'full', status: 'completed', size_bytes: 2_097_152,
  storage_path: null, storage_type: 'local', duration_ms: 4200, error_message: null,
  initiated_auto: false, created_at: '2026-02-02T01:00:00.000Z', completed_at: '2026-02-02T01:00:04.000Z',
};
const announcementRow = {
  id: 'a1', title: 'Scheduled maintenance window', content: 'Read-only between 01:00 and 02:00.',
  type: 'info', target: 'all', is_active: true, ends_at: null,
};
const planRow = {
  id: 'p1', name: 'Growth', slug: 'growth', rateLimits: { '/api/leads': 120 },
};
const usageTenant = {
  id: 'n1', name: 'Northwind Trading', status: 'active', plan_id: 'pro',
  current_contacts: 812, current_deals: 44, current_users: 9,
  max_contacts: 1000, max_deals: 200, max_users: 20, contact_pct: 81, user_pct: 45,
};

type Mode = 'failed' | 'empty' | 'rows';

/**
 * The reads a page makes, per mode. `failed` and `empty` are uniform: every URL
 * the page consults answers the same way. `rows` carries each page's own shape,
 * because the envelope differs (`{ data: [...] }` for lists, `{ tenantUsage }`
 * for usage, `{ data: { plans } }` for rate limits).
 */
function fill(page: Spec, mode: Mode) {
  const reads = mode === 'empty' ? (page.emptyReads ?? emptyFor(page.rowReads)) : page.rowReads;
  for (const url of Object.keys(page.rowReads)) {
    registry.byUrl[url] =
      mode === 'failed' ? failed() : mode === 'empty' ? ok(reads[url]) : ok(page.rowReads[url]);
  }
}

interface Spec {
  name: string;
  Page: React.ComponentType;
  /** what a successful read with rows looks like, by url */
  rowReads: Record<string, unknown>;
  /** what a successful read with nothing to show looks like; defaults to `{ data: [] }` */
  emptyReads?: Record<string, unknown>;
  /** the sentence the page claims when the read comes back with nothing */
  emptyCopy: RegExp | null;
  /** enough of the alert copy to prove which failure is being reported */
  alertCopy: string;
  /** text that only a rendered row produces */
  rowCopy: string;
}

const emptyFor = (rowReads: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(rowReads).map((u) => [u, { data: [] }]));

const RATE_LIMIT_ROWS = {
  plans: [planRow],
  superAdmins: [],
  endpoints: [{ key: '/api/leads', label: 'Leads search', window: 60, windowLabel: 'per minute' }],
  globalDefaults: { '/api/leads': 120 },
};

const SPECS: Spec[] = [
  {
    name: 'active sessions', Page: SessionsPage,
    rowReads: { [SESSIONS]: { data: [sessionRow] } },
    emptyCopy: /No sessions found/, alertCopy: 'Could not load your active sessions', rowCopy: 'Current',
  },
  {
    name: 'api keys', Page: ApiKeysPage,
    rowReads: { [KEYS]: { data: [keyRow] } },
    emptyCopy: /No API keys yet/, alertCopy: "Could not load this workspace's API keys", rowCopy: 'Reporting integration',
  },
  {
    name: 'dead letter queue', Page: DlqPage,
    rowReads: { [DLQ]: { data: [dlqRow], total: 1 } },
    emptyCopy: /No dead letter entries/, alertCopy: 'Could not load the dead letter queue', rowCopy: 'webhook:deliver',
  },
  {
    name: 'trash', Page: TrashPage,
    rowReads: { [TRASH]: { data: [trashRow] } },
    emptyCopy: /Trash is empty/, alertCopy: 'Could not load the trash', rowCopy: 'Wayne Enterprises',
  },
  {
    name: 'backup history', Page: BackupPage,
    rowReads: {
      [BACKUP_CONFIG]: { data: { tenant_id: 'tenant-corp-test', backup_type: 'full' } },
      [BACKUPS]: { data: [backupRow] },
    },
    emptyCopy: /No backups yet/, alertCopy: 'Could not read this workspace', rowCopy: 'full Backup',
  },
  {
    name: 'announcements', Page: AnnouncementsPage,
    rowReads: { [ANNOUNCEMENTS]: { data: [announcementRow] } },
    emptyCopy: /No announcements yet/, alertCopy: 'Could not load the announcements', rowCopy: 'Scheduled maintenance window',
  },
  {
    // The page-level banner: this form has no emptiness sentence at all, so the
    // honest control here is that the alert appears on a failed read and does not
    // appear on a successful one.
    name: 'rate limits', Page: RateLimitsPage,
    rowReads: { [RATE_LIMITS]: { data: RATE_LIMIT_ROWS } },
    emptyReads: { [RATE_LIMITS]: { data: { plans: [], superAdmins: [], endpoints: [], globalDefaults: {} } } },
    emptyCopy: null, alertCopy: 'Could not load the rate-limit configuration', rowCopy: 'Leads search',
  },
  {
    name: 'tenant usage', Page: UsagePage,
    rowReads: { [USAGE]: { tenantUsage: [usageTenant], growth: [] } },
    emptyReads: { [USAGE]: { tenantUsage: [], growth: [] } },
    emptyCopy: /No tenants found/, alertCopy: 'Could not load tenant usage', rowCopy: 'Northwind Trading',
  },
];

const spec = (name: string) => {
  const found = SPECS.find((s) => s.name === name);
  if (!found) throw new Error(`no spec named "${name}"`);
  return found;
};

function mount(Page: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
}

beforeEach(() => {
  registry.byUrl = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a failed panel read is reported as a failure (#2829)', () => {
  for (const s of SPECS) {
    it(`${s.name}: the alert replaces the empty sentence when the read fails`, () => {
      fill(s, 'failed');
      mount(s.Page);
      // #2841 gave the backup page's *other* read its own failure branch, so one
      // page can now raise two alerts. The assertion is that one of them names
      // this read, not that it is the only failure on screen.
      const alertTexts = screen.getAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
      expect(alertTexts).toContain(s.alertCopy);
      if (s.emptyCopy) {
        expect(screen.queryByText(s.emptyCopy), `${s.name}: still claims the tenant has nothing`).toBeNull();
      }
    });

    it(`${s.name}: a successful empty read gets no failure state`, () => {
      fill(s, 'empty');
      mount(s.Page);
      if (s.emptyCopy) expect(screen.getByText(s.emptyCopy)).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it(`${s.name}: rows on a successful read render, with no alert`, () => {
      fill(s, 'rows');
      mount(s.Page);
      expect(screen.getByText(s.rowCopy)).toBeTruthy();
      if (s.emptyCopy) expect(screen.queryByText(s.emptyCopy)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  }

  it('the alert offers to re-run the request that failed', () => {
    fill(spec('active sessions'), 'failed');
    mount(SessionsPage);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[SESSIONS].refetch).toHaveBeenCalled();
  });

  it('trash: an empty filter tab stays honest while the read is fine', () => {
    // #2825's KB rule. The tab is a question about the rows the page already has,
    // so the sentence belongs even though it is an emptiness claim — it must only
    // be reached when the read itself succeeded.
    registry.byUrl[TRASH] = ok({ data: [trashRow] });
    registry.byUrl[TRASH_DEALS] = ok({ data: [trashRow] });
    mount(TrashPage);
    fireEvent.click(screen.getByRole('button', { name: /^deals/i }));
    expect(screen.getByText(/No deleted deals/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('trash: a failed read does not claim an empty bin even on a filter tab', () => {
    // The `!items.length` half of the guard: the tab's own sentence is honest
    // about rows the page has, and must not be reached when it has none because
    // the read failed.
    registry.byUrl[TRASH] = failed();
    registry.byUrl[TRASH_DEALS] = failed();
    mount(TrashPage);
    fireEvent.click(screen.getByRole('button', { name: /^deals/i }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/Trash is empty/)).toBeNull();
    expect(screen.queryByText(/No deleted deals/)).toBeNull();
  });

  it('usage: cached rows survive a failed refetch', () => {
    registry.byUrl[USAGE] = {
      data: { tenantUsage: [usageTenant], growth: [] },
      error: new Error('Request failed (500)'),
      isLoading: false,
      refetch: vi.fn(),
    };
    mount(UsagePage);
    expect(screen.getByText('Northwind Trading')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rate limits: the warning stays up while the (empty) form still renders', () => {
    // The save control underneath is the point: an all-empty read must not look
    // like the live configuration the operator can write back.
    fill(spec('rate limits'), 'failed');
    mount(RateLimitsPage);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('not the live ones');
    expect(screen.getByText('Rate Limit Configuration')).toBeTruthy();
  });
});
