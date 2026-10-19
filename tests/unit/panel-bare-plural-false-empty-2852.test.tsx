// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2852 — four panels that answer a failed read with a bare "No <plural>", a class
 * `check-panel-error-state.mjs` cannot name.
 *
 * #2829's list of 24 panels is honest as far as its screen can see. `EMPTY_SENTENCE`
 * (`scripts/check-panel-error-state.mjs:73-74`) only recognises a "there are none"
 * claim when the copy carries one of a fixed set of trailing qualifiers
 * (yet|found|here|configured|recorded|logged|sent|match…), so "No deals found" is
 * caught and these are not: "No templates available", "No integrations installed",
 * "No segments defined", "No territories". Measured on main before this slice: the
 * shipped screen reports offenders=24 / novel=0 (CI green) while adding a bare-plural
 * arm to the same screen reports 35 / 11.
 *
 * Four of those eleven are the pages under test here — the other seven are the
 * #2849 set (already fixed) and three files the widened proxy flags in error, which
 * is why the vocabulary arm is NOT being shipped: a page that returns early on
 * `!data` cannot print a sentence about the tenant's data, and the screen does not
 * know that yet. See the issue for the adjudication.
 *
 * Each panel gets the three-state split every slice in this class uses, because any
 * single assertion can be satisfied by a page that cheats:
 *   - read fails      → an alert naming it, its own `refetch` behind "Try again",
 *                       and the bare plural unreachable;
 *   - read succeeds,
 *     returns nothing → the sentence, no alert (a page that KNOWS there are none may
 *                       say so);
 *   - read succeeds
 *     with rows       → the rows, no alert.
 *
 * Two assertions are specific to what the measurement found beyond the sentence:
 *   - `integrations` has a SECOND read (`?type=providers`) that destructures no
 *     `error` at all, so a refusal leaves the "Available" tab an empty grid —
 *     silence that reads as "nothing left to install";
 *   - three of the four pages call `toast.error()` in the RENDER BODY, so the failure
 *     is announced again on every re-render (each keystroke in the create form
 *     re-fires it) and `industries` announces it from an effect that fades while the
 *     sentence stays. Both spellings are replaced by the banner, so "no load-failure
 *     toast at all, before or after a re-render" is pinned for every panel here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import toast from 'react-hot-toast';

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
  usePathname: () => '/tenant',
}));

import IndustriesPage from '@/app/tenant/industries/page';
import IntegrationsPage from '@/app/tenant/integrations/page';
import SegmentsPage from '@/app/tenant/segments/page';
import TerritoriesPage from '@/app/tenant/settings/territories/page';

const NOW = '2026-10-01T00:00:00Z';
const INDUSTRIES = '/api/tenant/industry-templates';
const INSTANCES = '/api/tenant/plugin-engine';
const PROVIDERS = '/api/tenant/plugin-engine?type=providers';
const SEGMENTS = '/api/tenant/segments';
const TERRITORIES = '/api/tenant/territories';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

// ── fixtures: one row each, shaped like the API's own list responses ──────────
const industryTpl = {
  data: [{
    id: 'it1', name: 'Retail chain', description: 'Stores, staff and stock',
    modules: [], custom_fields: [], pipelines: [], automations: [],
  }],
};
const instanceRow = {
  data: [{
    id: 'i1', tenantId: 't1', providerId: 'slack', label: 'Ops Slack',
    config: {}, enabled: true, createdAt: NOW,
  }],
};
const providerRow = {
  data: [{
    id: 'gcal', name: 'Google Calendar', description: 'Sync meetings as activities',
    category: 'calendar', icon: 'Calendar', configFields: [], builtIn: true,
    capabilities: [{ action: 'list', label: 'List events', description: 'd', inputFields: [] }],
  }],
};
const segmentRow = {
  data: [{ id: 's1', name: 'Enterprise contacts', entity_type: 'contacts', filter_count: 3, created_at: NOW }],
};
const territoryRow = {
  data: [{ id: 'tr1', name: 'DACH region', type: 'geographic', parentId: null, geoConfig: {}, createdAt: NOW }],
};

const alerts = (): string =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const wrapped = (node: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};

type Panel = {
  key: string;
  Page: () => ReactNode;
  /** the read this slice refuses */
  failUrl: string;
  /** registry for the failure case (the refused read + everything else it needs) */
  withFailure: Record<string, QueryResult>;
  /** the bare-plural sentence the page prints, as it appears in JSX */
  sentence: RegExp;
  /** what the replacement banner has to name */
  phrase: RegExp;
  empty: Record<string, QueryResult>;
  row: Record<string, QueryResult>;
  rowText: string;
  /** a click that re-renders the page without touching the failed read */
  reRender?: () => void;
};

const PANELS: Panel[] = [
  {
    key: 'industries',
    Page: IndustriesPage,
    failUrl: INDUSTRIES,
    withFailure: { [INDUSTRIES]: failed() },
    sentence: /No templates available/,
    phrase: /industry templates/i,
    empty: { [INDUSTRIES]: ok({ data: [] }) },
    row: { [INDUSTRIES]: ok(industryTpl) },
    rowText: 'Retail chain',
  },
  {
    key: 'segments',
    Page: SegmentsPage,
    failUrl: SEGMENTS,
    withFailure: { [SEGMENTS]: failed() },
    sentence: /No segments defined/,
    phrase: /segments/i,
    empty: { [SEGMENTS]: ok({ data: [] }) },
    row: { [SEGMENTS]: ok(segmentRow) },
    rowText: 'Enterprise contacts',
    reRender: () => fireEvent.click(screen.getByRole('button', { name: /new segment/i })),
  },
  {
    key: 'territories',
    Page: TerritoriesPage,
    failUrl: TERRITORIES,
    withFailure: { [TERRITORIES]: failed() },
    sentence: /No territories/,
    phrase: /territor/i,
    empty: { [TERRITORIES]: ok({ data: [] }) },
    row: { [TERRITORIES]: ok(territoryRow) },
    rowText: 'DACH region',
    // Both the header and the empty-state branch carry an "Add Territory" button,
    // so this must not assume there is only one.
    reRender: () => fireEvent.click(screen.getAllByRole('button', { name: /add territory/i })[0]!),
  },
  {
    key: 'integrations (installed list)',
    Page: IntegrationsPage,
    failUrl: INSTANCES,
    withFailure: { [INSTANCES]: failed(), [PROVIDERS]: ok(providerRow) },
    sentence: /No integrations installed/,
    phrase: /integration/i,
    empty: { [INSTANCES]: ok({ data: [] }), [PROVIDERS]: ok(providerRow) },
    row: { [INSTANCES]: ok(instanceRow), [PROVIDERS]: ok(providerRow) },
    rowText: 'Ops Slack',
    reRender: () => fireEvent.click(screen.getByRole('button', { name: /available/i })),
  },
];

describe('a refused read is not a bare "No <plural>" (#2852)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  for (const p of PANELS) {
    describe(p.key, () => {
      it('names the failed read instead of claiming the tenant has none', () => {
        registry.byUrl = { ...p.withFailure };
        expect(() => wrapped(<p.Page />)).not.toThrow();
        expect(alerts()).toMatch(p.phrase);
        expect(alerts()).toMatch(/failed|did not (load|answer)|could not be read/i);
        expect(screen.queryAllByText(p.sentence).length, `${p.key} still states the absence`).toBe(0);
      });

      it('keeps its honest sentence for a successful read that returned nothing', () => {
        registry.byUrl = { ...p.empty };
        wrapped(<p.Page />);
        expect(screen.getAllByText(p.sentence).length).toBeGreaterThan(0);
        expect(alerts()).toBe('');
      });

      it('renders rows, with no failure state, on a successful read', () => {
        registry.byUrl = { ...p.row };
        wrapped(<p.Page />);
        expect(screen.getByText(p.rowText)).toBeTruthy();
        expect(alerts()).toBe('');
      });

      it('re-runs the read that failed', () => {
        registry.byUrl = { ...p.withFailure };
        wrapped(<p.Page />);
        fireEvent.click(screen.getByRole('button', { name: /try again/i }));
        expect(registry.byUrl[p.failUrl].refetch).toHaveBeenCalled();
      });

      it('announces the failure once, in the banner — not from the render body or an effect', () => {
          registry.byUrl = { ...p.withFailure };
          wrapped(<p.Page />);
          expect(toast.error, 'fires on the first render').not.toHaveBeenCalled();
          p.reRender?.();
          expect(toast.error, 'and again on every re-render after it').not.toHaveBeenCalled();
      });
    });
  }
});

describe('the integrations page second read (#2852)', () => {
  beforeEach(() => {
    registry.byUrl = {};
    vi.clearAllMocks();
  });

  const openAvailable = () => {
    fireEvent.click(screen.getByRole('button', { name: /available/i }));
  };

  it('says the provider list could not be read, rather than leaving the tab empty', () => {
    registry.byUrl = { [INSTANCES]: ok(instanceRow), [PROVIDERS]: failed('Request failed (503)') };
    expect(() => wrapped(<IntegrationsPage />)).not.toThrow();
    openAvailable();
    expect(alerts()).toMatch(/provider|integration/i);
    expect(alerts()).toMatch(/failed|did not (load|answer)|could not be read/i);
    // The only card left would be the hand-rolled "Custom API" one, which reads as
    // "there is nothing else to install".
    expect(screen.queryByText('Google Calendar')).toBeNull();
  });

  it('re-runs the providers read, not the instances read', () => {
    registry.byUrl = { [INSTANCES]: ok(instanceRow), [PROVIDERS]: failed() };
    wrapped(<IntegrationsPage />);
    openAvailable();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[PROVIDERS].refetch).toHaveBeenCalled();
    expect(registry.byUrl[INSTANCES].refetch).not.toHaveBeenCalled();
  });

  it('keeps the installed tab working while the providers read is the one that failed', () => {
    registry.byUrl = { [INSTANCES]: ok(instanceRow), [PROVIDERS]: failed() };
    wrapped(<IntegrationsPage />);
    expect(screen.getByText('Ops Slack')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('shows a provider list with no alert when both reads answered', () => {
    registry.byUrl = { [INSTANCES]: ok(instanceRow), [PROVIDERS]: ok(providerRow) };
    wrapped(<IntegrationsPage />);
    openAvailable();
    expect(screen.getByText('Google Calendar')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('does not state a tab count for a read that never answered', () => {
    registry.byUrl = { [INSTANCES]: ok(instanceRow), [PROVIDERS]: ok(providerRow) };
    const { rerender } = wrapped(<IntegrationsPage />);
    expect(screen.getByRole('button', { name: /installed \(1\)/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /available \(1\)/i })).toBeTruthy();

    registry.byUrl = { [INSTANCES]: failed(), [PROVIDERS]: ok(providerRow) };
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IntegrationsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /installed \(—\)/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /available \(1\)/i }), 'the read that answered keeps its count').toBeTruthy();

    registry.byUrl = { [INSTANCES]: ok(instanceRow), [PROVIDERS]: failed() };
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <IntegrationsPage />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: /available \(—\)/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /installed \(1\)/i })).toBeTruthy();
  });
});

describe('why the screen cannot be the thing that keeps these honest (#2852)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/industries/page.tsx',
    'app/tenant/integrations/page.tsx',
    'app/tenant/segments/page.tsx',
    'app/tenant/settings/territories/page.tsx',
  ];

  it('cannot see a bare plural at all — the qualifier arm is what these pages miss', async () => {
    const { EMPTY_SENTENCE } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    EMPTY_SENTENCE.lastIndex = 0;
    for (const copy of ['No templates available.', 'No integrations installed.', 'No segments defined.', 'No territories']) {
      EMPTY_SENTENCE.lastIndex = 0;
      expect(EMPTY_SENTENCE.test(copy), `"${copy}" is a "there are none" claim the regex drops`).toBe(false);
    }
    // …while the same screen does see the qualified spelling this class was counted with.
    EMPTY_SENTENCE.lastIndex = 0;
    expect(EMPTY_SENTENCE.test('No deals found')).toBe(true);
  });

  it('reports none of the four as an offender, so CI never noticed them before or after', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const res = inspect(f, readFileSync(join(ROOT, f), 'utf8'));
      expect(res.offends, `${f} — the screen is blind, which is the premise of #2852`).toBe(false);
    }
  });

  it('leaves the ratchet exactly where it found it, with no baseline churn', () => {
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain('OK —');
    expect(res.stdout, 'no page may become a stale baseline entry on the way past').not.toContain('no longer offends');
    const doc = JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')) as {
      files: Record<string, string>;
    };
    for (const f of FILES) {
      expect(doc.files[f], `${f} was never in the class list; it must not be allowlisted now`).toBeUndefined();
    }
    expect(Object.keys(doc.files).length, 'this slice adds nothing to the outstanding list').toBeLessThanOrEqual(24);
  });

  it('does not push a fixed page over a size ceiling', () => {
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
