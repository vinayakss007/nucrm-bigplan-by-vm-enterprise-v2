// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829 (second slice) — the six CRM list pages a sales user lives on must not answer
 * "you have none" when the read failed, and the ratchet #2831 shipped has to decay by
 * exactly the pages this slice fixed.
 *
 * Same defect, same fix, six more pages: each read `{ data, isLoading }` from
 * `useApiQuery`, never bound the failure, and rendered a sentence about the tenant's data
 * when the array came back empty. For these pages the masked failure is a working-day
 * problem, not cosmetics: "No calls logged yet" hides the activity log a rep is judged on,
 * "No documents yet" reads as an empty library next to an upload drop zone, "No products
 * yet. Add your first product!" invites a duplicate SKU, "No plugins yet" hides the
 * integration that was firing this morning, "No modules in this category" reads as
 * nothing-installed, and "No services found. Create your first service!" is the same
 * invitation on the page that meters billable work.
 *
 * The cases assert the distinction, not the wording — failed → `role="alert"` and no
 * absence copy; succeeded-and-empty → the absence copy and no alert; rows → the row and no
 * alert. Two pages have an extra state this test pins because it is easy to break: `calls`
 * and `products` distinguish "none logged" from "none MATCH THIS SEARCH", so a search miss
 * must still be the honest sentence, not an error banner.
 *
 * Deliberately NOT in this slice, and why is recorded here so the next author does not
 * "finish" it by accident:
 *   - `app/tenant/emails/page.tsx` — `:37-39` documents a decision taken under #1328: the
 *     tracking endpoint may 404 on older deploys, so any error is treated as an empty list
 *     with retry disabled. That is a tradeoff, not an oversight; unwinding it belongs to
 *     whoever owns that route.
 *   - every `app/superadmin/**` page — left to one author, because `announcements`,
 *     `rate-limits` and `usage` are the unpushed local slice's (`fix/panel-error-state-slice-2829`).
 *   - `app/tenant/services/page.tsx` grows by zero lines. It sits exactly at the 599 lines
 *     recorded in `scripts/file-size-baseline.json`, and the guard only fails a grandfathered
 *     file when it goes OVER that number — so the fix collapses its three-line empty block
 *     onto one line rather than spending the slack; `guard:filesize` is asserted below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import CallsPage from '@/app/tenant/calls/page';
import DocumentsPage from '@/app/tenant/documents/page';
import ProductsPage from '@/app/tenant/products/page';
import PluginsPage from '@/app/tenant/plugins/page';
import ModulesPage from '@/app/tenant/modules/page';
import ServicesPage from '@/app/tenant/services/page';

/** The URLs each page asks for, exactly as the page builds them — a drift here is the test
 *  failing for the right reason: the page started asking for something else. */
const URLS = {
  calls: '/api/tenant/calls?limit=100',
  documents: '/api/tenant/documents?',
  products: '/api/tenant/products?limit=200',
  plugins: '/api/tenant/plugins',
  modules: '/api/tenant/modules',
  services: '/api/tenant/services',
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

beforeEach(() => {
  registry.byUrl = {};
});

const CASES: {
  name: string;
  url: keyof typeof URLS;
  page: () => ReactNode;
  /** what the page says when a successful read returned nothing */
  emptyCopy: RegExp;
  /** payload for a successful read that has rows, and text one of them renders */
  row: Record<string, unknown>;
  /** the envelope key the page reads its list out of */
  key: 'data' | 'documents' | 'services';
  rowCopy: RegExp;
}[] = [
  {
    name: 'Calls',
    url: 'calls',
    page: () => <CallsPage />,
    emptyCopy: /No calls logged yet/,
    key: 'data',
    row: { id: 'c1', direction: 'inbound', duration: 240, notes: 'Quarterly review', phoneNumber: '+15550142', createdAt: new Date().toISOString(), firstName: 'Kestrel', lastName: 'Vane', companyName: 'Northwind' },
    rowCopy: /Kestrel Vane/,
  },
  {
    name: 'Documents',
    url: 'documents',
    page: () => <DocumentsPage />,
    emptyCopy: /No documents yet/,
    key: 'documents',
    row: { id: 'd1', name: 'Master-services-agreement.pdf', mimeType: 'application/pdf', sizeBytes: 184_320, uploadedBy: 'u1', createdAt: new Date().toISOString(), folderId: null },
    rowCopy: /Master-services-agreement\.pdf/,
  },
  {
    name: 'Products',
    url: 'products',
    page: () => <ProductsPage />,
    emptyCopy: /No products yet/,
    key: 'data',
    row: { id: 'p1', name: 'Widget Mk II', description: null, sku: 'WGK-2', base_price: '199.00', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    rowCopy: /Widget Mk II/,
  },
  {
    name: 'Plugins',
    url: 'plugins',
    page: () => <PluginsPage />,
    emptyCopy: /No plugins yet/,
    key: 'data',
    row: { id: 'pl1', name: 'Fleet telemetry', baseUrl: 'https://example.test', authType: 'api_key', actions: [], status: 'active', createdAt: new Date().toISOString() },
    rowCopy: /Fleet telemetry/,
  },
  {
    name: 'Modules',
    url: 'modules',
    page: () => <ModulesPage />,
    emptyCopy: /No modules in this category/,
    key: 'data',
    row: { id: 'm1', name: 'Surveys', description: 'Send and score surveys', icon: 'ClipboardList', category: 'service', features: [], pricing: {}, status: 'active', settings: {}, is_free: true, price_monthly: 0 },
    rowCopy: /Surveys/,
  },
  {
    name: 'Services',
    url: 'services',
    page: () => <ServicesPage />,
    emptyCopy: /No services found/,
    key: 'services',
    row: { id: 'sv1', name: 'Onboarding package', description: null, category: 'implementation', pricingType: 'fixed', unitPrice: '1200.00', hourlyRate: null, monthlyPrice: null, yearlyPrice: null, isActive: true, contactId: null, companyId: null, durationMinutes: null, createdAt: new Date().toISOString() },
    rowCopy: /Onboarding package/,
  },
];

/** The envelope each page unwraps: `{ data: [...] }`, `{ data: { documents, folders } }`,
 *  or `{ services: [...] }`. */
function payload(key: 'data' | 'documents' | 'services', rows: unknown[] | null) {
  const list = rows ?? [];
  if (key === 'documents') return { data: { documents: list, folders: [] } };
  if (key === 'services') return { services: list };
  return { data: list };
}

describe.each(CASES)('$name panel renders the failure instead of the absence (#2829)', ({ url, page, emptyCopy, row, rowCopy, key }) => {
  it('says the read failed when the fetch errors', () => {
    registry.byUrl[URLS[url]] = failed('Request failed (500)');
    mount(page());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load');
    expect(alert.textContent).toContain('Request failed (500)');
    expect(screen.queryByText(emptyCopy)).toBeNull();
  });

  it('spells out that a failure is not an empty list', () => {
    registry.byUrl[URLS[url]] = failed('Request failed (42501)');
    mount(page());
    expect(screen.getByRole('alert').textContent)
      .toContain('An empty list means the endpoint answered successfully with nothing');
  });

  it('still says the sentence when the read succeeded and there are none', () => {
    registry.byUrl[URLS[url]] = ok(payload(key, null));
    mount(page());
    expect(screen.getByText(emptyCopy)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the rows a successful read returns', () => {
    registry.byUrl[URLS[url]] = ok(payload(key, [row]));
    mount(page());
    expect(screen.getByText(rowCopy)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(emptyCopy)).toBeNull();
  });
});

describe('the search miss is still an honest sentence, not a failure (#2829)', () => {
  // `calls` and `products` say "none match your search" when rows exist but the filter
  // excludes them. Routing every empty branch to the banner would have turned a search miss
  // into a fake outage — the opposite defect, same line of code.
  const filtered: { name: string; url: keyof typeof URLS; page: () => ReactNode; key: 'data'; row: Record<string, unknown> }[] = [
    {
      name: 'Calls',
      url: 'calls',
      page: () => <CallsPage />,
      key: 'data',
      row: { id: 'c1', direction: 'inbound', duration: 60, notes: null, phoneNumber: '+15550142', createdAt: new Date().toISOString(), firstName: 'Kestrel', lastName: 'Vane', companyName: null },
    },
    {
      name: 'Products',
      url: 'products',
      page: () => <ProductsPage />,
      key: 'data',
      row: { id: 'p1', name: 'Widget Mk II', description: null, sku: 'WGK-2', base_price: '199.00', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    },
  ];

  for (const { name, url, page, key, row } of filtered) {
    it(`${name}: no alert and no "none logged" copy when a search filters every row out`, () => {
      registry.byUrl[URLS[url]] = ok(payload(key, [row]));
      mount(page());
      const box = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
      fireEvent.change(box, { target: { value: 'zzz-no-such-row' } });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByText(/match your search/)).toBeTruthy();
    });
  }
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
    'app/tenant/modules/page.tsx',
    'app/tenant/services/page.tsx',
  ];

  const doc = () => JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) as {
    count: number; panels: Record<string, { issue: string; sentences: string[] }>;
  };

  it('is green, and none of the six still hides in the baseline', () => {
    const res = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).not.toContain('no longer match the class');
    const d = doc();
    for (const file of FIXED) {
      expect(d.panels[file], `${file} was fixed; it must not stay allowlisted`).toBeUndefined();
    }
  });

  it('keeps a page nobody is fixing in the list, so an empty sweep cannot read as success', () => {
    // 38 entries went in to this slice and 32 come out; the count alone says nothing about
    // whether the scan still works, so pin one concrete finding instead.
    const d = doc();
    expect(d.count).toBe(Object.keys(d.panels).length);
    expect(d.panels['app/superadmin/backups/page.tsx']).toBeDefined();
    expect(d.panels['app/superadmin/backups/page.tsx'].sentences).toContain('No backups yet');
    expect(d.panels['app/tenant/emails/page.tsx'], 'the documented #1328 tradeoff stays allowlisted').toBeDefined();
  });

  it('does not push the file that sits exactly at its size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
