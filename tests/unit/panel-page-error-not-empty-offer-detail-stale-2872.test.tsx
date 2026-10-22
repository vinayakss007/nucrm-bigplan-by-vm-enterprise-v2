// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/offers/[id]/page.tsx`, the buyer-offer console: one record read
 * (`useApiQuery` on `lib/query/client.tsx`: `staleTime: 30_000`, `retry: 2`, no focus refetch)
 * behind `OFFER_QUERY = ['tenant','offers',id]`, plus two writes — Send/Resend and Cancel offer —
 * whose `onSuccess` both end in `invalidate()` on that exact key. So "kept offer, refused refresh"
 * is not weather here, it is the ordinary render after every action the page offers.
 *
 * The page folded the two failures into one variable:
 *
 *     const error = actionError ?? (loadError ? (loadError.message || 'Failed to load offer') : null);
 *
 * Two defects, one line. (a) The read's refusal and the write's refusal share a channel, so a
 * refresh that was refused after a send announced "Failed to load offer" over an offer the page
 * was plainly still showing — and because `??` takes the left side, an action failure HID the read
 * failure whenever both were set, while a messageless `Error` after an action was swallowed by
 * `actionError`'s precedence in the other direction. (b) One boolean cannot say "the offer is on
 * screen and this refresh was refused", so the screen had no stale state at all: with no data the
 * page fell into `if (!quote)` and printed **"Offer not found"** above zero explanation — the
 * banner that would have named the refusal sits below that early return and never rendered — while
 * the 404, which IS an answer (`app/api/tenant/quotes/[id]` 404s only when no live row matches
 * this id and this tenant; a permission refusal is a 403), printed the same sentence honestly.
 *
 * The fix splits the read from the write: `failed` (never answered) owns an outage banner that
 * quotes `reason` and makes the not-found sentence unreachable; `stale` (answered, then refused)
 * keeps the offer, the buyer link, the line items and the lifecycle trail and puts an InlineErrorState
 * caveat above them; `actionError` keeps its own banner and its own words; `notFound` keeps the 404
 * as not-found with no alert. Nothing gained a `disabled` or an early return keyed on staleness:
 * both writes address the offer by its path id and the server answers 409 from the row's real
 * status (`canTransition`), so a refused refresh costs the operator information, not the actions.
 *
 * One figure is derived rather than read: `metadata.offer.viewed_count` is optional, and the
 * Lifecycle card printed `0` for an offer whose payload never carried the key. It prints `—` now;
 * a read that answered `0` still prints `0`.
 *
 * `scripts/check-panel-error-state.mjs` cannot see any of this: "Offer not found" is not one of the
 * empty sentences in its `EMPTY_SENTENCE` vocabulary, and the page bound `error` and rendered a
 * failure affordance before and after the split. The anti-vacuity case below rewinds the split and
 * the guard still reports the file clean — these render assertions are the only screen on the class.
 *
 * RED AT BASE. Against this file's page as it stands on `origin/main`, unmodified:
 * **15 failed | 10 passed (25)**. The ten that pass at base are the controls — the clean read,
 * the honest 404, the answered-but-empty body, the actionable kept offer, the real zero the read
 * answered, the `—` the page already printed for a missing quote number, the write/invalidation
 * shape, the guard's own baseline and sweep, and the line ceiling. Every stale-state, outage,
 * folded-channel and messageless-refusal case was red: one flag could not say "kept offer,
 * refused refresh", and a read that never answered printed "Offer not found" from behind an early
 * return that made the page's only error banner unreachable. They must keep passing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
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

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
// The page's write failures land in `actionError`; mocking the module keeps the reads driving
// the panel, and every assertion below reads role="alert" in the page rather than a toast.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
// The page resolves its route param with React's `use(params)`; jsdom mounts no router, so
// `use` unwraps the settled value the harness attaches below.
vi.mock('react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react')>();
  const unwrap = <T,>(usable: unknown): T => {
    const settled = usable as { value?: T };
    return (settled && typeof settled === 'object' && 'value' in settled ? settled.value : usable) as T;
  };
  return { ...mod, default: { ...mod.default, use: unwrap }, use: unwrap };
});

import OfferDetailPage from '@/app/tenant/offers/[id]/page';

const OFFER_ID = 'off-9';
const OFFER = `/api/tenant/quotes/${OFFER_ID}`;

const quote = {
  id: OFFER_ID, tenantId: 't-1', contactId: 'c-1', dealId: null,
  title: 'Dock scanner rollout', quoteNumber: 'Q-2041', status: 'sent',
  subtotal: '18000.00', discount: '500.00', tax: '1400.00', totalAmount: '18900.00',
  expiresAt: '2026-11-01T00:00:00Z', notes: 'Includes two spare cradles.', terms: 'Net 30.',
  metadata: { offer: { public_token: 'tok-9', sent_to_email: 'buyer@example.test', viewed_count: 3 } },
  sentAt: '2026-10-02T00:00:00Z', acceptedAt: null, declinedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
};
const lineItems = {
  quote,
  line_items: [
    { id: 'li-1', description: 'Handheld scanner (rugged)', quantity: '4', unitPrice: '3200.00', total: '12800.00' },
    { id: 'li-2', description: 'Dock cradle', quantity: '2', unitPrice: '1450.00', total: '2900.00' },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before, this refresh did not — the state the single folded flag could not express. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** What the route answers for an id that matches no live row of this tenant: an ANSWER. */
const refused404 = (): QueryResult => ({
  data: undefined,
  error: Object.assign(new Error('Request failed (404)'), { status: 404 }),
  isLoading: false,
  refetch: vi.fn(),
});

type Params = { id: string };
/** `use(params)` is unwrapped from `value` by the react mock above. */
function paramsFor(id: string): Promise<Params> {
  const p = Promise.resolve({ id }) as Promise<Params> & { value: Params };
  p.value = { id };
  return p;
}

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const tree = (node: ReactNode) => (
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
  >
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const mount = () => wrapped(<OfferDetailPage params={paramsFor(OFFER_ID)} />);

/** Refuses every write while leaving the reads to the registry. */
const refusedWrite = (message: string) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 409, json: async () => ({ error: message }),
  } as Response));
/** The mutation's rejection reaches `setActionError` one tick after the click resolves. */
const settledWith = (copy: RegExp) =>
  waitFor(() => expect(alerts()).toMatch(copy), { interval: 10 });

const OUTAGE = /Failed to load this offer/;
const CAVEAT = /last read/i;

beforeEach(() => {
  registry.byUrl = {};
  vi.clearAllMocks();
  // Nothing in this file may leave the process: the writes are stubbed per case.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: false, status: 599, json: async () => ({ error: 'unreachable in tests' }),
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('offer detail: a refused refresh keeps the offer and stops announcing a load failure (#2872)', () => {
  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [OFFER]: ok(lineItems) };
    mount();
    expect(screen.getByText('Dock scanner rollout')).toBeTruthy();
    expect(screen.getByText('Q-2041')).toBeTruthy();
    expect(screen.getByText('Handheld scanner (rugged)')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('keeps the offer, its money and its actions, and calls the screen the last read', () => {
    const result = staleRead(lineItems);
    registry.byUrl = { [OFFER]: result };
    mount();
    expect(screen.getByText('Dock scanner rollout')).toBeTruthy();
    expect(screen.getByText('Net 30.')).toBeTruthy();
    expect(screen.getByText('$18,900.00', { selector: 'tfoot td' })).toBeTruthy();
    expect(alerts()).toMatch(/Could not refresh this offer/);
    expect(alerts()).toMatch(CAVEAT);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // The outage sentence is a lie here: the record is on the screen, in detail.
    expect(alerts()).not.toMatch(OUTAGE);
    expect(screen.queryByText('Offer not found')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('the kept offer is still actionable, with no new gate on the staleness', () => {
    registry.byUrl = { [OFFER]: staleRead(lineItems) };
    mount();
    // Resend and Cancel both post to the offer's own id and the server answers 409 from the
    // row's real status, so a refused refresh costs information, not the buttons.
    const cancel = screen.getByRole('button', { name: /cancel offer/i });
    expect(cancel.disabled).toBe(false);
    fireEvent.click(cancel);
    const resend = screen.getByRole('button', { name: /^resend$/i });
    expect(resend.disabled).toBe(false);
    expect(screen.getByText('Buyer link')).toBeTruthy();
  });

  it('does not report a refused refresh as the write that caused it', async () => {
    // The fold put the read into the same variable the mutations feed, so this state — send
    // succeeded, its revalidation refused — printed "Failed to load offer" once and, with an
    // action error set, printed only the action's words and hid the refusal entirely.
    refusedWrite('Cannot cancel an offer in accepted state');
    registry.byUrl = { [OFFER]: staleRead(lineItems) };
    mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel offer/i }));
    });
    await settledWith(/Cannot cancel an offer in accepted state/);
    expect(alerts()).toMatch(CAVEAT);
    expect(alerts()).not.toMatch(OUTAGE);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // Two channels, two alerts — neither one stands in for the other.
    expect(screen.queryAllByRole('alert')).toHaveLength(2);
  });

  it('keeps the action failure its own channel and its own words over a healthy read', async () => {
    refusedWrite('Buyer email required');
    registry.byUrl = { [OFFER]: ok(lineItems) };
    mount();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel offer/i }));
    });
    await settledWith(/Buyer email required/);
    expect(alerts()).not.toMatch(CAVEAT);
    expect(alerts()).not.toMatch(OUTAGE);
    expect(screen.getByText('Dock scanner rollout')).toBeTruthy();
  });

  it('re-runs only this offer read from the caveat', () => {
    const here = staleRead(lineItems);
    registry.byUrl = { [OFFER]: here, '/api/tenant/quotes': ok({ data: [quote] }) };
    mount();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(here.refetch).toHaveBeenCalledTimes(1);
  });

  it('names the server when a refusal on a kept offer arrives without a message', () => {
    registry.byUrl = { [OFFER]: staleRead(lineItems, '') };
    mount();
    expect(alerts()).toMatch(/no response from the server/);
    // `loadError.message || …` inside the fold could otherwise print the word `undefined`.
    expect(alerts()).not.toMatch(/undefined/);
    expect(screen.getByText('Dock scanner rollout')).toBeTruthy();
  });
});

describe('offer detail: a read that never answered is an outage, not an absent offer (#2872)', () => {
  it('banners the outage and makes the false absence unreachable', () => {
    registry.byUrl = { [OFFER]: failed('Request failed (500)') };
    mount();
    expect(alerts()).toMatch(/Failed to load this offer: Request failed \(500\)/);
    expect(alerts()).not.toMatch(CAVEAT);
    // "Offer not found" over a read that never answered claims the buyer's offer is gone.
    expect(screen.queryByText('Offer not found')).toBeNull();
    expect(screen.queryByText('Dock scanner rollout')).toBeNull();
    // And no write is offered against an id this session only failed to read.
    expect(screen.queryByRole('button', { name: /cancel offer/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^resend$/i })).toBeNull();
    // Money the page never read may not appear as a zero either.
    expect(document.body.textContent).not.toMatch(/\$\d/);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[OFFER].refetch).toHaveBeenCalledTimes(1);
  });

  it('banners a messageless outage instead of printing undefined', () => {
    registry.byUrl = { [OFFER]: failed('') };
    mount();
    expect(alerts()).toMatch(/Failed to load this offer: no response from the server/);
    expect(document.body.textContent).not.toMatch(/undefined/);
  });

  it('a 404 for this id is the server answering: not found, with no alert', () => {
    registry.byUrl = { [OFFER]: refused404() };
    mount();
    expect(screen.getByText('Offer not found')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(document.body.textContent).not.toMatch(OUTAGE);
    expect(document.body.textContent).not.toMatch(CAVEAT);
  });

  it('a 403 refusal is an outage, not a claim that the offer is gone', () => {
    registry.byUrl = { [OFFER]: failed('Request failed (403)') };
    mount();
    expect(alerts()).toMatch(OUTAGE);
    expect(screen.queryByText('Offer not found')).toBeNull();
  });

  it('says "Offer not found" with no alert when the read answered with no offer in the body', () => {
    registry.byUrl = { [OFFER]: ok({ quote: null, line_items: [] }) };
    mount();
    expect(screen.getByText('Offer not found')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a refused refresh over an empty answer says not found AND carries the caveat', () => {
    registry.byUrl = { [OFFER]: staleRead({ quote: null, line_items: [] }) };
    mount();
    expect(screen.getByText('Offer not found')).toBeTruthy();
    expect(alerts()).toMatch(CAVEAT);
    expect(alerts()).not.toMatch(OUTAGE);
  });
});

describe('offer detail: figures the payload left out (#2872)', () => {
  it('prints an em dash for a view count the response never carried', () => {
    const bare = {
      ...lineItems,
      quote: { ...quote, metadata: { offer: { public_token: 'tok-9' } } },
    };
    registry.byUrl = { [OFFER]: ok(bare) };
    mount();
    const views = screen.getByText('Views').parentElement?.textContent ?? '';
    expect(views).toContain('—');
    expect(views).not.toMatch(/Views\s*0/);
    // The "Viewed N×" pill stays honest too: it does not claim a view it did not read.
    expect(screen.queryByText(/Viewed/)).toBeNull();
  });

  it('prints a real zero when the read answered zero', () => {
    const zero = {
      ...lineItems,
      quote: { ...quote, metadata: { offer: { public_token: 'tok-9', viewed_count: 0 } } },
    };
    registry.byUrl = { [OFFER]: ok(zero) };
    mount();
    expect(screen.getByText('Views').parentElement?.textContent).toMatch(/Views\s*0/);
  });

  it('a refused refresh still says the count is the last read, not absent', () => {
    registry.byUrl = { [OFFER]: staleRead(lineItems) };
    mount();
    expect(screen.getByText('Views').parentElement?.textContent).toMatch(/Views\s*3/);
    expect(alerts()).toMatch(CAVEAT);
  });

  it('keeps the em dash the page already uses for a quote number it did not read', () => {
    const noNumber = { ...lineItems, quote: { ...quote, quoteNumber: null } };
    registry.byUrl = { [OFFER]: ok(noNumber) };
    mount();
    const numberLine = [...document.querySelectorAll('p')].find((el) => el.className.includes('font-mono'));
    expect(numberLine?.textContent).toBe('—');
    expect(screen.getByText('Dock scanner rollout')).toBeTruthy();
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/offers/[id]/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the read from the write instead of folding them into one flag', () => {
    const s = src();
    expect(s, 'a refused refresh still judged as no data at all')
      .toMatch(/const failed = Boolean\(loadError\) && !data;/);
    expect(s, 'the kept offer is never called the last read')
      .toMatch(/const stale = Boolean\(loadError\) && Boolean\(data\);/);
    expect(s, 'a messageless refusal can still print undefined')
      .toMatch(/const reason = loadError\?\.message \|\| 'no response from the server';/);
    expect(s, 'the 404 is folded back into the outage')
      .toMatch(/const notFound = failed && loadError\?\.status === 404;/);
    expect(s).toMatch(/\{stale && \(/);
    expect(s).toMatch(/InlineErrorState/);
  });

  it('retires the fold that put the read in the mutation\'s channel', () => {
    const s = src();
    expect(s, 'the #2872 fold is still the page\'s error variable')
      .not.toMatch(/const error = actionError \?\?/);
    expect(s, 'the read\'s outage sentence is still the shared one').not.toMatch(/'Failed to load offer'/);
    expect(s, 'the banner no longer belongs to the action').toMatch(/\{actionError && \(/);
    // The action error is still a channel: it is bound, set by both writes and rendered.
    expect(s.match(/setActionError\(/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('invents no gating on a refresh it merely could not confirm', () => {
    const s = src();
    // Every action button is still disabled only while its own mutation is in flight.
    expect(s.match(/disabled=\{busy !== null\}/g)).toHaveLength(3);
    expect(s, 'staleness was turned into a lock').not.toMatch(/disabled=\{[^}]*stale/);
    expect(s).not.toMatch(/disabled=\{[^}]*failed/);
    // One outage arm, and it is the 404 that is excluded from it — no second early return.
    expect(s.match(/if \(failed && !notFound\) \{/g)).toHaveLength(1);
    expect(s).not.toMatch(/if \(failed\) return/);
    expect(s).not.toMatch(/if \(stale\) return/);
  });

  it('leaves the two writes and their invalidation where they were', () => {
    const s = src();
    // One read on the page, so its caveat has no sibling query to mis-wire.
    expect(s.match(/useApiQuery</g), 'the page grew a second read').toHaveLength(1);
    expect(s.match(/invalidate\(\);/g)).toHaveLength(2);
    expect(s).toMatch(/invalidateQueries\(\{ queryKey: OFFER_QUERY \}\)/);
    expect(s.match(/onError: \(e: Error\) => setActionError\(e\.message\)/g)).toHaveLength(2);
  });

  it('reports the page clean before and after the split is taken back out', async () => {
    // "Offer not found" is not in the sweep's EMPTY_SENTENCE vocabulary, so the guard called
    // this page clean while it was deleting offers on screen — and calls it clean rewound.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const s = src();
    const rewinds: [RegExp, string][] = [
      [/const failed = Boolean\(loadError\) && !data;\s*\n\s*const notFound = failed && loadError\?\.status === 404;\s*\n\s*const stale = Boolean\(loadError\) && Boolean\(data\);/,
       'const failed = Boolean(loadError);'],
      [/\{stale && \(/, '{false && ('],
    ];
    for (const [pattern, replacement] of rewinds) {
      expect(s, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(inspect(FILE, s).offends, `${FILE} was already on the guard's list`).toBe(false);
      expect(
        inspect(FILE, s.replace(pattern, replacement)).offends,
        `the guard would catch this rewind after all: ${replacement}`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality: other #2872 slices land on this branch alongside this one.
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    expect(files, `${FILE} went back on a list the guard cannot even read it onto`).not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('claims exactly one page, and no other suite claims it', () => {
    // Overlap hygiene: the sibling #2872 suites scan tests/unit for their page's path and for
    // the words `last read`, so this file names one page and one page only — never another
    // slice's, not even to say it is not touching it.
    const own = 'panel-page-error-not-empty-offer-detail-stale-2872.test.tsx';
    const mine = readFileSync(join(ROOT, 'tests/unit', own), 'utf8');
    const named = [...new Set(mine.match(/app\/[\w[\]/-]+\.tsx/g) ?? [])];
    expect(named, 'this suite started speaking about a page it does not own').toEqual([FILE]);

    const dir = join(ROOT, 'tests/unit');
    const others = readdirSync(dir)
      .filter((f) => f.endsWith('.test.tsx') && f !== own)
      .filter((f) => /offers\/\[id\]\/page/.test(readFileSync(join(dir, f), 'utf8')));
    expect(others, `${FILE} grew a second owner`).toEqual([]);
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${FILE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
