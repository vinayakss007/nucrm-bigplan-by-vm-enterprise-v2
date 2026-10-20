// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — fourth slice: the three config panels (`integrations`, `settings/tax`,
 * `settings/territories`).
 *
 * These pages are not the #2829 shape. All three already answer a read that **never happened**:
 * `#2852` gave territories and integrations an explicit outage branch, and `tax` had one too. This
 * slice answers the half #2829 could not ask, the one #2872 exists for: what happens when a read
 * that **answered before** fails **now**.
 *
 * TanStack keeps `data` when a refetch of a query that already succeeded fails. Every page here
 * invalidates its own key after a mutation — `integrations` `load()` on remove/toggle/install,
 * `tax` `reload()` after save and delete, `territories` `reload()` after save and delete — and
 * `lib/query/client.tsx` sets `refetchOnWindowFocus: false` with `retry: 2`, so the state arrives
 * after two failed retries. Which is to say: right after the operator pressed Save, on the panel
 * that shows what they just saved.
 *
 * And the #2829 branch is precisely what destroys it. Branching on the bare error flag sends
 * "refused refresh of a list that is still on screen" to the same place as "never read", so the
 * tax table, the territory tree and the installed-integration list are replaced by an outage
 * banner a moment after a successful write.
 *
 * Three shapes, all of which were broken here:
 *   - the list branch read the bare flag, so a refused refresh hid rows the page was holding;
 *   - `tax` (three header cards) and `integrations` (both tab counts) guarded on that same bare
 *     flag, so a refused refresh printed `—` above a table it was still totalling — the inverse
 *     lie of #2829's `0`, and the one this suite's blindness proof is about;
 *   - `territories` builds its modal's Parent picker off the same read, so an unread tree left
 *     only "None (root)" selectable and quietly filed every new territory at the top level.
 *
 * `integrations` has two reads, and the second one leaks into the first: `installedIds` is derived
 * from the instances list, so when *that* read fails the Available tab can no longer tell you
 * which providers you already connected. That is asserted below, because a banner on the Installed
 * tab does not tell the person standing on the other tab anything.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
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

import toast from 'react-hot-toast';
import TaxSettingsPage from '@/app/tenant/settings/tax/page';
import TerritoriesPage from '@/app/tenant/settings/territories/page';
import IntegrationsPage from '@/app/tenant/integrations/page';

/** The URL each page asks for, exactly as it builds it. Drift here is the test failing for the
 *  right reason: the page started asking for something else. */
const TAX = '/api/tenant/tax';
const TERRITORIES = '/api/tenant/territories';
const INSTANCES = '/api/tenant/plugin-engine';
const PROVIDERS = '/api/tenant/plugin-engine?type=providers';

const NOW = '2026-03-04T10:00:00.000Z';

const taxRows = {
  data: [
    { id: 'tx1', name: 'GST', rate: 18, type: 'percentage', country: 'IN', state: null, isDefault: true, isActive: true, createdAt: NOW },
    { id: 'tx2', name: 'VAT', rate: 20, type: 'percentage', country: 'DE', state: null, isDefault: false, isActive: true, createdAt: NOW },
  ],
};

/** Nested on purpose: the page flattens the tree, and the child's row is what proves the read
 *  survived rather than just the header. */
const territoryRows = {
  data: [
    {
      id: 'tr1', name: 'Northern Zone', type: 'geographic', parentId: null, geoConfig: {}, createdAt: NOW,
      children: [{ id: 'tr2', name: 'Lakes Sub-zone', type: 'geographic', parentId: 'tr1', geoConfig: {}, createdAt: NOW }],
    },
  ],
};

const providerDefinition = {
  id: 'p-twilio', name: 'Twilio SMS', description: 'Messaging provider', category: 'messaging',
  icon: 'MessageSquare', configFields: [], builtIn: true,
  capabilities: [{ action: 'send_sms', label: 'Send SMS', description: '', inputFields: [] }],
};
const instanceRows = {
  data: [
    { id: 'i1', tenantId: 't-1', providerId: 'p-mail', label: 'Support mailbox', config: {}, enabled: true, createdAt: NOW },
  ],
};
const providerRows = { data: [providerDefinition] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state none of these three pages could name before this slice. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

describe('tax rates: a refused refresh does not delete the table it just wrote to (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the rates and calls them the last read, with the reason', () => {
    registry.byUrl = { [TAX]: staleRead(taxRows) };
    wrapped(<TaxSettingsPage />);
    expect(within(screen.getByRole('table')).getByText('GST')).toBeTruthy();
    expect(within(screen.getByRole('table')).getByText('VAT')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the tax rates');
    expect(alerts()).toContain('Request failed (504)');
    // The outage sentence is gone: the list is not unread, the refresh was.
    expect(alerts()).not.toContain('Failed to load tax rates');
  });

  it('still counts the last read instead of printing — above the rows it is displaying', () => {
    registry.byUrl = { [TAX]: staleRead(taxRows) };
    wrapped(<TaxSettingsPage />);
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.getByText('Active Rates')).toBeTruthy();
  });

  it('binds the last-read banner to the tax query, so Try again re-runs the read that failed', () => {
    const result = staleRead(taxRows);
    registry.byUrl = { [TAX]: result };
    wrapped(<TaxSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a list that never answered is still an outage: banner, reason, and the cards unavailable', () => {
    registry.byUrl = { [TAX]: failed('Request failed (500)') };
    wrapped(<TaxSettingsPage />);
    expect(screen.queryByText('GST')).toBeNull();
    expect(alerts()).toContain('Failed to load tax rates');
    expect(alerts()).toContain('Request failed (500)');
    // Total Rates, Active Rates, Default Rate — no count of an empty array.
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText(/Could not refresh/)).toBeNull();
  });

  it('says so when a successful read genuinely returned nothing', () => {
    registry.byUrl = { [TAX]: ok({ data: [] }) };
    wrapped(<TaxSettingsPage />);
    expect(screen.getByText('No tax rates configured')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces the failure once, not once per render, now that the state is sustained', () => {
    // This page's `if (error) toast.error(...)` sat in the RENDER BODY — the exact shape #2852
    // removed from its two siblings. A stale state survives on screen, so a render-body toast
    // re-announces one refused refresh on every re-render.
    registry.byUrl = { [TAX]: staleRead(taxRows) };
    const view = wrapped(<TaxSettingsPage />);
    view.rerender(tree(<TaxSettingsPage />));
    view.rerender(tree(<TaxSettingsPage />));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});

describe('territories: the tree stays on screen when the refresh is what failed (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps both levels of the tree and names them the last read', () => {
    const result = staleRead(territoryRows);
    registry.byUrl = { [TERRITORIES]: result };
    wrapped(<TerritoriesPage />);
    // 'Northern Zone' is on screen twice — its own row, and the child's "Parent:" label. That
    // pairing is the proof the tree survived as a tree, not as a flat banner.
    expect(screen.getAllByText('Northern Zone')).toHaveLength(2);
    expect(screen.getByText('Lakes Sub-zone')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the territories');
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).not.toContain('Failed to load territories');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a tree that never answered is an outage, and never the "No territories" invitation to rebuild it', () => {
    registry.byUrl = { [TERRITORIES]: failed('Request failed (500)') };
    wrapped(<TerritoriesPage />);
    expect(screen.queryByText('Northern Zone')).toBeNull();
    expect(screen.queryByText('No territories')).toBeNull();
    expect(alerts()).toContain('Failed to load territories');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.queryByText(/Could not refresh/)).toBeNull();
  });

  it('refuses to offer an empty parent picker when the tree could not be read', () => {
    // The picker is built off the same read. Offered empty, it silently files every new territory
    // as a root: "no parent" and "never read" look identical to whoever is typing the name.
    registry.byUrl = { [TERRITORIES]: failed('Request failed (500)') };
    wrapped(<TerritoriesPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /add territory/i })[0]);
    expect(screen.getByText(/there is no parent to pick from/)).toBeTruthy();
    expect(screen.queryByText('None (root)')).toBeNull();
  });

  it('keeps the picker working under a stale read, and says the options are the last read', () => {
    registry.byUrl = { [TERRITORIES]: staleRead(territoryRows) };
    wrapped(<TerritoriesPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /add territory/i })[0]);
    expect(screen.getByText('None (root)')).toBeTruthy();
    expect(screen.getByText('Lakes Sub-zone', { selector: 'option' })).toBeTruthy();
    expect(screen.getByText(/these options are the last read/)).toBeTruthy();
  });

  it('keeps "no territories saved yet" for the read that genuinely came back empty', () => {
    registry.byUrl = { [TERRITORIES]: ok({ data: [] }) };
    wrapped(<TerritoriesPage />);
    // The empty state renders its own "Add Territory" CTA beside the header's; either opens the
    // same modal, and neither is the assertion here.
    fireEvent.click(screen.getAllByRole('button', { name: /add territory/i })[0]);
    expect(screen.getByText(/No territories saved yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('integrations: each tab answers for its own read (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the installed rows and calls them the last read when the refresh fails', () => {
    const result = staleRead(instanceRows);
    registry.byUrl = { [INSTANCES]: result, [PROVIDERS]: ok(providerRows) };
    wrapped(<IntegrationsPage />);
    expect(screen.getByText('Support mailbox')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh your installed integrations');
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).not.toContain('Failed to load your installed integrations');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('counts the last read on the tabs, rather than dashing a list it is displaying', () => {
    registry.byUrl = { [INSTANCES]: staleRead(instanceRows), [PROVIDERS]: ok(providerRows) };
    wrapped(<IntegrationsPage />);
    expect(screen.getByRole('button', { name: /Installed \(1\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Available \(1\)/ })).toBeTruthy();
  });

  it('a list that never answered is still an outage, and never "No integrations installed"', () => {
    registry.byUrl = { [INSTANCES]: failed('Request failed (500)'), [PROVIDERS]: ok(providerRows) };
    wrapped(<IntegrationsPage />);
    expect(screen.queryByText('Support mailbox')).toBeNull();
    // The sentence #2852 removed from the failure path must not come back with the new flag.
    expect(screen.queryByText(/No integrations installed/)).toBeNull();
    expect(alerts()).toContain('Failed to load your installed integrations');
    expect(screen.getByRole('button', { name: /Installed \(—\)/ })).toBeTruthy();
  });

  it('gives the providers tab its own stale state, without touching the installed tab', () => {
    registry.byUrl = { [INSTANCES]: ok(instanceRows), [PROVIDERS]: staleRead(providerRows, 'Providers failed (503)') };
    wrapped(<IntegrationsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Available \(1\)/ }));
    expect(screen.getByText('Twilio SMS')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the providers available to install');
    expect(alerts()).toContain('Providers failed (503)');
    expect(alerts()).not.toContain('Failed to load the providers available to install');
  });

  it('a providers read that never answered still shows the outage banner, not an empty market', () => {
    registry.byUrl = { [INSTANCES]: ok(instanceRows), [PROVIDERS]: failed('Providers failed (500)') };
    wrapped(<IntegrationsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Available \(—\)/ }));
    expect(screen.queryByText('Twilio SMS')).toBeNull();
    expect(alerts()).toContain('Failed to load the providers available to install');
  });

  it('says so when both reads genuinely came back empty', () => {
    registry.byUrl = { [INSTANCES]: ok({ data: [] }), [PROVIDERS]: ok({ data: [] }) };
    wrapped(<IntegrationsPage />);
    expect(screen.getByText('No integrations installed. Browse the available ones.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('admits on the Available tab that which-one-are-installed is unread', () => {
    // `installedIds` is derived from the instances read, so when that fails the Available grid
    // silently offers to re-install what is already connected. A banner on the *other* tab would
    // tell the person standing here nothing.
    registry.byUrl = { [INSTANCES]: failed('Instances unread (500)'), [PROVIDERS]: ok(providerRows) };
    wrapped(<IntegrationsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Available \(1\)/ }));
    expect(screen.getByText(/may be one you have already connected/)).toBeTruthy();
    expect(screen.getByText(/Instances unread \(500\)/)).toBeTruthy();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/settings/tax/page.tsx',
    'app/tenant/settings/territories/page.tsx',
    'app/tenant/integrations/page.tsx',
  ];

  it('splits the two states apart on every page it touched', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w+\) && !\w+/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/const \w*[Ss]tale = Boolean\(/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${f} still branches the list on the bare flag`).toMatch(/\b\w*[Ff]ailed \?/);
    }
  });

  it('announces a failed read from an effect, not from the render body', () => {
    // The render-body toast was `tax`'s shape; a sustained stale state turns it into a toast per
    // re-render. #2852 had already moved its two siblings, and this slice moves the last one.
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} toasts during render`).not.toMatch(/^\s*if \(\w*[Ee]rror\)\s*toast\.error/m);
    }
  });

  it('keeps #2829\'s guard green, with no new baseline entry and nothing left stale', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling rather than a count — pinning the number is what #2858, #2865 and #2866 each
    // had to undo.
    expect(files.length).toBeLessThanOrEqual(20);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of FILES) {
      expect(files, `${f} should never have been baselined — it was already visible to the guard`)
        .not.toContain(f);
    }
  });

  it('is not something the guard could have caught anyway', async () => {
    // The guard asks whether the file binds an error and renders one failure affordance. All
    // three pages did that before this slice — which is why none of them is on the baseline, and
    // why #2872 is a separate epic rather than another #2829 slice.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const withoutStale = src
        .replace(/\n\s*\{\s*\w*[Ss]tale && \([\s\S]*?\)\s*\}\s*\n/g, '\n')
        .replace(/const \w*[Ss]tale = [^\n]*\n/g, '');
      expect(withoutStale, `${f}: the stale block changed shape, update this check`)
        .not.toBe(src);
      expect(inspect(f, withoutStale).offends, `${f} would now be visible to the guard`)
        .toBe(false);
    }
  });

  it('is not something the counters could have caught either', async () => {
    // The specific blindness this slice exists for: `error ? '—' : n` is correct-looking code that
    // reports an unread list over a list the page is still showing. Rewinding it to the bare flag
    // leaves the guard, the file-size ratchet and every #2829 assertion green.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const bare = src
        .replace(/\b(\w*)Failed \? '—'/g, (_m, p: string) => (p ? `${p}Error` : 'error') + " ? '—'")
        .replace(/const \w*[Ff]ailed = [^\n]*\n/g, '');
      expect(bare, `${f}: the dash guard changed spelling, update this check`).not.toBe(src);
      expect(inspect(f, bare).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const f of FILES) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
