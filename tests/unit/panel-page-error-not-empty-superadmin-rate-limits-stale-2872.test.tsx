// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/superadmin/rate-limits/page.tsx`: a refresh that was refused while the
 * configuration stayed in the form must not be announced as a read that never happened.
 *
 * This page already answered a read that never happened — #2829 put the outage sentence at
 * what was then `:206`, gated on the bare `rlError`. That flag cannot tell the two states
 * apart, and TanStack Query keeps `data` through the second one (`lib/query/client.tsx:46-53`:
 * `retry: 2`, `staleTime: 30_000`, `refetchOnWindowFocus: false`). On this page the second
 * state is not exotic: all four writes (`saveGlobalMutation`, `savePlanMutation`,
 * `resetMutation`, `toggleAdminMutation`) end in `invalidateQueries` on the config key, so
 * the refused reload lands the moment the operator presses Save — and #2829's own banner
 * then announced "Could not load the rate-limit configuration" above a configuration the
 * page was still holding and still letting them save.
 *
 * What the route actually does, which is what the write gates are decided from
 * (`app/api/superadmin/rate-limits/route.ts`):
 *   - GET (:31-86) returns `{ data: { globalDefaults, plans, superAdmins, endpoints } }` —
 *     ONE read feeds all four sections of the page, so an unread read unseeds the form,
 *     empties the plan list and empties the roster at the same time;
 *   - `update_global` (:98-110) upserts `system_settings.global_rate_limits` with
 *     `JSON.stringify(body.rateLimits)` — the whole map, no read-back, no precondition;
 *   - `update_plan_limits` (:113-127) replaces `plans.rateLimitConfig` for `body.planId`.
 *     The `concurrencyGuard` at :116-120 only runs if the body carries `expectedUpdatedAt`,
 *     and this page never sends one;
 *   - `toggle_super_admin_unlimited` (:129-136) writes `body.unlimited` verbatim, and the
 *     page computes it as `!current` off the roster it read;
 *   - `reset_to_defaults` (:138-145) sets `rateLimitConfig = {}` for `body.planId`.
 *
 * So the writes push whole server-side maps, and the banner says that in operator words
 * instead of the usual "may be out of date". Fixtures are documentation-only
 * (`corp.test`, RFC 5737-style addresses, seeded-shaped nil-variant UUIDs).
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
// The page awaits `confirmThen(...)` before resetting; auto-confirm it.
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => Promise.resolve(fn()),
  ConfirmDialog: () => null,
}));

import toast from 'react-hot-toast';
import RateLimitsPage from '@/app/superadmin/rate-limits/page';

const RATE_LIMITS = '/api/superadmin/rate-limits';

const PLAN_ID = '40000000-0000-0000-0000-000000000002';
const ADMIN_ID = '60000000-0000-0000-0000-000000000001';

/** The shape GET returns (route.ts:65-82): endpoints come from the server's own table, so
 *  an unread read leaves the form with no field to type in at all. */
const CONFIG = {
  data: {
    globalDefaults: { api: 120, ai: 30 },
    plans: [{ id: PLAN_ID, name: 'Growth', slug: 'growth', rateLimits: { api: 300, ai: 50 } }],
    superAdmins: [{ id: ADMIN_ID, email: 'ops@corp.test', name: 'Ada Operator', unlimitedRateLimit: true }],
    endpoints: [
      { key: 'api', label: 'API Requests', window: 60, windowLabel: 'per minute' },
      { key: 'ai', label: 'AI Features', window: 3600, windowLabel: 'per hour' },
    ],
  },
};

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

const OUTAGE = 'Could not load the rate-limit configuration — the limits shown below are not the live ones.';

const button = (name: RegExp) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;
const offered = (name: RegExp) => {
  const el = button(name);
  return el !== null && el.disabled === false;
};

let client: QueryClient;
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};
const mount = (result: QueryResult) => {
  registry.byUrl = { [RATE_LIMITS]: result };
  return wrapped(<RateLimitsPage />);
};

/** Records what each PUT actually carries, so "the write pushes the whole map" is measured
 *  rather than assumed. */
let putBodies: Record<string, unknown>[] = [];
function stubPut(payload: unknown = { ok: true }) {
  globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
    putBodies.push(JSON.parse(init?.body ?? '{}'));
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  registry.byUrl = {};
  putBodies = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(client, 'invalidateQueries');
  stubPut();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the healthy and genuinely-empty reads keep their own shapes (#2872)', () => {
  it('answers with the configuration, the roster and no failure state', () => {
    mount(ok(CONFIG));
    expect(screen.getByText('API Requests')).toBeTruthy();
    expect(screen.getByText('AI Features')).toBeTruthy();
    expect(screen.getByDisplayValue('120')).toBeTruthy();
    expect(screen.getByText('ops@corp.test')).toBeTruthy();
    expect(screen.getByRole('button', { name: /unlimited/i })).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.queryByText('No super admin users found')).toBeNull();
  });

  it('says "none" when the roster genuinely came back empty, and nothing else', () => {
    mount(ok({ data: { ...CONFIG.data, superAdmins: [] } }));
    expect(screen.getByText('No super admin users found')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says "none" for a roster that came back empty even while the refresh is refused', () => {
    // `stale` means the read DID answer once, so the absence is its answer — the claim
    // survives here and only here.
    mount(refusedRefresh({ data: { ...CONFIG.data, superAdmins: [] } }));
    expect(screen.getByText('No super admin users found')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the rate-limit configuration');
    expect(alerts()).not.toContain(OUTAGE);
  });
});

describe('a read that never answered is an outage, and not a configuration (#2872)', () => {
  it('keeps #2829\'s sentence word for word, and stops calling it a bare error flag', () => {
    mount(unread());
    expect(screen.getByRole('alert').textContent).toContain(OUTAGE);
    expect(screen.getByText('Rate Limit Configuration')).toBeTruthy();
    expect(alerts()).not.toContain('last read');
  });

  it('refuses to claim a roster that it never read', () => {
    // One `useApiQuery` feeds `superAdmins`, `plans`, `endpoints` and the defaults, so the
    // empty array here is the absence of an answer, not an answer of absence.
    mount(unread());
    expect(screen.queryByText('No super admin users found')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('offers no write over a form the read never seeded (epic rule #1)', () => {
    mount(unread());
    expect(offered(/save global defaults/i), 'Save Global Defaults is clickable over an unread read').toBe(false);
    expect(offered(/reset to global/i), 'Reset to Global is clickable over an unread read').toBe(false);
    // The plan tab holds the other two: with no `plans` there is no selection, and the
    // whole field block is unmounted — nothing to write back either way.
    fireEvent.click(screen.getByRole('button', { name: /per-plan overrides/i }));
    expect(offered(/save plan limits/i)).toBe(false);
    expect(offered(/reset to global/i)).toBe(false);
    expect(offered(/unlimited/i)).toBe(false);
    // And no field presents a live-looking number for a read that produced none.
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('re-runs the read that failed, through the banner\'s own button', () => {
    const result = unread();
    mount(result);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('a refused refresh keeps the configuration and says what it cost (#2872)', () => {
  it('leaves the limits on screen', () => {
    mount(refusedRefresh(CONFIG));
    expect(screen.getByText('API Requests')).toBeTruthy();
    expect(screen.getByDisplayValue('120')).toBeTruthy();
    expect(screen.getByText('ops@corp.test')).toBeTruthy();
    expect(screen.getByRole('button', { name: /unlimited/i })).toBeTruthy();
  });

  it('names this page\'s loss in operator words, and drops the outage sentence', () => {
    mount(refusedRefresh(CONFIG));
    expect(alerts()).toContain(
      'Could not refresh the rate-limit configuration, so the limits below are the last read: Request failed (504).',
    );
    // The cost, not a hedge: route.ts:98-110 and :113-127 replace whole maps.
    expect(alerts()).toContain('Saving now writes this whole map over whatever the server holds.');
    expect(alerts()).not.toContain(OUTAGE);
    expect(alerts()).not.toMatch(/out of date|something went wrong|route|endpoint|HTTP|500/i);
  });

  it('binds the banner to this read, so Try again re-fetches the configuration', () => {
    const result = refusedRefresh(CONFIG);
    mount(result);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the writes available over the last read, because the banner pays for them', () => {
    // The measurement says this is the right side to land on: the form holds the last read
    // plus the operator's own keystrokes, and disabling it would make the page unable to
    // do the one thing the operator came for. `failed`, not `stale`, is what blocks.
    mount(refusedRefresh(CONFIG));
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '999' } });
    expect(offered(/save global defaults/i), 'a refused refresh blocked the save it just un-seeded').toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /per-plan overrides/i }));
    // The plan overrides are the last read too (300, from the fixture), and `Reset to
    // Global` writes no view of the read at all — route.ts:138-145 just sets `{}`.
    expect(screen.getByDisplayValue('300')).toBeTruthy();
    expect(offered(/reset to global/i)).toBe(true);
    expect(offered(/unlimited/i)).toBe(true);
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '77' } });
    expect(offered(/save plan limits/i)).toBe(true);
    expect(alerts()).not.toContain(OUTAGE);
  });

  it('prints a reason when the refusal has no message', () => {
    mount(refusedRefresh(CONFIG, ''));
    expect(alerts()).toContain('no response from the server');
  });

  it('says at the roster what the toggle costs, and says it nowhere else', () => {
    // `toggle_super_admin_unlimited` (route.ts:129-136) writes `!current` computed off the
    // roster the page read, so the banner two sections up has to be repeated where the
    // switch actually is — and must not appear when nothing is stale.
    mount(refusedRefresh(CONFIG));
    expect(screen.getByText(/These toggles flip the value this page last read/)).toBeTruthy();
    cleanup();
    mount(unread());
    expect(screen.queryByText(/These toggles flip/)).toBeNull();
    cleanup();
    mount(ok(CONFIG));
    expect(screen.queryByText(/These toggles flip/)).toBeNull();
  });
});

describe('the refresh a save triggers is the ordinary way into that state (#2872)', () => {
  it('saves, invalidates, gets refused, and still shows the configuration it saved', async () => {
    const saved = {
      data: { ...CONFIG.data, globalDefaults: { ...CONFIG.data.globalDefaults, api: 999 } },
    };
    mount(ok(CONFIG));
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: /save global defaults/i }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Global defaults saved'));
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['superadmin', 'rate-limits'] });
    // Measured, not assumed: the body carries the entire map, so a save off an unread form
    // would write `{}` over every platform default (route.ts:100-108).
    expect(putBodies[0]).toEqual({ action: 'update_global', rateLimits: { api: 999, ai: 30 } });

    // The reload that key schedules is the one that comes back refused. Same form, same
    // roster — plus the banner that admits the server never confirmed it.
    registry.byUrl = { [RATE_LIMITS]: refusedRefresh(saved) };
    wrapped(<RateLimitsPage />);

    expect(screen.getByDisplayValue('999')).toBeTruthy();
    expect(screen.getByText('ops@corp.test')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the rate-limit configuration');
    expect(alerts()).not.toContain(OUTAGE);
    expect(screen.queryByText('No super admin users found')).toBeNull();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/superadmin/rate-limits/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the two states apart, and moves the outage arm off the bare flag', () => {
    const s = src();
    expect(s, 'the page never separates the outage from a refused refresh')
      .toMatch(/const failed = Boolean\(rlError\) && !rlData;/);
    expect(s, 'the page keeps the configuration without calling it the last read')
      .toMatch(/const stale = Boolean\(rlError\) && Boolean\(rlData\);/);
    expect(s, 'the page prints a reason that can be undefined')
      .toMatch(/const reason = rlError\?\.message \|\| 'no response from the server';/);
    // #2829's arm is no longer `{rlError && (`: it speaks for a read that never answered.
    expect(s, 'the outage sentence is back on the bare error flag').not.toMatch(/\{rlError && \(/);
    expect(s, 'the outage arm is not gated on `failed`').toMatch(/\{failed && \(\n[\s\S]*?not the live ones\."/);
    expect(s, 'the caveat names no loss').toMatch(
      /\{stale && \(\n[\s\S]*?the last read: \$\{reason\}[\s\S]*?writes this whole map/,
    );
  });

  it('audits every write and the roster claim against the read that drives them', () => {
    const s = src();
    expect(s, 'an empty roster may again be asserted about an unread read')
      .toMatch(/\{!failed && superAdmins\.length === 0 && <p[^>]*>No super admin users found/);
    for (const gate of [
      /disabled=\{!hasChanges \|\| saving === 'global' \|\| failed\}/,
      /disabled=\{!hasChanges \|\| saving === selectedPlan \|\| failed\}/,
      /disabled=\{saving === selectedPlan \|\| failed\}/,
    ]) {
      expect(s, `a write control lost its outage gate (${gate.source})`).toMatch(gate);
    }
    expect(s, 'the write gate drifted onto the stale read').not.toMatch(/disabled=\{[^}]*\|\| stale\}/);
    expect(s, 'the unlimited toggle is not flagged as reading the last roster')
      .toMatch(/\{stale && superAdmins\.length > 0 && \(\n\s*<p[^>]*>These toggles flip the value this page last read/);
    // `:197`'s whole-page early return is a third arm, and the order is the point:
    // `isLoading` is only true before the read answers for the first time, so it can never
    // stand in for `failed`, and the arms below are unreachable while it is up.
    const loadingLine = s.split('\n').find((l) => l.trim().startsWith('if (loading)')) ?? '';
    expect(loadingLine, 'the loading branch changed shape, update this check')
      .toMatch(/if \(loading\) return <div[^>]*>[^<]*<Loader2[^>]*\/>Loading rate limits\.\.\.<\/div>;/);
    expect(loadingLine, 'the loading screen started asserting about the configuration')
      .not.toMatch(/InlineErrorState|No super admin|last read|failed|stale/);
    expect(s.indexOf('if (loading) return')).toBeLessThan(s.indexOf('{failed && ('));
  });

  it('records what the route does, so the gates can be re-checked', () => {
    const s = src();
    expect(s, 'the page no longer says why each write is gated where it is')
      .toMatch(/update_global`?\s*\(:\d+-\d+\)[\s\S]*reset_to_defaults`?\s*\(:\d+-\d+\)/);
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
    // slice as well as after. Every rewind below keeps it answering: the lie lives in which
    // arm fires, and in what the buttons do, neither of which a grep-shaped screen sees.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const s = src();

    expect(inspect(FILE, s).offends, 'the fixed page itself offends the guard').toBe(false);

    const rewinds: Record<string, string> = {
      // #2829's banner back on the bare flag: a refused refresh hides nothing but says the
      // configuration was never read.
      'outage on any error': s
        .replace('{stale && (', '{rlError && (')
        .replace(/const stale = Boolean\(rlError\) && Boolean\(rlData\);\n/, ''),
      // The absence claim and the write gates back on the unseeded read.
      'no outage gate at all': s
        .replace('{failed && (', '{rlError && (')
        .replace('{!failed && superAdmins.length === 0', '{superAdmins.length === 0')
        .replace(/const failed = Boolean\(rlError\) && !rlData;\n/, ''),
      // The other wrong answer: refusing to write over the last read, which is the state
      // the operator is actually in after their own save.
      'writes blocked on stale': s
        .replace("saving === 'global' || failed}", "saving === 'global' || stale}")
        .replace(/saving === selectedPlan \|\| failed\}/g, 'saving === selectedPlan || stale}'),
    };

    for (const [name, rewind] of Object.entries(rewinds)) {
      expect(rewind, `${name}: the split changed spelling, update this check`).not.toBe(s);
      expect(inspect(FILE, rewind).offends, `${name} would be visible to the guard`).toBe(false);
    }
  });

  it('stays inside the line ceiling the guard allows', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
