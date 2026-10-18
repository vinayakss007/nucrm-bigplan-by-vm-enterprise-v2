// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829 (third slice) — the seven tenant panels whose masked failure reads as an
 * operational all-clear, and the ratchet decay that proves the sweep still works.
 *
 * #2831 fixed the five panels that answer "is the business safe?" and #2833 fixed the six
 * CRM lists a sales user lives on. These seven answer "what is the platform actually doing
 * for me?":
 *
 *   - `settings/billing/invoices` — "No invoices yet" on a failed billing read says nothing
 *     is owed.
 *   - `settings/webhooks` — "No webhooks" hides the endpoints a tenant configured, and its
 *     per-webhook delivery panel had a worse variant: `loadDeliveries` only wrote state on
 *     `res.ok`, so a refused read left `deliveries[id]` undefined and the panel sat on its
 *     spinner forever. Neither sentence leaves the class unless both branches are fixed,
 *     because the sweep flags the file on either.
 *   - `settings/webhooks/logs` — "No delivery logs" is what an operator reads while the
 *     endpoint is failing.
 *   - `settings/email/warmup` — the pool card lives inside `config ? …`, so a 500 renders
 *     "No warmup configured": the read an operator needs before trusting outbound volume.
 *   - `automation` — "No custom automations yet" on the `automations` read; and the
 *     `workflows` read next to it, which the sentence sweep cannot see because the prebuilt
 *     tab always renders the shipped catalogue, so a failure silently shows every toggle as
 *     OFF. Pinned here anyway — it is the same defect with a different disguise.
 *   - `automation/sequences` — "No sequences yet".
 *   - `settings/usage` — one branch covers both "No usage data yet" and "No recent activity".
 *
 * The cases assert the distinction, not the wording: failed → `role="alert"` with the
 * message and no absence copy; succeeded-and-empty → the absence copy and no alert; rows →
 * the row and no alert. Where a page has a second, honest empty state (warmup with a config
 * but no pool, usage with totals but no activity) that is pinned too, because collapsing it
 * into the banner would be the opposite defect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
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

import InvoicesPage from '@/app/tenant/settings/billing/invoices/page';
import WebhooksPage from '@/app/tenant/settings/webhooks/page';
import WebhookLogsPage from '@/app/tenant/settings/webhooks/logs/page';
import WarmupPage from '@/app/tenant/settings/email/warmup/page';
import AutomationPage from '@/app/tenant/automation/page';
import SequencesPage from '@/app/tenant/automation/sequences/page';
import UsagePage from '@/app/tenant/settings/usage/page';

/** The URLs each page asks for, exactly as the page builds them — a drift here is the test
 *  failing for the right reason: the page started asking for something else. */
const URLS = {
  invoices: '/api/tenant/billing/invoices',
  webhooks: '/api/tenant/webhooks',
  logs: '/api/tenant/webhooks/logs?page=1&limit=20',
  warmup: '/api/tenant/email-warmup',
  workflows: '/api/tenant/automation/workflows',
  automations: '/api/tenant/automations',
  sequences: '/api/tenant/sequences',
  usage: '/api/tenant/analytics/usage',
} as const;

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

const NOW = new Date('2026-10-18T09:00:00.000Z').toISOString();

const INVOICE = { id: 'inv-1', date: NOW, type: 'subscription_monthly', amount: '49.00', currency: 'USD', status: 'paid', invoiceUrl: null };
const SEQUENCE = { id: 'sq-1', name: 'Weekly nurture', description: null, is_active: true, enroll_count: 4, steps: [{}, {}] };
const LOG = { id: 'wl-1', url: 'https://hooks.northwind.test/crm', status: 'failed', attempt: 3, responseStatus: 500, deliveredAt: null, createdAt: NOW, errorMessage: 'connection reset', eventType: 'deal.updated' };
const WARMUP_CONFIG = {
  id: 'wc-1', isActive: true, dailyLimitStart: 10, dailyLimitCurrent: 40, dailyLimitMax: 200,
  rampUpDays: 21, fromEmail: 'replies@northwind.test', fromName: 'Northwind', startedAt: NOW,
  lastWarmupAt: NOW, totalSent: 320, totalReplied: 41,
};
const PARTICIPANT = { id: 'pp-1', participantEmail: 'pool-member@northwind.test', participantName: 'Kestrel Vane', status: 'active', lastSentAt: null, lastRepliedAt: null, sentCount: 12, replyCount: 3 };
const ACTIVITY = { id: 'ua-1', description: 'Closed the Meridian deal', eventType: 'deal_won', entityType: 'deal', createdAt: NOW };
const usageData = (recentActivity: unknown[]) => ({
  thisMonth: { contacts: 4, deals: 2, tasks: 6, tickets: 1, companies: 3, emails: 9, dealValue: 12_000 },
  lastMonth: { contacts: 2, deals: 1, tasks: 3 },
  totals: { contacts: 40, deals: 12, tasks: 60, tickets: 5, companies: 9, dealValue: 180_000 },
  recentActivity,
});
const WORKFLOW_ROW = { workflow_id: 'welcome-email', enabled: true, run_count: 7, last_run_at: NOW };
const AUTOMATION = { id: 'au-1', name: 'Deal stage notifier', trigger_type: 'deal.stage_updated', action_type: 'send_notification', is_active: true, run_count: 3 };
const WEBHOOK = { id: 'wh-1', name: 'Zapier CRM sync', url: 'https://hooks.zapier.test/crm-hook', is_active: true, events: ['deal.updated'], delivered_count: 12, failed_count: 1 };

const CASES: {
  name: string;
  url: keyof typeof URLS;
  extraOk?: Partial<Record<keyof typeof URLS, unknown>>;
  page: () => ReactNode;
  emptyPayload: unknown;
  emptyCopy: RegExp;
  rowsPayload: unknown;
  rowCopy: RegExp;
}[] = [
  {
    name: 'Invoices',
    url: 'invoices',
    page: () => <InvoicesPage />,
    emptyPayload: { data: [] },
    emptyCopy: /No invoices yet/,
    rowsPayload: { data: [INVOICE] },
    rowCopy: /subscription monthly/,
  },
  {
    name: 'Sequences',
    url: 'sequences',
    page: () => <SequencesPage />,
    emptyPayload: { data: [] },
    emptyCopy: /No sequences yet/,
    rowsPayload: { data: [SEQUENCE] },
    rowCopy: /Weekly nurture/,
  },
  {
    name: 'Webhook logs',
    url: 'logs',
    page: () => <WebhookLogsPage />,
    emptyPayload: { data: [], total: 0 },
    emptyCopy: /No delivery logs/,
    rowsPayload: { data: [LOG], total: 1 },
    rowCopy: /connection reset/,
  },
  {
    name: 'Warmup',
    url: 'warmup',
    page: () => <WarmupPage />,
    emptyPayload: { config: null, pool: [] },
    emptyCopy: /No warmup configured/,
    rowsPayload: { config: WARMUP_CONFIG, pool: [PARTICIPANT] },
    rowCopy: /pool-member@northwind\.test/,
  },
  {
    name: 'Usage',
    url: 'usage',
    page: () => <UsagePage />,
    emptyPayload: { data: null },
    emptyCopy: /No usage data yet/,
    rowsPayload: { data: usageData([ACTIVITY]) },
    rowCopy: /Closed the Meridian deal/,
  },
  {
    name: 'Webhooks',
    url: 'webhooks',
    page: () => <WebhooksPage />,
    emptyPayload: { data: [] },
    emptyCopy: /No webhooks/,
    rowsPayload: { data: [WEBHOOK] },
    rowCopy: /Zapier CRM sync/,
  },
  {
    name: 'Automation (custom tab)',
    url: 'automations',
    extraOk: { workflows: [WORKFLOW_ROW] },
    page: () => <AutomationPage />,
    emptyPayload: { data: [] },
    emptyCopy: /No custom automations yet/,
    rowsPayload: { data: [AUTOMATION] },
    rowCopy: /Deal stage notifier/,
  },
];

/** Three of the pages above need the tab clicked or a second key seeded; this keeps the
 *  shared body honest by doing that inside each case rather than in a helper nobody reads. */
function seed(caseOf: (typeof CASES)[number], result: QueryResult) {
  registry.byUrl[URLS[caseOf.url]] = result;
  for (const [key, rows] of Object.entries(caseOf.extraOk ?? {})) {
    registry.byUrl[URLS[key as keyof typeof URLS]] = ok({ data: rows });
  }
  mount(caseOf.page());
  if (caseOf.url === 'automations') {
    fireEvent.click(screen.getByRole('button', { name: /^Custom \(/ }));
  }
}

describe.each(CASES)('$name panel renders the failure instead of the absence (#2829)', (caseOf) => {
  it('says the read failed when the fetch errors', () => {
    seed(caseOf, failed('Request failed (500)'));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load');
    expect(alert.textContent).toContain('Request failed (500)');
    expect(screen.queryByText(caseOf.emptyCopy)).toBeNull();
  });

  it('spells out that a failure is not an empty list', () => {
    seed(caseOf, failed('Request failed (42501)'));
    expect(screen.getByRole('alert').textContent)
      .toContain('An empty list means the endpoint answered successfully with nothing');
  });

  it('still says the sentence when the read succeeded and there are none', () => {
    seed(caseOf, ok(caseOf.emptyPayload));
    expect(screen.getByText(caseOf.emptyCopy)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the rows a successful read returns', () => {
    seed(caseOf, ok(caseOf.rowsPayload));
    expect(screen.getByText(caseOf.rowCopy)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(caseOf.emptyCopy)).toBeNull();
  });
});

describe('the honest empty states stay empty (#2829)', () => {
  // Each of these has a second, genuinely-empty reading. Routing it to the banner would
  // invent an outage on the same line that just got fixed.
  it('warmup: a config with nobody in the pool says "No pool participants configured", not "failed"', () => {
    registry.byUrl[URLS.warmup] = ok({ config: WARMUP_CONFIG, pool: [] });
    mount(<WarmupPage />);
    expect(screen.getByText(/No pool participants configured/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('usage: totals with no recent activity says "No recent activity", not "failed"', () => {
    registry.byUrl[URLS.usage] = ok({ data: usageData([]) });
    mount(<UsagePage />);
    expect(screen.getByText(/No recent activity/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('webhooks: a delivery read that answered successfully with nothing still says "No deliveries yet"', async () => {
    registry.byUrl[URLS.webhooks] = ok({ data: [WEBHOOK] });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
    mount(<WebhooksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle recent deliveries' }));
    expect(await screen.findByText(/No deliveries yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe("webhooks' delivery read renders its failure instead of a spinner (#2829)", () => {
  // The other six pages in this slice fail through `useApiQuery`; this one used to fail
  // through a bare `if (res.ok)` that left the panel asking for data that will never arrive.
  beforeEach(() => {
    registry.byUrl[URLS.webhooks] = ok({ data: [WEBHOOK] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the HTTP failure and a retry once the panel is expanded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Request failed' }) })));
    mount(<WebhooksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle recent deliveries' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Failed to load this webhook's deliveries");
    expect(alert.textContent).toContain('Request failed');
    expect(screen.queryByText(/No deliveries yet/)).toBeNull();
  });

  it('says the sentence a refusal is not an empty delivery log', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 42501, json: async () => ({}) })));
    mount(<WebhooksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle recent deliveries' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('HTTP 42501');
    expect(alert.textContent)
      .toContain('An empty list means the endpoint answered successfully with nothing');
  });

  it('re-asks after a retry instead of staying failed', async () => {
    const responses = [
      { ok: false, status: 500, json: async () => ({ error: 'Request failed' }) },
      { ok: true, status: 200, json: async () => ({ data: [{ id: 'del-1', event: 'deal.updated', status: 'delivered', response_code: 200, created_at: NOW }] }) },
    ];
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => responses[Math.min(call++, 1)]));
    mount(<WebhooksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle recent deliveries' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/deal\.updated/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('automation: a failed workflows read says so instead of showing every toggle OFF (#2829)', () => {
  // The sweep cannot see this one — the prebuilt tab renders the shipped catalogue whether or
  // not the read worked, so there is no absence sentence to match. It is the same defect.
  it('names the failure and the lie it would have told', () => {
    registry.byUrl[URLS.workflows] = failed('Request failed (500)');
    registry.byUrl[URLS.automations] = ok({ data: [] });
    mount(<AutomationPage />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load which automations are running');
    expect(alert.textContent).toContain('Request failed (500)');
    expect(alert.textContent).toContain("the shipped default, not your tenant's");
  });

  it('renders the prebuilt roster with its real ON/OFF state when the read succeeds', () => {
    registry.byUrl[URLS.workflows] = ok({ data: [WORKFLOW_ROW] });
    registry.byUrl[URLS.automations] = ok({ data: [] });
    mount(<AutomationPage />);
    // The row badge, not the tab count: this is the state a failed read silently fakes.
    expect(screen.getByText('ON')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the ratchet decays by exactly the pages this slice fixed (#2829)', () => {
  const ROOT = process.cwd();
  const SCRIPT = 'scripts/check-panel-error-state.mjs';
  const BASELINE = 'scripts/panel-error-state-baseline.json';
  const FIXED = [
    'app/tenant/settings/billing/invoices/page.tsx',
    'app/tenant/settings/webhooks/page.tsx',
    'app/tenant/settings/webhooks/logs/page.tsx',
    'app/tenant/settings/email/warmup/page.tsx',
    'app/tenant/automation/page.tsx',
    'app/tenant/automation/sequences/page.tsx',
    'app/tenant/settings/usage/page.tsx',
  ];

  const doc = () => JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) as {
    count: number; panels: Record<string, { issue: string; sentences: string[] }>;
  };

  it('is green, and none of the seven still hides in the baseline', () => {
    const res = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).not.toContain('no longer match the class');
    const d = doc();
    for (const file of FIXED) {
      expect(d.panels[file], `${file} was fixed; it must not stay allowlisted`).toBeUndefined();
    }
  });

  it('keeps pages nobody is fixing in the list, so an empty sweep cannot read as success', () => {
    // 32 entries went in to this slice and 25 come out. A number proves nothing about whether
    // the scan still works, so pin concrete findings the next slices have not touched.
    const d = doc();
    expect(d.count).toBe(Object.keys(d.panels).length);
    expect(d.count).toBeLessThan(32);
    expect(d.panels['app/superadmin/backups/page.tsx'].sentences).toContain('No backups yet');
    expect(d.panels['app/tenant/chat/page.tsx']).toBeDefined();
    expect(d.panels['app/tenant/emails/page.tsx'], 'the documented #1328 tradeoff stays allowlisted').toBeDefined();
    for (const [, entry] of Object.entries(d.panels)) {
      expect(entry.sentences.length).toBeGreaterThan(0);
      expect(entry.issue).toMatch(/^#\d+$/);
    }
  });

  it('corrects the floor the first slice left behind', () => {
    // #2831 asserted `count > 31` to prove the sweep was still matching panels. That is a
    // decay landmine: every honest fix lowers the count, so the assertion goes false the
    // first time the ratchet does its job — which is this slice, at 25. The pinned findings
    // above are what actually prove the scan works.
    const sliceOne = readFileSync(join(ROOT, 'tests/unit/panel-error-state-first-pass-2829.test.tsx'), 'utf8');
    expect(sliceOne).not.toMatch(/^\s*expect\(doc\.count\)\.toBeGreaterThan\(31\);/m);
    const res = spawnSync('npx', ['vitest', 'run', 'tests/unit/panel-error-state-first-pass-2829.test.tsx'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('does not push any of the seven over a size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
