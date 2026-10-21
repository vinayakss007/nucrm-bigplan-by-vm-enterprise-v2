// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/modules/page.tsx`: the panel that switches CRM modules on and off
 * for a workspace could not tell "this read never answered" from "this read answered and
 * the refresh was refused", and got both wrong from one branch.
 *
 * The base shape was
 *
 *     {loading ? skeletons : filtered.length === 0 ? (modulesError ? <outage/> : <sentence/>) : <cards/>}
 *
 * so the bare `modulesError` flag was consulted ONLY when nothing was on screen. With
 * TanStack Query keeping `data` through a refused revalidation (`lib/query/client.tsx:37-44`;
 * the shared client runs `retry: 2`, `staleTime: 30_000`), the ordinary screen after this
 * page's own writes — `installMutation`, `disableMutation` and `saveSettingsMutation` all
 * finish in `load()` → `invalidateQueries(['tenant','modules'])`, the exact key the read
 * lives under — kept the cards and said nothing about the refusal. And the mirror image: a
 * last read that legitimately held no module in the chosen category printed "Failed to load
 * the modules for this category" — an outage announced over a read that answered.
 *
 * `modulesFailed = Boolean(modulesError) && !data` is the read that never answered;
 * `modulesStale = Boolean(modulesError) && Boolean(data)` is the last read, kept, with the
 * caveat ABOVE the cards.
 *
 * What the write path actually does, which is what rule #1's gates are decided from
 * (`app/api/tenant/modules/route.ts`, `lib/modules/registry.ts`), is measured below rather
 * than assumed: the body addresses ONE `module_id` (route.ts:38-40 POST, :55-60 PATCH) and
 * never takes the workspace's whole module map, so "a toggle silently removes modules nobody
 * touched" is NOT this page's failure mode. What it does do is replace that one module's
 * `settings` column with the map the page was holding (registry.ts:352-360 on install,
 * :392-400 on update_settings), and `disable` (:372-376) is an unconditional UPDATE with no
 * precondition and no re-read — so the badge that decided which button the operator sees is
 * the only referee, and on a refused refresh that badge is the older one. Blast radius is
 * the whole workspace: the same row is what `lib/auth/middleware.ts:446`,
 * `lib/modules/client-gate.tsx:139,173` and `components/tenant/layout/sidebar.tsx:171` gate
 * every user of the tenant on.
 *
 * Fixtures are documentation-only (`sip.test`, RFC 2606).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
// `disable(...)` awaits `confirmThen(...)`; auto-confirm it so the write runs.
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => Promise.resolve(fn()),
  ConfirmDialog: () => null,
}));

import ModulesPage from '@/app/tenant/modules/page';

const MODULES = '/api/tenant/modules';

/**
 * Two rows, deliberately in different categories and different statuses: the active one
 * carries the configuration fields the modal sends back, the available one shows the card
 * a refused refresh would offer an install for. `installed_at` is what GET hands back
 * (route.ts:25) and what no client on this page ever reads — see the route audit below.
 */
const GATEWAY = { gateway: 'sip.test', access_token: 'token-from-last-read' };
const MODULE_ROWS = {
  data: [
    {
      id: 'm-voice', name: 'Desk Phone Sync', description: 'Calls logged against contacts',
      icon: '📞', category: 'integration', features: ['Call logging', 'Transcripts', 'Screen pop', 'Number lookup'],
      pricing: {}, status: 'active', settings: { ...GATEWAY }, is_free: false, price_monthly: 29,
      settings_schema: [
        { key: 'gateway', label: 'Gateway host', type: 'text', required: true },
        { key: 'access_token', label: 'Access Token', type: 'password', required: true },
      ],
    },
    {
      id: 'm-fax', name: 'Fax Relay', description: 'Archive fixtures for the test read',
      icon: '📠', category: 'automation', features: ['Bulk send'], pricing: {},
      status: 'available', settings: {}, is_free: true, price_monthly: 0,
    },
  ],
};
/** The same read with nothing for the chosen category — a legitimate absence. */
const EMPTY_ROWS = { data: [] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
/** A read that never answered. */
const unread = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this page could not name: the read answered, the refresh was refused. */
const refusedRefresh = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/** Copy that is NOT inside an alert: what the page asserts as fact. */
const claimsOutsideAlerts = (re: RegExp) =>
  screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);

const OUTAGE_TAIL = 'The grid shows nothing because this read never answered';
const CAVEAT_HEAD = 'Could not refresh, so the cards below and their Installed/Disabled badges are the last read';

const button = (name: RegExp) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;
const offered = (name: RegExp) => {
  const el = button(name);
  return el !== null && el.disabled === false;
};

/** The cards are plain divs with an onClick; open one by its module name. */
const openCard = (name: string) => {
  const card = screen.getByText(name).closest('.cursor-pointer');
  expect(card, `no clickable card for ${name}`).toBeTruthy();
  fireEvent.click(card as HTMLElement);
};

let client: QueryClient;
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};
const mount = (result: QueryResult) => {
  registry.byUrl = { [MODULES]: result };
  return wrapped(<ModulesPage />);
};

/** Records what each write actually sends, so "the toggle addresses one module" and "it
 *  replaces that module's settings map" are measured instead of assumed. */
let bodies: Record<string, unknown>[] = [];
function stubWrites(payload: unknown = { ok: true }) {
  globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? '{}'));
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  registry.byUrl = {};
  bodies = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(client, 'invalidateQueries');
  stubWrites();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the healthy read and the genuinely-empty read keep their own shapes (#2872)', () => {
  it('shows both cards, their badges and their prices, and says nothing about failure', () => {
    mount(ok(MODULE_ROWS));
    expect(screen.getByText('Desk Phone Sync')).toBeTruthy();
    expect(screen.getByText('Fax Relay')).toBeTruthy();
    expect(screen.getByText('Installed')).toBeTruthy();
    expect(screen.getByText('$29')).toBeTruthy();
    expect(screen.getByText('Free')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(claimsOutsideAlerts(/No modules in this category/)).toHaveLength(0);
  });

  it('says the category has none when that is what a successful read returned', () => {
    mount(ok(EMPTY_ROWS));
    expect(screen.getByText('No modules in this category')).toBeTruthy();
    expect(screen.getByText(/Try selecting a different category/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('filters the kept cards by category without inventing a failure', () => {
    mount(ok(MODULE_ROWS));
    fireEvent.click(screen.getByRole('button', { name: 'Automation' }));
    expect(screen.queryByText('Desk Phone Sync')).toBeNull();
    expect(screen.getByText('Fax Relay')).toBeTruthy();
    expect(alerts()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Messaging' }));
    expect(screen.getByText('No modules in this category')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('a refused refresh keeps the cards and says what it cost (#2872)', () => {
  it('leaves every kept card, badge and figure on screen', () => {
    mount(refusedRefresh(MODULE_ROWS));
    expect(screen.getByText('Desk Phone Sync')).toBeTruthy();
    expect(screen.getByText('Fax Relay')).toBeTruthy();
    expect(screen.getByText('Installed')).toBeTruthy();
    // A kept read counted these, so they stay numbers and not dashes.
    expect(screen.getByText('$29')).toBeTruthy();
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText('+1 more features')).toBeTruthy();
  });

  it('names this page\'s loss in operator words, and drops the outage sentence', () => {
    mount(refusedRefresh(MODULE_ROWS));
    expect(alerts()).toContain(CAVEAT_HEAD);
    expect(alerts()).toContain('Request failed (504)');
    // The cost, not a hedge: the button the operator reaches for is chosen by the badge.
    expect(alerts()).toContain('switches that module for every user of this workspace from a badge the server has not confirmed');
    expect(alerts()).not.toContain('Failed to load');
    expect(alerts()).not.toMatch(/out of date|something went wrong|some data/i);
  });

  it('sits ABOVE the cards it did not replace', () => {
    mount(refusedRefresh(MODULE_ROWS));
    const alert = screen.getByRole('alert');
    const grid = screen.getByText('Desk Phone Sync').closest('.cursor-pointer') as HTMLElement;
    expect(alert.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('over a last read that held nothing, it keeps the honest sentence AND adds the caveat', () => {
    // `stale` means the read DID answer once, so the absence is its answer — the sentence
    // survives here and only here, and the banner is what separates it from "I could not check".
    mount(refusedRefresh(EMPTY_ROWS));
    expect(screen.getByText('No modules in this category')).toBeTruthy();
    expect(alerts()).toContain('the last read');
    expect(alerts()).not.toContain('Failed to load');
  });

  it('binds the banner to this read, so Try again re-fetches the modules and nothing else', () => {
    const result = refusedRefresh(MODULE_ROWS);
    mount(result);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    // Post-write refresh is `load()`'s job; a banner may not launder it into a retry.
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });

  it('repeats the cost inside the modal, where the map actually goes out', () => {
    mount(refusedRefresh(MODULE_ROWS));
    openCard('Desk Phone Sync');
    expect(screen.getByText(/This card is the last read/)).toBeTruthy();
    expect(screen.getByText(/Save Settings or Install sends[\s\S]*configuration in the fields above/)).toBeTruthy();
    // and not a word of it when nothing is stale
    cleanup();
    mount(ok(MODULE_ROWS));
    openCard('Desk Phone Sync');
    expect(screen.queryByText(/This card is the last read/)).toBeNull();
  });

  it('prints a reason when the refusal has no message, and never prints undefined', () => {
    mount(refusedRefresh(MODULE_ROWS, ''));
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
    cleanup();
    mount(unread(''));
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
  });
});

describe('a read that never answered is an outage, and not an empty workspace (#2872)', () => {
  it('keeps #2829\'s channel and says the grid is the failure, not the tenant\'s modules', () => {
    mount(unread());
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alerts()).toContain('Failed to load the modules for this workspace: Request failed (500)');
    expect(alerts()).toContain(OUTAGE_TAIL);
    expect(claimsOutsideAlerts(/No modules in this category/)).toHaveLength(0);
    expect(claimsOutsideAlerts(/Try selecting a different category/)).toHaveLength(0);
    expect(alerts()).not.toContain('last read');
  });

  it('withholds every figure the failed read never established', () => {
    mount(unread());
    // No cards, so nothing derived off `modules` may print: no price, no feature count, no
    // badge, no free/paid split.
    expect(screen.queryByText('$29')).toBeNull();
    expect(screen.queryByText('Free')).toBeNull();
    expect(screen.queryByText('Installed')).toBeNull();
    expect(screen.queryByText('Disabled')).toBeNull();
    expect(screen.queryByText(/\+\d+ more features/)).toBeNull();
    expect(document.querySelectorAll('.cursor-pointer')).toHaveLength(0);
  });

  it('offers no toggle over a workspace it never read (epic rule #1)', () => {
    mount(unread());
    // Every write on this page opens from a card, so a read that never answered renders no
    // button at all — and the ones that do exist in the tree are gated regardless.
    expect(document.querySelectorAll('.cursor-pointer')).toHaveLength(0);
    expect(offered(/Install Module/i)).toBe(false);
    expect(offered(/^Disable$/)).toBe(false);
    expect(offered(/Save Settings/i)).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('re-runs the read that failed, through the banner\'s own button', () => {
    const result = unread();
    mount(result);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });
});

describe('the two channels stay distinguishable, and loading is neither (#2872)', () => {
  it('the same flag with data kept is never announced as an outage', () => {
    mount(refusedRefresh(MODULE_ROWS));
    const kept = alerts();
    cleanup();
    mount(unread());
    const outage = alerts();
    expect(kept).not.toBe(outage);
    expect(kept).toMatch(/last read/);
    expect(kept).not.toMatch(/Failed to load/);
    expect(outage).toMatch(/Failed to load/);
    expect(outage).not.toMatch(/last read/);
  });

  it('a read still in flight is a wait, prints no alert and asserts nothing about modules', () => {
    registry.byUrl = { [MODULES]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() } };
    wrapped(<ModulesPage />);
    expect(alerts()).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(claimsOutsideAlerts(/No modules in this category/)).toHaveLength(0);
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(6);
  });

  it('a slow first read is not the outage arm either, and the outage never speaks for it', () => {
    // `isLoading` is true only before the first answer, so it can never stand in for
    // `modulesFailed` — the two arms below are unreachable while it is up.
    registry.byUrl = { [MODULES]: { data: undefined, error: new Error('Request failed (500)'), isLoading: true, refetch: vi.fn() } };
    wrapped(<ModulesPage />);
    expect(alerts()).toBe('');
    expect(claimsOutsideAlerts(/No modules in this category/)).toHaveLength(0);
  });
});

describe('rule #1: what each read is allowed to write, measured against the body it sends', () => {
  it('a refused refresh keeps the toggle, and the body still names one module', async () => {
    mount(refusedRefresh(MODULE_ROWS));
    openCard('Desk Phone Sync');
    expect(offered(/^Disable$/), 'the outage gate leaked onto the stale read').toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Disable$/ }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    // route.ts:55-60 dispatches on this single id; no whole-workspace map is accepted.
    expect(bodies[0]).toEqual({ module_id: 'm-voice', action: 'disable' });
    expect(alerts()).not.toContain('Failed to load');
  });

  it('sends the settings map this page is holding, which is why the modal says so', async () => {
    mount(refusedRefresh(MODULE_ROWS));
    openCard('Desk Phone Sync');
    fireEvent.change(screen.getByDisplayValue('sip.test'), { target: { value: 'sip2.test' } });
    fireEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    // The untouched field is the last read's value — registry.ts:392-400 writes this map
    // over the column with no precondition, so a token rotated since the last read goes back.
    expect(bodies[0]).toEqual({
      module_id: 'm-voice', action: 'update_settings',
      settings: { gateway: 'sip2.test', access_token: 'token-from-last-read' },
    });
  });

  it('a healthy read writes the same single module, with no caveat in the way', async () => {
    mount(ok(MODULE_ROWS));
    openCard('Fax Relay');
    expect(offered(/Install Module/i)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /install module/i }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ module_id: 'm-fax', settings: {} });
    expect(alerts()).toBe('');
  });

  it('reads the route and the registry, so the gates above have evidence behind them', () => {
    const ROOT = process.cwd();
    const route = readFileSync(join(ROOT, 'app/api/tenant/modules/route.ts'), 'utf8');
    const registrySrc = readFileSync(join(ROOT, 'lib/modules/registry.ts'), 'utf8');

    // GET: one row per catalogued module, status taken from the tenant's own row.
    expect(route).toMatch(/const merged = all\.map\(m =>/);
    expect(route).toMatch(/status: inst\?\.status \?\? 'available'/);
    expect(route).toMatch(/return NextResponse\.json\(\{ data: merged \}\)/);
    // POST and PATCH each address one `module_id` — no body form takes the whole map.
    expect(route).toMatch(/const \{ module_id, settings = \{\} \} = await readJsonBody\(req\)/);
    expect(route).toMatch(/const \{ module_id, action, settings \} = await readJsonBody\(req\)/);
    expect(route).not.toMatch(/readJsonBody\(req\)[\s\S]{0,200}?\bmodules\b\s*:/);
    // install re-reads server state before writing (the precondition that lets it stay open) …
    expect(registrySrc).toMatch(/const gate = await ModuleRegistry\.checkPlanGate\(tenantId, moduleId\);\s*\n\s*if \(!gate\.ok\) return gate;/);
    // … and then replaces that module's settings map regardless of what the row holds now.
    expect(registrySrc).toMatch(/set: \{\s*\n\s*status: 'active',\s*\n\s*settings,/);
    // disable / update_settings: unconditional UPDATE of the addressed row, no re-read.
    expect(registrySrc).toMatch(/\.set\(\{ status: 'disabled', updatedAt: new Date\(\) \}\)/);
    expect(registrySrc).toMatch(/\.set\(\{\s*\n\s*settings,/);
    // The optimistic-concurrency field two merged slices found inert is not even accepted
    // here, so a guard would have nothing to compare — for the owner, with the version the
    // GET already returns.
    expect(route + registrySrc).not.toMatch(/expectedUpdatedAt|_updated_at/);
    expect(route).toMatch(/installed_at: inst\?\.installed_at \?\? null/);
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/modules/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the two states apart and moves the outage arm off the emptiness test', () => {
    const s = src();
    expect(s, 'the page never separates the outage from a refused refresh')
      .toMatch(/const modulesFailed = Boolean\(modulesError\) && !data;/);
    expect(s, 'the page keeps the cards without calling them the last read')
      .toMatch(/const modulesStale = Boolean\(modulesError\) && Boolean\(data\);/);
    expect(s, 'the page prints a reason that can be undefined')
      .toMatch(/const modulesReason = modulesError\?\.message \|\| 'no response from the server';/);
    // The base asked the bare flag only inside the empty branch; both arms are gone.
    expect(s, 'the outage is back on the bare error flag').not.toMatch(/modulesError\s*\?\s*</);
    expect(s, 'the outage arm is not gated on `modulesFailed`').toMatch(/\) : modulesFailed \? \(/);
    expect(s, 'the caveat is not gated on `modulesStale`').toMatch(/\{modulesStale && \(/);
    expect(s, 'the empty sentence is not gated on the refusal').toMatch(/\) : filtered\.length === 0 \? \(/);
  });

  it('pins both banners above what they qualify, and each to its own refetch', () => {
    const s = src();
    const caveatAt = s.indexOf('{modulesStale && (');
    const outageAt = s.indexOf(') : modulesFailed ? (');
    const emptyAt = s.indexOf(') : filtered.length === 0 ? (');
    const rowsAt = s.indexOf('{filtered.map(mod =>');
    expect(caveatAt, 'no caveat banner').toBeGreaterThan(-1);
    expect(outageAt, 'no outage banner').toBeGreaterThan(-1);
    // The refused refresh speaks from above the cards it did not replace.
    expect(caveatAt, 'the caveat is no longer above the cards').toBeLessThan(rowsAt);
    expect(caveatAt, 'the caveat is no longer above the empty sentence').toBeLessThan(emptyAt);
    expect(outageAt, 'the outage arm no longer precedes the empty sentence').toBeLessThan(emptyAt);
    // …and the modal repeats it above the buttons that write.
    const modalAt = s.indexOf('This card is the last read');
    expect(modalAt, 'the modal stopped naming its own staleness').toBeGreaterThan(-1);
    expect(modalAt, 'the modal caveat moved below the buttons it warns about')
      .toBeLessThan(s.indexOf('disabled={saving || modulesFailed}'));
    expect(s, 'a banner lost its own refetch').not.toMatch(/onRetry=\{[^}]*invalidateQueries/);
    expect((s.match(/onRetry=\{\(\) => void refetchModules\(\)\}/g) ?? []).length,
      'a banner retries someone else\'s read').toBe(2);
    expect(s, 'a modal caveat started quoting the other read').not.toMatch(/onRetry=\{[^}]*refetch(?!Modules)/);
  });

  it('gates each write control on the read that never answered, and only on it', () => {
    const s = src();
    for (const gate of [
      /disabled=\{saving \|\| modulesFailed\}/,
      /disabled=\{modulesFailed\}/,
      /disabled=\{installing === selected\.id \|\| modulesFailed\}/,
    ]) {
      expect(s, `a write control lost its outage gate (${gate.source})`).toMatch(gate);
    }
    expect(s, 'the toggle started refusing a read that answered').not.toMatch(/disabled=\{[^}]*modulesStale/);
    expect(s, 'the modal stopped being reachable only from a card')
      .toMatch(/selected\.status === 'active' \? \(/);
    // #2829's guard is a screen, not a parser: keep the bindings it reads intact.
    expect(s).toMatch(/error: modulesError, refetch: refetchModules/);
    expect(s).toMatch(/<InlineErrorState/);
  });

  it('keeps the refusal\'s own message in front of the operator and hides no server internals', () => {
    const noComments = src().replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
    const printed: string[] = [];
    for (const m of noComments.matchAll(/message=\{`([^`]*)`\}/g)) printed.push(m[1]);
    const modal = noComments.match(/This card is the last read[\s\S]*?workspace\./);
    expect(modal, 'the modal caveat left the source').toBeTruthy();
    printed.push(modal![0]);
    // Tailwind class lists are not operator copy; the words a person reads are. Two banners
    // plus the modal's line — a count here is a tripwire, not a claim: the guard run below
    // is what proves the screen still works.
    expect(printed.length, 'the operator-copy audit is measuring something other than the three failure lines').toBe(3);
    for (const piece of printed) {
      expect(piece, 'a banner stopped quoting the refusal').toMatch(/\{modulesReason\}/);
      expect(piece, 'the page typed a source path into operator copy').not.toMatch(/app\//);
      expect(piece, 'the page typed a file and line into operator copy').not.toMatch(/\.tsx?:\d/);
      expect(piece, 'the page said "route" to the operator').not.toMatch(/\broute\b/i);
      expect(piece, 'the page said "endpoint" to the operator').not.toMatch(/\bendpoint\b/i);
      expect(piece, 'the page said "status code" to the operator').not.toMatch(/status code/i);
      expect(piece, 'the page typed a status code into operator copy').not.toMatch(/\b\d{3}\b/);
      expect(piece, 'the page hedged instead of naming the loss')
        .not.toMatch(/may be out of date|may not be reflected|some data|something went wrong/i);
    }
    expect(printed.join(' '), 'a banner paraphrased the refusal away').not.toMatch(/the server did not answer/);
  });

  it('never retries by throwing the document away', () => {
    const s = src();
    expect(s, 'a banner reloads the page instead of the read').not.toMatch(/location\.reload|window\.location|document\.location|globalThis\.location/);
    expect(s, 'the read retry went through the query cache invalidation path')
      .not.toMatch(/onRetry=\{[^}]*invalidateQueries/);
    // the post-write refresh stays, and stays a refresh rather than a retry
    expect(s).toMatch(/const load = \(\) => queryClient\.invalidateQueries\(\{ queryKey: MODULES_QUERY \}\)/);
  });

  it('keeps #2829\'s guard green, with the baseline still empty', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files, 'a page belongs on the baseline only if a reviewed PR says why').toEqual([]);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('is not something the guard could have caught anyway', async () => {
    // The guard asks one question — does a page that prints "there are none" also bind an
    // error and render some failure affordance — and this page answered it before this
    // slice as well as after, because its empty sentence sits in a JSX block the screen
    // does not read as an assertion. The lie is in WHICH arm fires and in what the buttons
    // do, neither of which a grep-shaped screen sees. Every rewind below stays invisible.
    const { inspect } = await import('file://' + join(ROOT, 'scripts/check-panel-error-state.mjs'));
    const s = src();
    expect(inspect(FILE, s).offends, 'the fixed page itself offends the guard').toBe(false);

    const rewinds: Record<string, string> = {
      // The base: one flag, consulted only under the emptiness test. A refused refresh now
      // hides the caveat, and an empty last read gets the outage sentence.
      'collapsed back onto the bare flag': s
        .replace('{modulesStale && (', '{modulesError && (')
        .replace(') : modulesFailed ? (', ') : modulesError ? (')
        .replace(/const modulesFailed = Boolean\(modulesError\) && !data;\n/, '')
        .replace(/const modulesStale = Boolean\(modulesError\) && Boolean\(data\);\n/, ''),
      // The other wrong answer: refusing to act on a read that did answer, which is the
      // state the operator is in right after their own save.
      'toggle blocked on the stale read': s.replace('disabled={saving || modulesFailed}', 'disabled={saving || modulesStale}'),
      // The caveat sentence deleted while the split stays: the cards look current again.
      'caveat said nothing': s.replace(CAVEAT_HEAD, 'Loading the modules'),
    };

    for (const [name, rewind] of Object.entries(rewinds)) {
      expect(rewind, `${name}: the split changed spelling, update this check`).not.toBe(s);
      expect(inspect(FILE, rewind).offends, `${name} would be visible to the guard`).toBe(false);
    }

    // And the screen is not inert on this file: give it a sentence it does read, with the
    // affordance taken away, and it bites.
    const planted = s
      .replace('No modules in this category', 'No modules configured')
      .replace(/InlineErrorState/g, 'PlainNotice');
    expect(planted).not.toBe(s);
    expect(inspect(FILE, planted).offends, 'the guard stopped seeing this page entirely').toBe(true);
  });

  it('stays inside the line ceiling the guard allows', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
