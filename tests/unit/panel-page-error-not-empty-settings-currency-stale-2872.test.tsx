// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/currency/page.tsx`: the currency picker that answered a read which
 * never happened with a list of ten currencies and "Default: USD".
 *
 * One read — `['tenant','currency']` → `/api/tenant/currency` — and at base it bound **neither**
 * `error` nor `refetch`:
 *
 *     const { data, isLoading: loading } = useApiQuery(CURRENCY_QUERY, '/api/tenant/currency', { select });
 *     const currencyData = data?.data ?? EMPTY_CURRENCY;
 *     …
 *     {loading ? <skeletons/> : (<grid currencies={…}/>)}
 *
 * Two fallbacks sit between the read and the screen: `select` substitutes `DEFAULT_CURRENCIES` for
 * an empty list (page.tsx:57-66) and `?? EMPTY_CURRENCY` (:68, the constant at :44) substitutes a
 * whole payload. Both
 * run on `data` being what it is, so the page could not tell that nothing had been read: a
 * never-answered read rendered ten currency cards, a "Default: USD" badge and a `Set as default`
 * button on each of them, i.e. the outage was dressed as the most confident answer the page ever
 * gives. The other half of the accident is the routine one — all three of `retry: 2`,
 * `staleTime: 30_000` and `refetchOnWindowFocus: false` (`lib/query/client.tsx:46-58`) mean the
 * reload that `setDefault` itself schedules (`invalidateQueries`, page.tsx:120) hands the refused
 * refresh back WITH its data, and the page showed the old default and the old rates with no signal
 * that the server had refused to confirm either.
 *
 * `failed = Boolean(currencyError) && !data` is measured on the raw query value, never on
 * `currencyData`: TanStack only runs `select` on a payload that exists, so `data` is still
 * `undefined` when the read never answered, while `currencyData` is `?? EMPTY_CURRENCY` and so
 * always truthy. `failed` therefore owns the whole region — grid, rates and every write button are
 * unmounted, and the header's default is the `—` of rule #5 rather than USD. `stale` keeps them and
 * puts the caveat above them.
 *
 * Why the save stays live over `stale` (epic rule #1), read off `app/api/tenant/currency/route.ts`:
 *  - POST validates the code against the server's own `SUPPORTED_CURRENCIES` allowlist and refuses
 *    anything else (:94-101), so a click off a last read is still checked server-side;
 *  - it writes ONE key — `jsonb_set(COALESCE(settings,'{}'), '{default_currency}', …)` (:106-116) —
 *    so it cannot replace the settings blob, and the currency list and rates are never stored at
 *    all (GET recomputes them from `getSupportedCurrencies()` and the rate provider, :47-62);
 *  - it does NOT read the stored default back and takes no expected value, so the only precondition
 *    is that the tenant row still exists (:118). Last write wins, unseen.
 * That is the specific loss the banner and the line under the grid name — not "may be out of date".
 *
 * Fixtures are documentation-only. `undefined`/`null` never reach the copy: `${reason}` carries the
 * `|| 'no response from the server'` fallback, which the messageless case below measures.
 *
 * RED AT BASE — measured on `be35db54` (this branch's tip) with `app/tenant/settings/currency/page.tsx`
 * rewound to what main carries and this file as committed: **17 failed / 5 passed (22)**. Twelve of
 * the seventeen put the read in a state the class is about: the never-answered outage, where base
 * printed the ten built-in currencies, "Default: USD" and a live `Set as default` on each of them;
 * the messageless fallback, which printed `undefined`; the per-read retry; the refused refresh with
 * its rows kept and its cost named; the save that must stay live over that refresh; the empty rate
 * set stated as the read's own answer (at base that answer drew no sentence at all — the table was
 * simply hidden); the same claim under a refused refresh; the good → refused → good walk; and the
 * first-load arm, which at base already asserted "Default: USD" before anything had been read. The
 * other five are the source ratchets — the split bindings, the reason interpolated into BOTH arms,
 * the outage owning the whole region, the write gates, and the withheld dash. The 5 that pass at
 * base are the controls this slice must not regress: the healthy read saying nothing about
 * freshness, the guard-blindness case, the guard and baseline staying green, the line ceiling, and
 * this suite owning the page alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync } from 'node:fs';
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

// Deliberately a passthrough of the hook result, NOT a runner of `select`: the whole point of the
// outage cases is that the page's own fallbacks (`select` → DEFAULT_CURRENCIES, `?? EMPTY_CURRENCY`)
// must not be what decides whether the read answered.
vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
// The page toasts only from its write handler. Mocking the module is how this suite proves a READ
// failure never reaches that channel: the outage cases require the sentence in the panel's own
// subtree, where a four-second toast cannot leave a false answer behind.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import toast from 'react-hot-toast';
import CurrencyPage from '@/app/tenant/settings/currency/page';

const CURRENCY = '/api/tenant/currency';

/** An answered read: three currencies, EUR saved as the tenant's default, two rates. */
const READ = {
  data: {
    currencies: [
      { code: 'USD', name: 'US Dollar', symbol: '$' },
      { code: 'EUR', name: 'Euro', symbol: '\u20AC' },
      { code: 'INR', name: 'Indian Rupee', symbol: '\u20B9' },
    ],
    baseCurrency: 'USD',
    defaultCurrency: 'EUR',
    rates: { USD: 1, INR: 83.5 },
  },
};
/** The read that answered 200 with no rates — GET's own upstream-provider arm (route.ts:51-62). */
const NO_RATES = { data: { ...READ.data, rates: {} } };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
/** A read that never answered. `data` stays undefined, exactly as TanStack leaves it. */
const unread = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the payload is cached, the refresh was refused. */
const refusedRefresh = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const OUTAGE_HEAD = 'Failed to load the currency settings:';
const STALE_HEAD = 'Could not refresh the currency settings';

const button = (name: RegExp) => screen.queryByRole('button', { name }) as HTMLButtonElement | null;
const offered = (name: RegExp) => {
  const el = button(name);
  return el !== null && el.disabled === false;
};

/** Nothing the page builds out of an unread read may print its own placeholder. */
function expectNoPlaceholderLeak(view: ReturnType<typeof render>) {
  const text = view.container.textContent ?? '';
  expect(text, 'a placeholder leaked into the copy the page prints').not.toMatch(/\bundefined\b|\bnull\b/);
}

let client: QueryClient;
const tree = (node: ReactNode) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const mount = (result: QueryResult) => {
  registry.byUrl = { [CURRENCY]: result };
  return wrapped(<CurrencyPage />);
};

/** Records what `setDefault` posts, so "the write saves the code you clicked" is measured. */
let posts: unknown[] = [];
function stubPost(payload: unknown = { data: { defaultCurrency: 'INR' } }) {
  globalThis.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
    posts.push(JSON.parse(init?.body ?? '{}'));
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  registry.byUrl = {};
  posts = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(client, 'invalidateQueries');
  stubPost();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the answered reads keep their own shapes (#2872)', () => {
  it('shows the list, the saved default and the rates, and says nothing about freshness', () => {
    const view = mount(ok(READ));
    expect(screen.getByText('Euro')).toBeTruthy();
    expect(screen.getByText('Indian Rupee')).toBeTruthy();
    // The tenant's own choice is what is highlighted, not the rate basis (#1328).
    expect(screen.getByText('Default: EUR')).toBeTruthy();
    expect(screen.getAllByText('Default')).toHaveLength(1);
    expect(screen.getByText('1 USD = 83.5 INR')).toBeTruthy();
    expect(screen.getByText('Exchange Rates')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.queryByText(/came back with this list/)).toBeNull();
    expectNoPlaceholderLeak(view);
  });

  it('states the genuinely-empty rate set as the read\'s own answer, with no alert', () => {
    // GET returns 200 with `rates: {}` when the upstream provider throws, so "no rates" is a fact
    // about a read that answered — and it is stated where the cards are, not hidden behind them.
    const view = mount(ok(NO_RATES));
    expect(screen.getByText('Euro')).toBeTruthy();
    expect(screen.getByText(/No exchange rates came back with this list/)).toBeTruthy();
    expect(screen.queryByText('Exchange Rates')).toBeNull();
    expect(screen.queryByText(/1 USD =/)).toBeNull();
    expect(alerts()).toBe('');
    expectNoPlaceholderLeak(view);
  });
});

describe('a read that never answered is an outage, not a populated picker (#2872)', () => {
  it('retires the built-in currency list, the default and the rates, and quotes the reason', () => {
    const view = mount(unread('Request failed (500)'));
    // The ratchet: at base these three fallback answers were on screen under no caveat at all.
    expect(screen.queryByText('US Dollar')).toBeNull();
    expect(screen.queryByText('Indian Rupee')).toBeNull();
    expect(screen.queryAllByText(/Set as default/)).toHaveLength(0);
    expect(screen.queryAllByText('USD')).toHaveLength(0);
    expect(screen.queryByText('Exchange Rates')).toBeNull();
    // Rule #5: the derived default is the dash, never USD and never "none".
    expect(screen.getByText('Default: \u2014')).toBeTruthy();
    expect(screen.queryByText(/Default: USD/)).toBeNull();
    expect(alerts()).toContain(`${OUTAGE_HEAD} Request failed (500).`);
    expect(alerts()).toContain('the picker is withheld, not empty');
    expect(alerts()).not.toContain('last read');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expectNoPlaceholderLeak(view);
  });

  it('offers no write over a list the read never returned (epic rule #1)', () => {
    mount(unread());
    expect(offered(/Set as default/)).toBe(false);
    expect(screen.queryAllByRole('button', { name: /set as default/i })).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    // …and the cost line that belongs to a live save is not printed either.
    expect(screen.queryByText(/Set as default writes the code you click/)).toBeNull();
  });

  it('prints the server, not undefined, when the refusal carries no message', () => {
    const view = mount({
      data: undefined,
      error: Object.assign(new Error(), { status: 502 }),
      isLoading: false,
      refetch: vi.fn(),
    });
    expect(alerts()).toContain(`${OUTAGE_HEAD} no response from the server.`);
    expect(alerts()).not.toContain('undefined');
    expectNoPlaceholderLeak(view);
  });

  it('re-runs this read only, through the banner\'s own button', () => {
    const result = unread();
    mount(result);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    // No document reload, and no invalidation standing in for a per-read retry.
    expect(client.invalidateQueries).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('a refused refresh keeps the currencies and says exactly what it cost (#2872)', () => {
  it('leaves the list, the highlight and the rates on screen, under the last-read caveat', () => {
    const view = mount(refusedRefresh(READ));
    expect(screen.getByText('Euro')).toBeTruthy();
    expect(screen.getByText('Indian Rupee')).toBeTruthy();
    expect(screen.getByText('Default: EUR')).toBeTruthy();
    expect(screen.getByText('1 USD = 83.5 INR')).toBeTruthy();
    expect(screen.getByText('Exchange Rates')).toBeTruthy();
    expect(alerts()).toContain(
      'Could not refresh the currency settings, so the supported list, the highlighted default ' +
        'and the exchange rates are the last read: Request failed (504).',
    );
    // The loss, in operator words: route.ts:106-116 does not read the stored default back.
    expect(alerts()).toContain(
      "Setting a default now replaces the tenant's current one without this page having read it",
    );
    expect(alerts()).not.toContain(OUTAGE_HEAD);
    expect(screen.queryByText(/No exchange rates came back/)).toBeNull();
    expectNoPlaceholderLeak(view);
  });

  it('names no transport internal and hedges about nothing', () => {
    mount(refusedRefresh(READ));
    expect(alerts()).not.toMatch(
      /may be out of date|may not be reflected|some data|route|endpoint|status code|\.tsx|useApiQuery|page\.tsx/i,
    );
    expect(screen.getByText(/Set as default writes the code you click over the stored default/)).toBeTruthy();
  });

  it('keeps the save live over the last read, and posts the code that was clicked', async () => {
    mount(refusedRefresh(READ));
    // USD and INR are both non-default here, so the control is found through the card it sits on.
    const card = screen.getByText('Indian Rupee').closest('.admin-card') as HTMLElement;
    const setDefault = within(card).getByRole('button', { name: /set as default/i });
    // `stale`, not `failed`, is the state the operator is actually in: their own save triggered the
    // reload that was refused. Blocking here would refuse the thing they came to do.
    expect(setDefault.disabled).toBe(false);
    fireEvent.click(setDefault);
    await waitFor(() => expect(posts.length).toBe(1), { interval: 10 });
    expect(posts[0]).toEqual({ currency: 'INR' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Default currency set to INR'));
    expect(client.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tenant', 'currency'] });
    expect(alerts()).toContain(STALE_HEAD);
  });

  it('still states an empty rate set, because the last read really had none', () => {
    const view = mount(refusedRefresh(NO_RATES));
    expect(screen.getByText(/No exchange rates came back with this list/)).toBeTruthy();
    expect(alerts()).toContain(STALE_HEAD);
    expect(alerts()).not.toContain(OUTAGE_HEAD);
    expectNoPlaceholderLeak(view);
  });

  it('binds the banner to this read, so Try again re-fetches the currency list', () => {
    const result = refusedRefresh(READ);
    mount(result);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('walks the walk: a good read, a refused refresh, and a good read again', () => {
    mount(ok(READ));
    expect(alerts()).toBe('');

    registry.byUrl = { [CURRENCY]: refusedRefresh(READ) };
    wrapped(tree(<CurrencyPage />));
    expect(alerts()).toContain(STALE_HEAD);
    expect(screen.getByText('Indian Rupee')).toBeTruthy();

    registry.byUrl = { [CURRENCY]: ok(READ) };
    wrapped(tree(<CurrencyPage />));
    expect(alerts()).toBe('');
    expect(screen.getByText('Default: EUR')).toBeTruthy();
  });

  it('waits for the read it is waiting on, and claims nothing while it waits', () => {
    registry.byUrl = { [CURRENCY]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() } };
    const view = wrapped(<CurrencyPage />);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText('Indian Rupee')).toBeNull();
    // The skeleton must not be an answer either.
    expect(screen.queryByText('Default: USD')).toBeNull();
    expect(screen.getByText('Default: \u2014')).toBeTruthy();
    expectNoPlaceholderLeak(view);
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/settings/currency/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the one read apart, and measures both flags on the raw query value', () => {
    const s = src();
    expect(s, 'the page still refuses to look at its own error')
      .toMatch(/const \{ data, isLoading: loading, error: currencyError, refetch \} = useApiQuery/);
    expect(s, 'the outage flag is not "the read never answered"')
      .toMatch(/const failed = Boolean\(currencyError\) && !data;/);
    expect(s, 'the kept read is not called a last read')
      .toMatch(/const stale = Boolean\(currencyError\) && Boolean\(data\);/);
    expect(s, 'the page prints a reason that can be undefined')
      .toMatch(/const reason = currencyError\?\.message \|\| 'no response from the server';/);
    // The trap: `currencyData` is `?? EMPTY_CURRENCY`, so testing it would make `failed` unreachable.
    expect(s, 'a failure flag is computed off the post-`??` payload').not.toMatch(
      /const (failed|stale|hasRead) = Boolean\(currencyError\)( && )?(!?)currencyData/,
    );
    expect(s).toMatch(/const hasRead = Boolean\(data\);/);
  });

  it('interpolates the reason into BOTH arms instead of fixing a sentence', () => {
    const s = src();
    expect(s, 'the outage copy does not quote the reason').toMatch(
      /Failed to load the currency settings: \$\{reason\}/,
    );
    expect(s, 'the stale copy does not quote the reason').toMatch(/are the last read: \$\{reason\}/);
    expect(s, 'a frozen OUTAGE string is back in the module scope').not.toMatch(/^const OUTAGE =/m);
  });

  it('gives the outage arm the whole region, so the built-in list cannot answer for it', () => {
    const s = src();
    expect(s, 'the outage arm is not a branch of the render').toMatch(/\) : failed \? \(/);
    expect(s.indexOf(') : failed ? ('), 'the grid is rendered above the outage branch')
      .toBeLessThan(s.indexOf('currencies.map'));
    expect(s.indexOf('{stale && (')).toBeLessThan(s.indexOf('Currency Grid'));
    expect(s, 'the stale banner is not the InlineErrorState above the region it describes')
      .toMatch(/\{stale && \(\n[\s\S]*?<InlineErrorState/);
  });

  it('audits the write against the read, gating the outage and paying for the stale', () => {
    const s = src();
    expect(s, 'the save button lost its outage gate').toMatch(/disabled=\{saving \|\| failed\}/);
    expect(s, 'the handler lost its outage gate').toMatch(/if \(failed\) return;/);
    expect(s, 'a write is now blocked over a read that answered — re-check the route audit').not.toMatch(
      /disabled=\{[^}]*\|\| stale\}/,
    );
    expect(s, 'the cost of saving over a last read is not stated at the click').toMatch(
      /Set as default writes the code you click over the stored default/,
    );
    expect(s, 'the absence of rates is asserted without the read to support it').toMatch(
      /\{rateCount === 0 && \(/,
    );
  });

  it('dashes the derived default instead of defaulting it, and reloads nothing', () => {
    const s = src();
    expect(s, 'a derived figure is defaulted rather than withheld').toMatch(
      /const defaultDisplay = hasRead \? readDefault : '\\u2014';/,
    );
    expect(s).toMatch(/Default: \{defaultDisplay\}/);
    expect(s, 'a retry went back to reloading the document').not.toMatch(/location\.reload|window\.location\.href\s*=/);
    expect(s, 'the read failure moved into the fading channel').not.toMatch(/^\s*if \(currencyError\) toast\.error/m);
  });

  it('is a class the guard cannot see, before or after the split is rewound', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const s = src();
    expect(inspect(FILE, s).offends, 'the fixed page itself offends the guard').toBe(false);

    // The rewinds are the base page's own shape. This page never printed a "there are none"
    // sentence — it printed a POPULATED list — so the grep screen is blind to it in every one of
    // these states, which is precisely why the render tests above are the only real check.
    const rewinds: Record<string, string> = {
      'outage flag back on the bare error': s
        .replace(') : failed ? (', ') : currencyError ? (')
        .replace('const failed = Boolean(currencyError) && !data;\n', ''),
      'the split taken back out entirely': s
        .replace(/const failed = Boolean\(currencyError\) && !data;\n/, '')
        .replace(/const stale = Boolean\(currencyError\) && Boolean\(data\);\n/, '')
        .replace('{stale && (', '{false && (')
        .replace(') : failed ? (', ') : ('),
      'the fallbacks allowed to answer again': s.replace(
        'const hasRead = Boolean(data);',
        'const hasRead = Boolean(currencyData);',
      ),
    };
    for (const [name, rewind] of Object.entries(rewinds)) {
      expect(inspect(FILE, rewind).offends, `the guard would see this regression: ${name}`).toBe(false);
    }
  });

  it('keeps #2829\'s guard green, with the baseline still empty', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files, 'a page belongs on the baseline only if a reviewed PR says why').toEqual([]);
    expect(files).not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('owns this page alone', () => {
    // Overlap hygiene: no other suite mounts it, so nothing else can disagree about the copy.
    const dir = join(ROOT, 'tests/unit');
    const claimers = readdirSync(dir)
      .filter((f) => f.endsWith('.test.tsx'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('settings/currency/page'));
    expect(claimers, 'another suite already claims this page').toEqual([
      'panel-page-error-not-empty-settings-currency-stale-2872.test.tsx',
    ]);
  });
});
