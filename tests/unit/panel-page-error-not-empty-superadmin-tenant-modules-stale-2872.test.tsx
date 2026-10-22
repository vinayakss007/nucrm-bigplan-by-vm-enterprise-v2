// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/superadmin/tenants/[id]/modules/page.tsx`: the tenant-module switchboard read the
 * workspace's modules and turned a failure into a confident zero.
 *
 * The base bound no `error`:
 *
 *     const { data, isLoading, refetch } = useApiQuery<ModulesResponse>(…);
 *     const modules = data?.data ?? [];
 *     const plan = data?.plan ?? 'free';
 *     …
 *     <span>{plan}</span> · {totalEnabled}/{modules.length} active
 *     … {loading ? skeletons : <cards from modules/>}
 *
 * So a read that never answered (a 500, a dead pool) fell through the `loading ? … : <cards>` ternary
 * with `modules = []` and `plan = 'free'`: the header announced "Plan: free · 0/0 active" and the body
 * drew nothing — an unread tenant reported as a free-plan tenant with no modules, on the page whose
 * buttons install and disable modules for that tenant. `useApiQuery` also keeps `data` through a refused
 * revalidation of a read that succeeded, and this page invalidates its own key after every toggle
 * (`queryClient.invalidateQueries({ queryKey })` in `toggleMutation.onSuccess`), so the ordinary state
 * after the operator flips a switch is kept cards with the fresh answer refused — and the base said
 * nothing about it.
 *
 * Per the house shape: `failed = Boolean(modulesError) && !data` takes the grid out for an outage banner;
 * `stale = Boolean(modulesError) && Boolean(data)` keeps every card, badge and figure and adds the caveat
 * (the toggle stays reachable — flipping a module you can see is the operator's call); the derived plan
 * and the `x/y active` count print `—` while the read has not answered, never a fabricated `free`/`0`.
 *
 * RED AT BASE — measured with the page file rewound to origin/main and this file as committed:
 * **8 failed | 7 passed (15)**. With the fix: **15 passed (15)**. The seven that pass at base are the
 * controls this slice must not regress: both answered reads (cards with a real plan, and an honest
 * "0/0 active" empty read), the stale-toggle-still-writes-one-module reachability check, the in-flight
 * loading state, and the gate/line-ceiling/overlap ratchets. The eight that fail are the kept-cards-under-
 * a-refusal trio that grew a caveat, both never-answered outages (the base rendered "Plan: free · 0/0
 * active" for an unread tenant), the source/guard rewinds that pin the split the base did not have.
 *
 * Fixtures are documentation-only (RFC 2606 `.test` names; TEST-NET-style ids).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

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
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'tn-00000000-0000-4000-8000-000000000000' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import TenantModulesPage from '@/app/superadmin/tenants/[id]/modules/page';

const MODULES_URL = '/api/superadmin/tenants/tn-00000000-0000-4000-8000-000000000000/modules';

const ROWS = {
  plan: 'growth',
  data: [
    { id: 'm-voice', name: 'Desk Phone Sync', category: 'integration', status: 'active', planAllowed: true, description: 'Calls logged', features: ['a', 'b', 'c', 'd', 'e'] },
    { id: 'm-fax', name: 'Fax Relay', category: 'automation', status: 'available', planAllowed: true, description: 'Archive fixtures', features: [] },
  ],
};
const EMPTY_ROWS = { plan: 'growth', data: [] };

const ok = (data: unknown = ROWS): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const unread = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const refusedRefresh = (data: unknown = ROWS, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const mute = (data?: unknown): QueryResult => ({
  data, error: Object.assign(new Error(), { status: 502 }), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const claimsOutsideAlerts = (re: RegExp) =>
  screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
const offered = (name: RegExp) => {
  const el = screen.queryByRole('button', { name }) as HTMLButtonElement | null;
  return el !== null && el.disabled === false;
};

let client: QueryClient;
let bodies: Record<string, unknown>[] = [];
function mount(result: QueryResult) {
  registry.byUrl = { [MODULES_URL]: result };
  cleanup();
  return render(<QueryClientProvider client={client}><TenantModulesPage /></QueryClientProvider>);
}

beforeEach(() => {
  registry.byUrl = {};
  bodies = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(client, 'invalidateQueries');
  globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? '{}'));
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
  }) as unknown as typeof fetch;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('a read that answered shows the plan and the count (#2872)', () => {
  it('renders the cards, their badges and the header tally, and says nothing about failure', () => {
    mount(ok());
    expect(screen.getByText('Desk Phone Sync')).toBeTruthy();
    expect(screen.getByText('Fax Relay')).toBeTruthy();
    expect(document.body.textContent).toContain('growth');
    expect(document.body.textContent).toContain('1/2 active');
    expect(alerts()).toBe('');
  });

  it('says the tenant has no modules when that is what a successful read returned', () => {
    mount(ok(EMPTY_ROWS));
    expect(screen.getByText('Tenant Modules')).toBeTruthy();
    expect(document.body.textContent).toContain('0/0 active');
    expect(alerts()).toBe('');
  });
});

describe('a refused refresh keeps the cards and says what it cost (#2872)', () => {
  it('leaves every card, badge and figure on screen under the caveat', () => {
    mount(refusedRefresh());
    expect(screen.getByText('Desk Phone Sync')).toBeTruthy();
    expect(screen.getByText('Fax Relay')).toBeTruthy();
    // a kept read counted these, so they stay numbers, not dashes.
    expect(document.body.textContent).toContain('1/2 active');
    expect(alerts()).toContain('modules below and their status badges are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(claimsOutsideAlerts(/Failed to load this tenant's modules/)).toEqual([]);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('keeps the toggle usable over a last read, and its body names one module', async () => {
    mount(refusedRefresh());
    expect(offered(/^Install$/), 'the outage gate leaked onto the stale read').toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Install$/ }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ module_id: 'm-fax' });
    expect(alerts()).not.toContain('Failed to load');
  });

  it('retries only its own read and issues no write', () => {
    const read = refusedRefresh();
    mount(read);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
    // a caveat's button refreshes the read; it does not launder a toggle into a retry.
    expect(bodies).toHaveLength(0);
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });

  it('a messageless refusal names the server, never undefined', () => {
    mount(mute(ROWS));
    expect(alerts()).toContain('the last read: no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
  });
});

describe('a read that never answered is an outage, not an empty tenant (#2872)', () => {
  it('keeps the outage off the "there are none" story and withholds every derived figure', () => {
    const read = unread('Request failed (500)');
    mount(read);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alerts()).toContain(`Failed to load this tenant's modules: Request failed (500)`);
    expect(alerts()).toContain('this read never answered');
    expect(alerts()).not.toContain('last read');
    // No cards, and nothing derived off the unread read may print — no fabricated `free`, no `0/0`.
    expect(claimsOutsideAlerts(/^Free$/i)).toEqual([]);
    expect(document.body.textContent).not.toContain('0/0 active');
    expect(document.body.textContent).toContain('—');
    expect(screen.queryByText('Desk Phone Sync')).toBeNull();
    expect(offered(/^Install$/)).toBe(false);
  });

  it('the outage retry re-runs the read that failed and issues no write', () => {
    const read = unread();
    mount(read);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
    expect(bodies).toHaveLength(0);
    expect(client.invalidateQueries).not.toHaveBeenCalled();
  });

  it('a messageless outage prints the server sentence, never undefined', () => {
    mount(mute());
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
  });
});

describe('loading is neither channel (#2872)', () => {
  it('an in-flight read shows skeletons, no alert, and dashes for the count', () => {
    registry.byUrl = { [MODULES_URL]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() } };
    cleanup();
    render(<QueryClientProvider client={client}><TenantModulesPage /></QueryClientProvider>);
    expect(alerts()).toBe('');
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(6);
    expect(claimsOutsideAlerts(/Failed to load/)).toEqual([]);
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/superadmin/tenants/[id]/modules/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('binds the read error and splits failed / stale, with a dash for the unanswered count', () => {
    const s = src();
    expect(s).toMatch(/error: modulesError, refetch/);
    expect(s).toMatch(/const failed = Boolean\(modulesError\) && !data;/);
    expect(s).toMatch(/const stale = Boolean\(modulesError\) && Boolean\(data\);/);
    expect(s).toMatch(/modulesError\?\.message \|\| 'no response from the server'/);
    expect(s, 'the outage arm is not gated on `failed`').toMatch(/\) : failed \? \(/);
    expect(s, 'the caveat is not gated on `stale`').toMatch(/\{stale && \(/);
    expect(s, 'the plan is fabricated as `free` again').toMatch(/data \? \(data\.plan \?\? 'free'\) : '—'/);
    expect(s, 'the active count is zeroed instead of dashed').toMatch(/data \? `\$\{totalEnabled\}\/\$\{modules\.length\} active` : '—'/);
    expect(s).toMatch(/<InlineErrorState/);
  });

  it('keeps the toggle reachable over a last read, and only gates on the outage', () => {
    const s = src();
    expect(s, 'the toggle started refusing a read that answered').not.toMatch(/disabled=\{[^}]*stale/);
  });

  it('is a class the guard cannot see, and re-runs it green', async () => {
    const { inspect } = await import('file://' + join(ROOT, 'scripts/check-panel-error-state.mjs'));
    const s = src();
    expect(inspect(FILE, s).offends, 'the fixed page offends the guard').toBe(false);
    const rewinds: Record<string, string> = {
      'collapsed onto the bare flag': s
        .replace('{stale && (', '{Boolean(modulesError) && (')
        .replace(') : failed ? (', ') : Boolean(modulesError) ? ('),
    };
    for (const [name, rewind] of Object.entries(rewinds)) {
      expect(rewind, `${name}: the split changed spelling`).not.toBe(s);
      expect(inspect(FILE, rewind).offends, `${name} would be visible to the guard`).toBe(false);
    }
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files).toEqual([]);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('stays inside the line ceiling', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
  });

  it('leaves this page to one #2872 suite', () => {
    const mine = 'panel-page-error-not-empty-superadmin-tenant-modules-stale-2872.test.tsx';
    const speakers = readdirSync(join(ROOT, 'tests/unit'))
      .filter((f) => f.endsWith('.test.tsx') && f !== mine && /2872/.test(f))
      .filter((f) => /superadmin\/tenants\/\[id\]\/modules\/page/.test(readFileSync(join(ROOT, 'tests/unit', f), 'utf8')));
    expect(speakers, `${mine} is not the only #2872 suite on this page`).toEqual([]);
  });
});
