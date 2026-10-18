// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2829 — the tenant-list half: thirteen pages that read `{ data, isLoading }` from
 * `useApiQuery`, never bound `error`, and printed a sentence about the tenant's data whenever
 * the array came back empty.
 *
 * #2832 merged the sweep and fixed the eight where the cost was highest; this file is the same
 * three-state contract (#2823 established it, #2825 kept it) applied to the pages a sales user
 * and an operator live in:
 *
 *   failed read, nothing cached → `role="alert"`, and NOT the empty sentence;
 *   successful empty read      → the empty sentence, no alert;
 *   successful non-empty read  → the rows, no alert, no sentence.
 *
 * Three things here are not covered by grepping, and are the reason the file exists:
 *
 *   - `settings/webhooks`' per-webhook delivery panel never printed an absence sentence at
 *     all when its read was refused. `loadDeliveries` wrote state only under `if (res.ok)`, so
 *     a failed read left `deliveries[id]` undefined and the panel asked for data that would
 *     never arrive — a frozen spinner, which no sentence-matching screen can see. Pinned, with
 *     the retry.
 *   - the `workflows` read behind `automation`'s pre-built tab renders the shipped catalogue
 *     whether or not the read worked, so a failure silently reports every automation as OFF.
 *     Same accident, different disguise.
 *   - `calls` and `products` distinguish "none logged" from "none MATCH THIS SEARCH", and
 *     warmup/usage each have a second, genuinely-empty reading. Routing those to the banner
 *     would invent an outage on the line that just got fixed, so they are pinned the other way.
 *
 * Fixtures are documentation-only (corp.test, RFC 5737 addresses).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

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

import CallsPage from '@/app/tenant/calls/page';
import DocumentsPage from '@/app/tenant/documents/page';
import ProductsPage from '@/app/tenant/products/page';
import PluginsPage from '@/app/tenant/plugins/page';
import ModulesPage from '@/app/tenant/modules/page';
import ServicesPage from '@/app/tenant/services/page';
import InvoicesPage from '@/app/tenant/settings/billing/invoices/page';
import WebhooksPage from '@/app/tenant/settings/webhooks/page';
import WebhookLogsPage from '@/app/tenant/settings/webhooks/logs/page';
import WarmupPage from '@/app/tenant/settings/email/warmup/page';
import AutomationPage from '@/app/tenant/automation/page';
import SequencesPage from '@/app/tenant/automation/sequences/page';
import UsagePage from '@/app/tenant/settings/usage/page';

/** Each page's read, exactly as the page builds it — a drift here is the test failing for the
 *  right reason: the page started asking for something else. */
const URLS = {
  calls: '/api/tenant/calls?limit=100',
  documents: '/api/tenant/documents?',
  products: '/api/tenant/products?limit=200',
  plugins: '/api/tenant/plugins',
  modules: '/api/tenant/modules',
  services: '/api/tenant/services',
  invoices: '/api/tenant/billing/invoices',
  webhooks: '/api/tenant/webhooks',
  logs: '/api/tenant/webhooks/logs?page=1&limit=20',
  warmup: '/api/tenant/email-warmup',
  workflows: '/api/tenant/automation/workflows',
  automations: '/api/tenant/automations',
  sequences: '/api/tenant/sequences',
  usage: '/api/tenant/analytics/usage',
} as const;

const NOW = new Date('2026-10-18T09:00:00.000Z').toISOString();

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

const WARMUP_CONFIG = {
  id: 'wc-1', isActive: true, dailyLimitStart: 10, dailyLimitCurrent: 40, dailyLimitMax: 200,
  rampUpDays: 21, fromEmail: 'replies@northwind.test', fromName: 'Northwind', startedAt: NOW,
  lastWarmupAt: NOW, totalSent: 320, totalReplied: 41,
};
const usageData = (recentActivity: unknown[]) => ({
  thisMonth: { contacts: 4, deals: 2, tasks: 6, tickets: 1, companies: 3, emails: 9, dealValue: 12_000 },
  lastMonth: { contacts: 2, deals: 1, tasks: 3 },
  totals: { contacts: 40, deals: 12, tasks: 60, tickets: 5, companies: 9, dealValue: 180_000 },
  recentActivity,
});

const CASES: {
  name: string;
  url: keyof typeof URLS;
  /** a page that reads two keys seeds the other one so only the tested read fails */
  extraOk?: Partial<Record<keyof typeof URLS, unknown>>;
  page: () => ReactNode;
  emptyPayload: unknown;
  emptyCopy: RegExp;
  rowsPayload: unknown;
  rowCopy: RegExp;
  /** pages behind a tab need it clicked before the branch renders */
  openTab?: RegExp;
}[] = [
  {
    name: 'Calls',
    url: 'calls',
    page: () => <CallsPage />,
    emptyPayload: { data: [] },
    emptyCopy: /No calls logged yet/,
    rowsPayload: { data: [{ id: 'c1', direction: 'inbound', duration: 240, notes: 'Quarterly review', phoneNumber: '+15550142', createdAt: NOW, firstName: 'Kestrel', lastName: 'Vane', companyName: 'Northwind' }] },
    rowCopy: /Kestrel Vane/,
  },
  {
    name: 'Documents',
    url: 'documents',
    page: () => <DocumentsPage />,
    emptyPayload: { data: { documents: [], folders: [] } },
    emptyCopy: /No documents yet/,
    rowsPayload: { data: { documents: [{ id: 'd1', name: 'Master-services-agreement.pdf', mimeType: 'application/pdf', sizeBytes: 184_320, uploadedBy: 'u1', createdAt: NOW, folderId: null }], folders: [] } },
    rowCopy: /Master-services-agreement\.pdf/,
  },
  {
    name: 'Products',
    url: 'products',
    page: () => <ProductsPage />,
    emptyPayload: { data: [] },
    emptyCopy: /No products yet/,
    rowsPayload: { data: [{ id: 'p1', name: 'Widget Mk II', description: null, sku: 'WGK-2', base_price: '199.00', created_at: NOW, updated_at: NOW }] },
    rowCopy: /Widget Mk II/,
  },
  {
    name: 'Plugins',
    url: 'plugins',
    page: () => <PluginsPage />,
    emptyPayload: { data: [] },
    emptyCopy: /No plugins yet/,
    rowsPayload: { data: [{ id: 'pl1', name: 'Fleet telemetry', baseUrl: 'https://example.test', authType: 'api_key', actions: [], status: 'active', createdAt: NOW }] },
    rowCopy: /Fleet telemetry/,
  },
  {
    name: 'Modules',
    url: 'modules',
    page: () => <ModulesPage />,
    emptyPayload: { data: [] },
    emptyCopy: /No modules in this category/,
    rowsPayload: { data: [{ id: 'm1', name: 'Surveys', description: 'Send and score surveys', icon: 'ClipboardList', category: 'service', features: [], pricing: {}, status: 'active', settings: {}, is_free: true, price_monthly: 0 }] },
    rowCopy: /Surveys/,
  },
  {
    name: 'Services',
    url: 'services',
    page: () => <ServicesPage />,
    emptyPayload: { services: [] },
    emptyCopy: /No services found/,
    rowsPayload: { services: [{ id: 'sv1', name: 'Onboarding package', description: null, category: 'implementation', pricingType: 'fixed', unitPrice: '1200.00', hourlyRate: null, monthlyPrice: null, yearlyPrice: null, isActive: true, contactId: null, companyId: null, durationMinutes: null, createdAt: NOW }] },
    rowCopy: /Onboarding package/,
  },
  {
    name: 'Invoices',
    url: 'invoices',
    page: () => <InvoicesPage />,
    emptyPayload: { data: [] },
    emptyCopy: /No invoices yet/,
    rowsPayload: { data: [{ id: 'inv-1', date: NOW, type: 'subscription_monthly', amount: '49.00', currency: 'USD', status: 'paid', invoiceUrl: null }] },
    rowCopy: /subscription monthly/,
  },
  {
    name: 'Webhooks',
    url: 'webhooks',
    page: () => <WebhooksPage />,
    emptyPayload: { data: [] },
    emptyCopy: /No webhooks/,
    rowsPayload: { data: [{ id: 'wh-1', name: 'Zapier CRM sync', url: 'https://hooks.zapier.test/crm-hook', is_active: true, events: ['deal.updated'], delivered_count: 12, failed_count: 1 }] },
    rowCopy: /Zapier CRM sync/,
  },
  {
    name: 'Webhook logs',
    url: 'logs',
    page: () => <WebhookLogsPage />,
    emptyPayload: { data: [], total: 0 },
    emptyCopy: /No delivery logs/,
    rowsPayload: { data: [{ id: 'wl-1', url: 'https://hooks.northwind.test/crm', status: 'failed', attempt: 3, responseStatus: 500, deliveredAt: null, createdAt: NOW, errorMessage: 'connection reset', eventType: 'deal.updated' }], total: 1 },
    rowCopy: /connection reset/,
  },
  {
    name: 'Warmup',
    url: 'warmup',
    page: () => <WarmupPage />,
    emptyPayload: { config: null, pool: [] },
    emptyCopy: /No warmup configured/,
    rowsPayload: { config: WARMUP_CONFIG, pool: [{ id: 'pp-1', participantEmail: 'pool-member@northwind.test', participantName: 'Kestrel Vane', status: 'active', lastSentAt: null, lastRepliedAt: null, sentCount: 12, replyCount: 3 }] },
    rowCopy: /pool-member@northwind\.test/,
  },
  {
    name: 'Usage',
    url: 'usage',
    page: () => <UsagePage />,
    emptyPayload: { data: null },
    emptyCopy: /No usage data yet/,
    rowsPayload: { data: usageData([{ id: 'ua-1', description: 'Closed the Meridian deal', eventType: 'deal_won', entityType: 'deal', createdAt: NOW }]) },
    rowCopy: /Closed the Meridian deal/,
  },
  {
    name: 'Sequences',
    url: 'sequences',
    page: () => <SequencesPage />,
    emptyPayload: { data: [] },
    emptyCopy: /No sequences yet/,
    rowsPayload: { data: [{ id: 'sq-1', name: 'Weekly nurture', description: null, is_active: true, enroll_count: 4, steps: [{}, {}] }] },
    rowCopy: /Weekly nurture/,
  },
  {
    name: 'Automation (custom tab)',
    url: 'automations',
    extraOk: { workflows: [{ workflow_id: 'welcome-email', enabled: true, run_count: 7, last_run_at: NOW }] },
    page: () => <AutomationPage />,
    openTab: /^Custom \(/,
    emptyPayload: { data: [] },
    emptyCopy: /No custom automations yet/,
    rowsPayload: { data: [{ id: 'au-1', name: 'Deal stage notifier', trigger_type: 'deal.stage_updated', action_type: 'send_notification', is_active: true, run_count: 3 }] },
    rowCopy: /Deal stage notifier/,
  },
];

function seed(caseOf: (typeof CASES)[number], result: QueryResult) {
  registry.byUrl[URLS[caseOf.url]] = result;
  for (const [key, rows] of Object.entries(caseOf.extraOk ?? {})) {
    registry.byUrl[URLS[key as keyof typeof URLS]] = ok({ data: rows });
  }
  mount(caseOf.page());
  if (caseOf.openTab) fireEvent.click(screen.getByRole('button', { name: caseOf.openTab }));
}

describe.each(CASES)('$name panel reports the failure instead of the absence (#2829)', (caseOf) => {
  it('says the read failed when the fetch errors', () => {
    seed(caseOf, failed('Request failed (500)'));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load');
    expect(alert.textContent).toContain('Request failed (500)');
    expect(screen.queryByText(caseOf.emptyCopy)).toBeNull();
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

  it('offers to re-run the read that failed', () => {
    seed(caseOf, failed('Request failed (500)'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('alert').textContent).toContain('Failed to load');
  });
});

describe('a search miss is still an honest sentence, not a failure (#2829)', () => {
  // `calls` and `products` say "none match your search" when rows exist and the filter excludes
  // them. Hoisting the banner above that check would turn a search miss into a fake outage — the
  // opposite defect, same line of code. (#2825's KB rule.)
  const filtered: { name: string; url: keyof typeof URLS; page: () => ReactNode; rows: unknown }[] = [
    {
      name: 'Calls',
      url: 'calls',
      page: () => <CallsPage />,
      rows: [{ id: 'c1', direction: 'inbound', duration: 60, notes: null, phoneNumber: '+15550142', createdAt: NOW, firstName: 'Kestrel', lastName: 'Vane', companyName: null }],
    },
    {
      name: 'Products',
      url: 'products',
      page: () => <ProductsPage />,
      rows: [{ id: 'p1', name: 'Widget Mk II', description: null, sku: 'WGK-2', base_price: '199.00', created_at: NOW, updated_at: NOW }],
    },
  ];

  for (const { name, url, page, rows } of filtered) {
    it(`${name}: no alert and no "none logged" copy when a search filters every row out`, () => {
      registry.byUrl[URLS[url]] = ok({ data: rows });
      mount(page());
      fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zzz-no-such-row' } });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByText(/match your search/)).toBeTruthy();
    });
  }
});

describe('the genuinely-empty readings stay empty (#2829)', () => {
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

  it('webhooks: a deliveries read that answered successfully with nothing still says "No deliveries yet"', async () => {
    registry.byUrl[URLS.webhooks] = ok({ data: [{ id: 'wh-1', name: 'Zapier CRM sync', url: 'https://hooks.zapier.test/crm-hook', is_active: true, events: [], delivered_count: 0, failed_count: 0 }] });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
    mount(<WebhooksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle recent deliveries' }));
    expect(await screen.findByText(/No deliveries yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe("webhooks' delivery read reports its failure instead of spinning forever (#2829)", () => {
  // The other twelve pages fail through `useApiQuery`; this one failed through a bare
  // `if (res.ok)`, which is invisible to any screen that looks for an empty sentence.
  beforeEach(() => {
    registry.byUrl[URLS.webhooks] = ok({ data: [{ id: 'wh-1', name: 'Zapier CRM sync', url: 'https://hooks.zapier.test/crm-hook', is_active: true, events: [], delivered_count: 0, failed_count: 0 }] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the refusal on the panel instead of leaving the spinner up', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Request failed' }) })));
    mount(<WebhooksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle recent deliveries' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Failed to load this webhook's deliveries");
    expect(alert.textContent).toContain('Request failed');
    expect(screen.queryByText(/No deliveries yet/)).toBeNull();
  });

  it('falls back to the status code when the refusal carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 42501, json: async () => ({}) })));
    mount(<WebhooksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle recent deliveries' }));
    expect((await screen.findByRole('alert')).textContent).toContain('HTTP 42501');
  });

  it('re-asks on retry rather than staying failed', async () => {
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

describe('automation: a refused workflows read says so instead of showing every toggle OFF (#2829)', () => {
  // The pre-built tab renders the shipped catalogue whether or not the read worked, so there is
  // no absence sentence for the sweep to match — the failure is silent, and it reads as
  // "nothing is running".
  it('names the failure and the claim it would have made', () => {
    registry.byUrl[URLS.workflows] = failed('Request failed (500)');
    registry.byUrl[URLS.automations] = ok({ data: [] });
    mount(<AutomationPage />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load which automations are running');
    expect(alert.textContent).toContain('Request failed (500)');
    expect(alert.textContent).toContain("the shipped default, not your tenant's");
  });

  it('shows the real ON/OFF state when the read succeeds', () => {
    registry.byUrl[URLS.workflows] = ok({ data: [{ workflow_id: 'welcome-email', enabled: true, run_count: 7, last_run_at: NOW }] });
    registry.byUrl[URLS.automations] = ok({ data: [] });
    mount(<AutomationPage />);
    expect(screen.getByText('ON')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the ratchet decays by exactly the pages this slice fixed (#2829)', () => {
  const ROOT = process.cwd();
  const SCRIPT = 'scripts/check-panel-error-state.mjs';
  const BASELINE = 'scripts/panel-error-state-baseline.json';
  const FIXED = [
    'app/tenant/calls/page.tsx',
    'app/tenant/documents/page.tsx',
    'app/tenant/products/page.tsx',
    'app/tenant/plugins/page.tsx',
    'app/tenant/services/page.tsx',
    'app/tenant/settings/billing/invoices/page.tsx',
    'app/tenant/settings/webhooks/page.tsx',
    'app/tenant/settings/email/warmup/page.tsx',
    'app/tenant/automation/page.tsx',
    'app/tenant/automation/sequences/page.tsx',
  ];

  const doc = () => JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) as {
    files: Record<string, string>;
  };

  it('is green, and none of the ten #2832 listed still hides in the baseline', () => {
    const res = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).not.toContain('no longer offends');
    const files = doc().files;
    for (const file of FIXED) {
      expect(files[file], `${file} was fixed; it must not stay allowlisted`).toBeUndefined();
    }
  });

  it('keeps pages nobody is fixing in the list, so an empty sweep cannot read as success', () => {
    // 54 entries went in to this slice and 44 come out. A number proves nothing about whether
    // the scan still works, so pin concrete findings the next slices have not touched.
    // The bound is a CEILING on purpose: an equality here goes false every time another slice
    // honestly fixes a panel (the in-flight #2836 deletes four more entries), and #2831 shipped
    // exactly that landmine. The named pages below are what prove the sweep still runs.
    const files = doc().files;
    expect(Object.keys(files).length).toBeLessThanOrEqual(44);
    expect(files['app/superadmin/backups/page.tsx'] ?? files['app/superadmin/billing/dunning/page.tsx']).toBeTruthy();
    expect(files['app/tenant/chat/page.tsx']).toBeTruthy();
    expect(files['app/tenant/emails/page.tsx'], 'the documented #1328 tradeoff stays allowlisted').toBeTruthy();
    for (const [file, note] of Object.entries(files)) {
      expect(note, `${file} is allowlisted with no reason attached`).toContain('#2829');
    }
  });

  it('does not push a fixed page over a size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
