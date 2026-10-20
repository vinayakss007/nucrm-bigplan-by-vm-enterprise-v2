// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829, next slice — the twelve `app/tenant/settings/*` panels that answered a refused read
 * with a claim about the tenant's own configuration.
 *
 * The list slices (#2823, #2825, #2832, #2837, #2839) had one excuse available: a list that
 * failed to load printed "No invoices found", which is wrong but inert. A settings panel that
 * fails to load is worse, because its form has a *default value* and a *Save button*. Measured
 * on this branch before the fix:
 *
 *   - `localization` seeds from `DEFAULTS` — so an unread tenant saw "UTC, USD, weekend
 *     Sat-Sun, no holidays", and the first edit arms Save to write that over their real
 *     timezone, fiscal year and holiday list.
 *   - `portal` seeds from `DEFAULT_CONFIG` (`enabled: false`): the status card shows the portal
 *     switched off, the permissions section and the client roster disappear entirely, and the
 *     tenant is one click from saving their portal off.
 *   - `notifications` renders its full 27-event matrix with every switch OFF when the matrix
 *     read fails — a policy the tenant never set, on the page that decides who gets emailed.
 *   - `security` shows an empty IP whitelist ("No IPs added yet") and a 30-day trash retention
 *     when those reads fail. Both are access-control and data-loss settings.
 *   - `admin` renders the organization card blank with plan "Free" and status "active" off an
 *     unread `/api/tenant/workspace`.
 *   - `csat`, `tax`, `integrations`, `lead-scoring`, `ai-templates`, `custom-fields`,
 *     `tags-manager` print the plain false absence sentence, and `tax` / `ai-templates` /
 *     `custom-fields` also state a *count* (Total Rates, Your templates, Custom Fields) that a
 *     refused read reports as `0`.
 *
 * Per page: failed read → `role="alert"` naming the failure, its own `refetch` behind "Try
 * again", and the absence copy plus the derived numbers gone; succeeded-and-empty → the
 * sentence, no alert; rows → the row, no alert. Three of them get a case of their own for the
 * part a sentence-matching screen provably cannot see: the count that is really a number
 * (`tax`, `ai-templates`, `custom-fields`), and the form that must not render at all when its
 * read failed (`notifications`, `localization`, `portal`, `admin`).
 *
 * `tags-manager` also gets the opposite assertion — a search that matches nothing stays the
 * sentence, not a fake outage — because its filter is client-side, so routing every empty
 * branch to the banner would have traded one lie for another.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  ConfirmDialog: () => null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/settings',
}));

import AdminPage from '@/app/tenant/settings/admin/page';
import AiTemplatesPage from '@/app/tenant/settings/ai-templates/page';
import CsatPage from '@/app/tenant/settings/csat/page';
import CustomFieldsPage from '@/app/tenant/settings/custom-fields/page';
import IntegrationsPage from '@/app/tenant/settings/integrations/page';
import LeadScoringPage from '@/app/tenant/settings/lead-scoring/page';
import LocalizationPage from '@/app/tenant/settings/localization/page';
import NotificationsPage from '@/app/tenant/settings/notifications/page';
import PortalPage from '@/app/tenant/settings/portal/page';
import SecurityPage from '@/app/tenant/settings/security/page';
import TagsManagerPage from '@/app/tenant/settings/tags-manager/page';
import TaxPage from '@/app/tenant/settings/tax/page';

const NOW = new Date().toISOString();

const URLS = {
  workspace: '/api/tenant/workspace',
  members: '/api/tenant/members',
  aiTemplates: '/api/tenant/admin/ai-templates',
  csat: '/api/tenant/csat/stats?days=30',
  fields: '/api/tenant/custom-fields?entityType=contact',
  features: '/api/tenant/custom-fields?action=features',
  integrations: '/api/tenant/integrations',
  leadScoring: '/api/tenant/admin/lead-scoring',
  localization: '/api/tenant/admin/localization',
  me: '/api/tenant/me',
  matrix: '/api/tenant/notifications/matrix',
  portalConfig: '/api/tenant/portal/config',
  portalClients: '/api/tenant/portal/clients',
  trashSettings: '/api/tenant/trash/settings',
  autoCleanup: '/api/tenant/trash/auto-cleanup',
  ipWhitelist: '/api/tenant/security/ip-whitelist',
  tags: '/api/tenant/admin/tags',
  tax: '/api/tenant/tax',
} as const;

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message: string): QueryResult => ({
  data: undefined,
  error: new Error(message),
  isLoading: false,
  refetch: vi.fn(),
});

/** A successful read of a secondary query the page only uses for gating. */
const adminMe = ok({ is_admin: true });

const ORG = {
  tenant: { name: 'Acme Studio', status: 'active', trial_ends_at: null },
  plan: { name: 'Growth', price_monthly: 49, price_yearly: 490, max_users: 5, max_contacts: 1000, max_deals: 500, max_automations: 20 },
  usage: { current_contacts: 12, current_deals: 3 },
};
const CSAT_STATS = {
  overall: { total: 10, responded: 6, responseRate: 60, avgScore: 4.2 },
  distribution: [{ score: 5, count: 4 }, { score: 4, count: 2 }],
  recent: [{
    id: 'f1', score: 5, comment: 'Fixed same day', sentAt: NOW, respondedAt: NOW,
    ticketSubject: 'Laptop will not boot', agentName: 'Ada',
  }],
};
/** Exactly what `/api/tenant/admin/localization` stores — nothing here is a DEFAULTS value. */
const STORED_LOC = {
  timezone: 'Europe/Paris', currency: 'EUR', fiscal_year_start_month: 4, week_start: 'monday',
  weekend_days: ['sunday'],
  business_hours: { enabled: true, start_time: '08:00', end_time: '16:00', working_days: ['monday'] },
  holidays: [{ date: '2026-07-14', name: 'Bastille Day' }],
  number_format: '1 234,56',
};

type Panel = {
  key: string;
  Page: () => ReactNode;
  /** the read this case refuses */
  failUrl: string;
  /** what the banner must say, in order: the class of thing, then why */
  phrase: string;
  /** the sentence the panel prints when the tenant really has none */
  sentence: string;
  /** registry for a successful-but-empty render */
  empty: Record<string, QueryResult>;
  /** registry for a render with one real row */
  row: Record<string, QueryResult>;
  rowText: string;
  /**
   * Some panels only ever state an absence in response to a filter the tenant typed
   * (`notifications` never says "no events" for an empty matrix — every event is listed with
   * its switches). The placeholder is what the case has to type into for the sentence to be
   * the thing under test.
   */
  searchPlaceholder?: string;
};

const PANELS: Panel[] = [
  {
    key: 'admin',
    Page: AdminPage,
    failUrl: URLS.workspace,
    phrase: 'Failed to load your organization',
    sentence: 'No team members yet',
    empty: { [URLS.workspace]: ok(ORG), [URLS.members]: ok({ data: [] }) },
    row: {
      [URLS.workspace]: ok(ORG),
      [URLS.members]: ok({ data: [{ id: 'm1', fullName: 'Ada Lovelace', email: 'ada@acme.test', roleSlug: 'admin' }] }),
    },
    rowText: 'ada@acme.test',
  },
  {
    key: 'ai-templates',
    Page: AiTemplatesPage,
    failUrl: URLS.aiTemplates,
    phrase: 'Failed to load AI templates',
    sentence: 'No saved templates yet',
    empty: { [URLS.aiTemplates]: ok({ templates: [], seeds: [] }) },
    row: {
      [URLS.aiTemplates]: ok({
        templates: [{ id: 't1', slug: 'welcome', name: 'Welcome note', description: null, kind: 'email', tone: null, active: true }],
        seeds: [],
      }),
    },
    rowText: 'Welcome note',
  },
  {
    key: 'csat',
    Page: CsatPage,
    failUrl: URLS.csat,
    phrase: 'Failed to load CSAT stats',
    sentence: 'No CSAT data yet',
    empty: { [URLS.csat]: ok({}) },
    row: { [URLS.csat]: ok({ data: CSAT_STATS }) },
    rowText: 'Laptop will not boot',
  },
  {
    key: 'custom-fields',
    Page: CustomFieldsPage,
    failUrl: URLS.fields,
    phrase: 'Failed to load custom fields',
    sentence: 'No custom fields yet',
    empty: { [URLS.fields]: ok({ fields: [] }), [URLS.features]: ok({ features: [] }) },
    row: {
      [URLS.fields]: ok({
        fields: [{
          id: 'cf1', entity_type: 'contact', field_key: 'company_size', field_label: 'Company size',
          field_type: 'text', is_required: false, is_searchable: true, is_calculated: false,
          display_order: 1, created_at: NOW,
        }],
      }),
      [URLS.features]: ok({ features: [] }),
    },
    rowText: 'Company size',
  },
  {
    key: 'integrations',
    Page: IntegrationsPage,
    failUrl: URLS.integrations,
    phrase: 'Failed to load integrations',
    sentence: 'No integrations yet',
    empty: { [URLS.integrations]: ok({ data: [] }) },
    row: {
      [URLS.integrations]: ok({ data: [{ id: 'i1', name: 'Ops webhook', type: 'webhook', is_active: true, created_at: NOW }] }),
    },
    rowText: 'Ops webhook',
  },
  {
    key: 'lead-scoring',
    Page: LeadScoringPage,
    failUrl: URLS.leadScoring,
    phrase: 'Failed to load lead scoring rules',
    sentence: 'No scoring rules defined yet',
    empty: { [URLS.leadScoring]: ok({ rules: [] }) },
    row: {
      [URLS.leadScoring]: ok({ rules: [{ id: 'r1', factor: 'email_verified', weight: 10, active: true }] }),
    },
    rowText: 'email_verified',
  },
  {
    key: 'localization',
    Page: LocalizationPage,
    failUrl: URLS.localization,
    phrase: 'Failed to load your localization settings',
    sentence: 'No holidays yet',
    empty: {
      [URLS.localization]: ok({ localization: { ...STORED_LOC, holidays: [] } }),
      [URLS.me]: adminMe,
    },
    row: { [URLS.localization]: ok({ localization: STORED_LOC }), [URLS.me]: adminMe },
    rowText: 'Bastille Day',
  },
  {
    key: 'notifications',
    Page: NotificationsPage,
    failUrl: URLS.matrix,
    phrase: 'Failed to load your notification settings',
    sentence: 'No events match',
    empty: { [URLS.matrix]: ok({ matrix: {} }) },
    row: {
      [URLS.matrix]: ok({ matrix: { 'lead.created': { in_app: true, email: false, telegram: false } } }),
    },
    rowText: 'New lead created',
    searchPlaceholder: 'Search events…',
  },
  {
    key: 'portal',
    Page: PortalPage,
    failUrl: URLS.portalConfig,
    phrase: 'Failed to load your portal settings',
    sentence: 'No clients yet',
    empty: {
      [URLS.portalConfig]: ok({ data: { enabled: true, allow_quotes: true, allow_invoices: true, allow_cases: true, custom_message: '' } }),
      [URLS.portalClients]: ok({ data: [] }),
    },
    row: {
      [URLS.portalConfig]: ok({ data: { enabled: true, allow_quotes: true, allow_invoices: true, allow_cases: true, custom_message: '' } }),
      [URLS.portalClients]: ok({
        data: [{ id: 'c1', name: 'Bright Lofts', email: 'ops@brightlofts.test', is_active: true, last_login_at: null, created_at: NOW }],
      }),
    },
    rowText: 'ops@brightlofts.test',
  },
  {
    key: 'security',
    Page: SecurityPage,
    failUrl: URLS.ipWhitelist,
    phrase: 'Failed to load your IP whitelist',
    sentence: 'No IPs added yet',
    empty: {
      [URLS.me]: adminMe,
      [URLS.trashSettings]: ok({ data: { retention_days: 60 } }),
      [URLS.autoCleanup]: ok({ pending_deletion: { total: 0 }, retention_days: 60, cutoff_date: null }),
      [URLS.ipWhitelist]: ok({ data: { ips: [], enabled: false } }),
    },
    row: {
      [URLS.me]: adminMe,
      [URLS.trashSettings]: ok({ data: { retention_days: 60 } }),
      [URLS.autoCleanup]: ok({ pending_deletion: { total: 0 }, retention_days: 60, cutoff_date: null }),
      [URLS.ipWhitelist]: ok({ data: { ips: ['203.0.113.7'], enabled: true } }),
    },
    rowText: '203.0.113.7',
  },
  {
    key: 'tags-manager',
    Page: TagsManagerPage,
    failUrl: URLS.tags,
    phrase: 'Failed to load tags',
    sentence: 'No tags yet',
    empty: { [URLS.me]: adminMe, [URLS.tags]: ok({ tags: [] }) },
    row: { [URLS.me]: adminMe, [URLS.tags]: ok({ tags: [{ tag: 'vip', leads: 2, contacts: 1, companies: 0, total: 3 }] }) },
    rowText: 'vip',
  },
  {
    key: 'tax',
    Page: TaxPage,
    failUrl: URLS.tax,
    phrase: 'Failed to load tax rates',
    sentence: 'No tax rates configured',
    empty: { [URLS.tax]: ok({ data: [] }) },
    row: {
      [URLS.tax]: ok({
        data: [{ id: 'tx1', name: 'VAT 20', rate: 20, type: 'percentage', country: 'FR', state: null, isDefault: true, isActive: true, createdAt: NOW }],
      }),
    },
    rowText: 'VAT 20',
  },
];

const wrap = (node: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};

const withFailure = (base: Record<string, QueryResult>, url: string): Record<string, QueryResult> => ({
  ...base,
  [url]: failed('Request failed (500) — RLS refused the read'),
});

const registryFor = (state: Record<string, QueryResult>) => {
  for (const key of Object.keys(registry.byUrl)) delete registry.byUrl[key];
  Object.assign(registry.byUrl, state);
};

beforeEach(() => registryFor({}));

describe.each(PANELS)('$key — a refused read is a failure, not an absence', ({ Page, failUrl, phrase, sentence, empty, row, rowText, searchPlaceholder }) => {
  /** Type the tenant's own filter so the panel has an absence to state, for the panels whose
   *  absence sentence only ever follows a search. A page that replaced itself with the banner has
   *  no search box left to type in, which is the point of the failure case. */
  const search = () => {
    if (!searchPlaceholder) return;
    const input = screen.queryByPlaceholderText(searchPlaceholder);
    if (input) fireEvent.change(input, { target: { value: 'zzz' } });
  };

  it('names the failure, and takes the sentence away with it', () => {
    registryFor(withFailure(empty, failUrl));
    wrap(<Page />);
    search();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(phrase);
    expect(alert.textContent).toContain('Request failed (500)');
    expect(document.body.textContent).not.toContain(sentence);
  });

  it('puts a working retry behind the banner', () => {
    const state = withFailure(empty, failUrl);
    registryFor(state);
    wrap(<Page />);
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(state[failUrl].refetch).toHaveBeenCalled();
  });

  it('still prints the sentence when the read succeeded and came back empty', () => {
    registryFor(empty);
    wrap(<Page />);
    search();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain(sentence);
  });

  it('prints the row, not the banner, when the read came back', () => {
    registryFor(row);
    wrap(<Page />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain(rowText);
    expect(document.body.textContent).not.toContain(sentence);
  });
});

describe('the counts a failed read used to report as zero', () => {
  it('tax: three cards that counted the list go unread rather than to 0', () => {
    registryFor(withFailure({ [URLS.tax]: ok({ data: [] }) }, URLS.tax));
    wrap(<TaxPage />);
    const card = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';
    expect(card('Total Rates')).toContain('—');
    expect(card('Active Rates')).toContain('—');
    expect(card('Default Rate')).toContain('—');
  });

  it('tax: a real read still gives the real numbers, and a true zero for no default', () => {
    registryFor({
      [URLS.tax]: ok({
        data: [
          { id: 'tx1', name: 'VAT 20', rate: 20, type: 'percentage', country: 'FR', state: null, isDefault: false, isActive: true, createdAt: NOW },
          { id: 'tx2', name: 'GST 5', rate: 5, type: 'fixed', country: 'AU', state: null, isDefault: false, isActive: false, createdAt: NOW },
        ],
      }),
    });
    wrap(<TaxPage />);
    const card = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';
    expect(card('Total Rates')).toContain('2');
    expect(card('Active Rates')).toContain('1');
    expect(card('Default Rate')).toContain('None');
  });

  it('ai-templates: "Your templates" counts what it cannot see', () => {
    registryFor(withFailure({ [URLS.aiTemplates]: ok({ templates: [], seeds: [] }) }, URLS.aiTemplates));
    wrap(<AiTemplatesPage />);
    expect(screen.getByText(/Your templates/i).textContent).toContain('(—)');
  });

  it('ai-templates: a real read prints the real count', () => {
    registryFor({
      [URLS.aiTemplates]: ok({
        templates: [{ id: 't1', slug: 'welcome', name: 'Welcome note', description: null, kind: 'email', tone: null, active: true }],
        seeds: [],
      }),
    });
    wrap(<AiTemplatesPage />);
    expect(screen.getByText(/Your templates/i).textContent).toContain('(1)');
  });

  it('custom-fields: the section header does not claim zero fields it never read', () => {
    registryFor(withFailure({ [URLS.fields]: ok({ fields: [] }), [URLS.features]: ok({ features: [] }) }, URLS.fields));
    wrap(<CustomFieldsPage />);
    expect(screen.getByRole('heading', { level: 2, name: /Custom Fields/ }).textContent).toContain('(—)');
  });
});

describe('the forms that must not render when their read failed', () => {
  it('localization: no timezone, no holiday list, no Save — and so nothing to overwrite', () => {
    registryFor(withFailure({ [URLS.localization]: ok({ localization: STORED_LOC }), [URLS.me]: adminMe }, URLS.localization));
    wrap(<LocalizationPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load your localization settings');
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByText('Bastille Day')).toBeNull();
    expect(screen.queryByText(/Save changes/i)).toBeNull();
  });

  it('localization: a real read renders the stored values, not DEFAULTS', () => {
    registryFor({ [URLS.localization]: ok({ localization: STORED_LOC }), [URLS.me]: adminMe });
    wrap(<LocalizationPage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByDisplayValue('Europe/Paris')).toBeTruthy();
    expect(screen.getByText('Bastille Day')).toBeTruthy();
  });

  it('notifications: an unread matrix renders no wall of switches the tenant never set', () => {
    registryFor(withFailure({ [URLS.matrix]: ok({ matrix: {} }) }, URLS.matrix));
    wrap(<NotificationsPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load your notification settings');
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryByText('New lead created')).toBeNull();
  });

  it('notifications: a stored ON is still ON after the read lands', () => {
    registryFor({ [URLS.matrix]: ok({ matrix: { 'lead.created': { in_app: true, email: false, telegram: false } } }) });
    wrap(<NotificationsPage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('New lead created')).toBeTruthy();
    expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('true');
  });

  it('portal: an unread config does not say the portal is switched off', () => {
    registryFor(withFailure({
      [URLS.portalConfig]: ok({ data: { enabled: true, allow_quotes: true, allow_invoices: true, allow_cases: true, custom_message: '' } }),
      [URLS.portalClients]: ok({ data: [] }),
    }, URLS.portalConfig));
    wrap(<PortalPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load your portal settings');
    expect(screen.queryByText(/Portal Status/i)).toBeNull();
    expect(screen.queryByText(/Client portal is live/i)).toBeNull();
  });

  it('portal: an unread client roster is a banner, and the header count goes unread', () => {
    registryFor(withFailure({
      [URLS.portalConfig]: ok({ data: { enabled: true, allow_quotes: true, allow_invoices: true, allow_cases: true, custom_message: '' } }),
      [URLS.portalClients]: ok({ data: [] }),
    }, URLS.portalClients));
    wrap(<PortalPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load portal clients');
    expect(screen.getByText(/Client Access/i).textContent).toContain('(—)');
    expect(document.body.textContent).not.toContain('No clients yet');
  });

  it('admin: an unread workspace does not report the plan as Free', () => {
    registryFor(withFailure({ [URLS.workspace]: ok(ORG), [URLS.members]: ok({ data: [] }) }, URLS.workspace));
    wrap(<AdminPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load your organization');
    expect(screen.queryByText('Free')).toBeNull();
    expect(screen.queryByText('Acme Studio')).toBeNull();
  });

  const SECURITY_OK = {
    [URLS.me]: adminMe,
    [URLS.trashSettings]: ok({ data: { retention_days: 60 } }),
    [URLS.autoCleanup]: ok({ pending_deletion: { total: 4 }, retention_days: 60, cutoff_date: NOW }),
    [URLS.ipWhitelist]: ok({ data: { ips: ['203.0.113.7'], enabled: true } }),
  };

  it('security: an unread trash setting says so, and its retry is that query', () => {
    const state = withFailure(SECURITY_OK, URLS.trashSettings);
    registryFor(state);
    wrap(<SecurityPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load your trash settings');
    expect(screen.getByRole('alert').textContent).toContain('Request failed (500)');
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(state[URLS.trashSettings].refetch).toHaveBeenCalled();
  });

  it('security: an unread IP whitelist is not an empty one', () => {
    registryFor(withFailure(SECURITY_OK, URLS.ipWhitelist));
    wrap(<SecurityPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load your IP whitelist');
    expect(document.body.textContent).not.toContain('No IPs added yet');
  });

  it('security: a stored retention period is what the select shows', () => {
    registryFor({
      [URLS.me]: adminMe,
      [URLS.trashSettings]: ok({ data: { retention_days: 90 } }),
      [URLS.autoCleanup]: ok({ pending_deletion: { total: 0 }, retention_days: 90, cutoff_date: null }),
      [URLS.ipWhitelist]: ok({ data: { ips: [], enabled: false } }),
    });
    wrap(<SecurityPage />);
    expect(screen.getByDisplayValue('90 days')).toBeTruthy();
  });
});

describe('a search that matches nothing stays a search miss', () => {
  it('tags-manager: the filter is client-side, so typing must not invent an outage', () => {
    registryFor({ [URLS.me]: adminMe, [URLS.tags]: ok({ tags: [{ tag: 'vip', leads: 2, contacts: 1, companies: 0, total: 3 }] }) });
    wrap(<TagsManagerPage />);
    fireEvent.change(screen.getByPlaceholderText('Filter tags…'), { target: { value: 'zzz' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain('No tags match "zzz"');
  });

  it('notifications: the event list is static, so only a search miss may say "no events match"', () => {
    registryFor({ [URLS.matrix]: ok({ matrix: {} }) });
    wrap(<NotificationsPage />);
    expect(document.body.textContent).not.toContain('No events match');
    fireEvent.change(screen.getByPlaceholderText('Search events…'), { target: { value: 'zzz' } });
    expect(document.body.textContent).toContain('No events match');
  });
});

describe('the guard still ratchets, and this slice decays honestly', () => {
  const ROOT = process.cwd();
  const BASELINE = 'scripts/panel-error-state-baseline.json';
  const SCRIPT = 'scripts/check-panel-error-state.mjs';

  const doc = () => JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) as {
    files: Record<string, string>;
  };

  it('is green, and none of the twelve settings panels still hides in the baseline', () => {
    const res = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).not.toContain('no longer offends');
    const files = doc().files;
    for (const panel of PANELS) {
      expect(files[`app/tenant/settings/${panel.key}/page.tsx`], `${panel.key} was fixed; it must not stay allowlisted`).toBeUndefined();
    }
  });

  it('keeps the list bounded, so an empty sweep still cannot read as success', () => {
    // The bound is a CEILING on purpose: an equality here goes false every time another slice
    // honestly fixes a panel — #2839 is in review with eight more of them.
    const files = doc().files;
    expect(Object.keys(files).length).toBeLessThanOrEqual(32);
    for (const [file, note] of Object.entries(files)) {
      expect(note, `${file} is allowlisted with no reason attached`).toContain('#2829');
    }
    // This case used to prove itself by naming `chat`, `emails` and `pipelines` as still owed.
    // #2829's last slice fixed all three, so the honest version of the same proof is that the
    // guard runs clean over an EMPTY allowlist and still says so with a number — and that a page
    // joining the class is novel, which is what `panel-page-error-not-empty-last-slice-2829`
    // re-lights by rewinding those three files.
    for (const done of ['chat', 'emails', 'pipelines']) {
      expect(files[`app/tenant/${done}/page.tsx`], `${done} was fixed; it must not stay allowlisted`).toBeUndefined();
    }
    const res = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(res.stdout, res.stdout + res.stderr).toMatch(/OK — \d+ panel\(s\)/);
  });

  it('does not push a fixed page over a size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
