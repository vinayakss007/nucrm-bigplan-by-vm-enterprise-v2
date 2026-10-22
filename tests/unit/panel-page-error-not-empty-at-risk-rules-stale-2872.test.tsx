// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/at-risk-rules/page.tsx`, the rules editor behind the
 * At-Risk Dashboard.
 *
 * This page is the variant of the class that `scripts/check-panel-error-state.mjs` cannot
 * see at all. It DID bind its read's `error` — and then folded it back into a plain string
 * on the next line:
 *
 *     const queryErrorMsg = rulesError ? (rulesError.message || 'Failed to load rules') : null;
 *     …
 *     {(error || queryErrorMsg) && (/* hand-rolled box, no role="alert" *\/)}
 *
 * The guard asks two questions — is `error` bound, and is there a failure affordance in the
 * file — and before this slice the file answered the first yes and satisfied the second only
 * because its absence sentence ("No at-risk rules defined") happens not to match the guard's
 * copy regex (the screen's keyword list ends in yet/found/here/configured/…, not "defined").
 * So the sweep walked past it in both directions: it was never on the baseline, and it is
 * still not an offender after the fix. The anti-vacuity case below rewinds the split back to
 * that exact line and `inspect()` still reports the file clean, which is the proof that these
 * render assertions, not the screen, are what hold the fix.
 *
 * What the single string cost, in the two states it conflated:
 *
 *  - ANSWERED, THEN REFUSED. Both `saveMutation` and `removeMutation` end in `load()`, an
 *    invalidate of this page's own `['tenant','admin','at-risk']` key, and `useApiQuery`
 *    keeps `data` when that refresh is refused. The rules the operator just wrote were still
 *    on screen, and the page told them the read had failed — with the raw status text
 *    ("Request failed (500)"), no subject and no retry, in a box a screen reader does not
 *    announce. Nothing said the list they were editing might be one save behind.
 *  - NEVER ANSWERED. `rulesData` is undefined, `rules` falls back to `[]`, and the page
 *    printed the banner AND "No at-risk rules defined / Deals will only be flagged based on
 *    the system default (14 days idle)" underneath it — a refusal reported as an absence, on
 *    the panel whose absence is what makes the nightly engine fall back to 14 days for every
 *    stage in the tenant.
 *
 * `error` — the mutations' own state slot — shared that one banner line with the read via
 * `error || queryErrorMsg`, so a refused write and a refused read printed one message and
 * whichever came first won. They are separate affordances now.
 *
 * What did NOT change: the two write buttons. Save was never keyed off the string, so the
 * rules on screen stay savable over a last read, and a read that never answered does not
 * lock the editor either — the server refuses a bad rule. No `if (failed) return` was added
 * over the region the `loading ? … : …` branch already owns.
 *
 * RED AT BASE — measured on `f979095d` with the page at what main carries and this file as
 * committed: **14 failed | 6 passed (20)**. The fourteen split seven against a refused refresh
 * (the kept rows claimed to have failed to load, the box that is not announced and has no
 * retry, the retry bound to nothing, the messageless refusal, the empty last answer, the write
 * and the read speaking over each other, the rows a thin sibling read must not swallow), three
 * against a read that never answered (the outage that printed "no rules" underneath it, its
 * retry, its messageless variant), and the four source-shape ratchets. The six that
 * pass at base are the controls this slice must not regress: the healthy read that says nothing
 * about freshness, the genuinely empty answer that says so with no alert, the kept rules still
 * being editable and savable, the empty baseline with the four sweeps green, the line ceiling,
 * and the overlap-hygiene case.
 *
 * Fixtures are documentation-only (RFC 2606 names, opaque ids).
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
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import AtRiskRulesPage from '@/app/tenant/settings/at-risk-rules/page';

const RULES_URL = '/api/tenant/admin/at-risk';
const PIPELINES_URL = '/api/tenant/pipelines';

const RULES = [
  {
    id: 'rule-global', stageId: null, maxDaysIdle: 14, maxDaysInStage: 30,
    sentimentThreshold: 30, description: 'Fallback for every stage', active: true,
  },
  {
    id: 'rule-negotiation', stageId: 'stage-negotiation', maxDaysIdle: 7, maxDaysInStage: null,
    sentimentThreshold: null, description: null, active: false,
  },
];
const PIPELINES = {
  data: [
    {
      id: 'pipe-ent', name: 'Enterprise pipeline',
      stages: [{ id: 'stage-negotiation', name: 'Negotiation', pipelineId: 'pipe-ent' }],
    },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before, this refresh did not — the state the one string could not express. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` that are NOT inside an alert. The replacement banners quote the state they
 * retire, so a bare `queryByText(/Failed to load/)` would find the outage banner's own words
 * and report the false claim as still standing.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const offered = (name: RegExp) => {
  const el = screen.queryByRole('button', { name }) as HTMLButtonElement | null;
  return el !== null && el.disabled === false;
};

/** The two row controls of a rule card, picked by the card's heading so icons stay unambiguous. */
function ruleCardButtons(heading: string): HTMLButtonElement[] {
  const card = screen.getByRole('heading', { name: heading }).closest('div[class*="bg-card"]');
  return Array.from(card?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
}

let client: QueryClient;
const tree = (node: ReactNode) => (
  <QueryClientProvider client={client}>{node}</QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const mount = (rulesResult: QueryResult, pipelinesResult: QueryResult = ok(PIPELINES)) => {
  registry.byUrl = { [RULES_URL]: rulesResult, [PIPELINES_URL]: pipelinesResult };
  return wrapped(<AtRiskRulesPage />);
};

/** Rejects every write while leaving the reads to the registry. */
const refusedWrite = (message: string) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 409, json: async () => ({ error: message }),
  } as Response));
const settledWith = (copy: RegExp) =>
  waitFor(() => expect(alerts()).toMatch(copy), { interval: 10 });

beforeEach(() => {
  registry.byUrl = {};
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a read that answered: the page says nothing about freshness', () => {
  it('shows both rules, their stages and no alert', () => {
    mount(ok(RULES));
    expect(screen.getByRole('heading', { name: 'Global Fallback' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Negotiation' })).toBeTruthy();
    expect(screen.getByText('Enterprise pipeline')).toBeTruthy();
    expect(screen.queryByText('No at-risk rules defined')).toBeNull();
    expect(alerts()).toBe('');
    expect(claimsOutsideAlerts(/last read/)).toEqual([]);
  });

  it('says none are defined, with no alert, when an empty list is what came back', () => {
    mount(ok([]));
    expect(screen.getByText('No at-risk rules defined')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('answered, then refused: the rules on screen are labelled the last read (#2872)', () => {
  it('keeps both rule cards and puts the caveat above them', () => {
    mount(staleRead(RULES));
    expect(screen.getByRole('heading', { name: 'Global Fallback' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Negotiation' })).toBeTruthy();
    expect(alerts()).toMatch(/the rules below are the last read/);
    expect(alerts()).toContain('Request failed (504)');
    // The box was not even announced before: it had no role="alert" and no retry.
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('retires the bare "could not load" claim over rows it is still showing', () => {
    mount(staleRead(RULES));
    // What the box printed at base, verbatim: the refusal alone, standing over the rows.
    expect(screen.queryByText('Request failed (504)')).toBeNull();
    expect(claimsOutsideAlerts(/Failed to load rules/)).toEqual([]);
    // …and every announced failure now says which state it is looking at.
    for (const el of screen.getAllByRole('alert')) {
      expect(el.textContent).toMatch(/Could not refresh/);
    }
  });

  it('binds the retry to the rules read, not the pipelines read beside it', () => {
    const rulesRead = staleRead(RULES);
    const pipelinesRead = ok(PIPELINES);
    registry.byUrl = { [RULES_URL]: rulesRead, [PIPELINES_URL]: pipelinesRead };
    wrapped(<AtRiskRulesPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(rulesRead.refetch).toHaveBeenCalledTimes(1);
    expect(pipelinesRead.refetch).not.toHaveBeenCalled();
  });

  it('names the server when the refusal arrives without a message', () => {
    mount(staleRead(RULES, ''));
    expect(alerts()).toMatch(/no response from the server/);
    expect(alerts()).not.toMatch(/undefined/);
    expect(screen.getByRole('heading', { name: 'Global Fallback' })).toBeTruthy();
  });

  it('still says none are defined when the last answer was empty, now beside the caveat', () => {
    mount(staleRead([]));
    expect(screen.getByText('No at-risk rules defined')).toBeTruthy();
    // The caveat is the difference between "this tenant has no rules" and "I could not check".
    expect(alerts()).toMatch(/the rules below are the last read/);
  });

  it('leaves the kept rules editable and savable', () => {
    mount(staleRead(RULES));
    const edit = ruleCardButtons('Negotiation')[0];
    expect(edit).toBeTruthy();
    fireEvent.click(edit);
    expect(screen.getByRole('button', { name: /save rule/i })).toBeTruthy();
    expect(offered(/save rule/i), 'a refused refresh locked the editor it is still showing').toBe(true);
    expect(offered(/^add rule$/i)).toBe(true);
  });

  it('keeps a refused write visible next to a refused read', async () => {
    refusedWrite('Stage rule already exists');
    mount(staleRead(RULES, 'Could not reload the rules'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^add rule$/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save rule/i }));
    });
    await settledWith(/Stage rule already exists/);
    // `error || queryErrorMsg` printed one line and let whichever came first win.
    expect(alerts()).toMatch(/the rules below are the last read/);
    expect(alerts()).toContain('Could not reload the rules');
  });

  it('keeps the rows and the caveat when the sibling stage read comes back thin', () => {
    // `pipelines` is not the read under test here; a thin answer from it must not swallow the
    // caveat, and the kept rows must stay on screen (both fall back to the 'Global Fallback'
    // heading once the stage names are gone, so the description is what proves the row survived).
    mount(staleRead(RULES), ok({ data: [] }));
    expect(screen.getByText(/Fallback for every stage/)).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: 'Global Fallback' })).toHaveLength(2);
    expect(alerts()).toMatch(/the rules below are the last read/);
  });
});

describe('never answered: the outage is what is reported, and the absence sentence is not (#2872)', () => {
  it('banners the failure with a retry and refuses to call it an absence', () => {
    mount(failed('Request failed (503)'));
    expect(alerts()).toContain('Failed to load at-risk rules: Request failed (503)');
    expect(screen.queryByText('No at-risk rules defined')).toBeNull();
    expect(claimsOutsideAlerts(/No at-risk rules defined/)).toEqual([]);
    expect(alerts()).not.toMatch(/last read/);
  });

  it('banners a messageless refusal instead of interpolating undefined', () => {
    mount(failed(''));
    expect(alerts()).toContain('Failed to load at-risk rules: no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
  });

  it('re-runs the failed read from the banner', () => {
    const read = failed('Request failed (503)');
    registry.byUrl = { [RULES_URL]: read, [PIPELINES_URL]: ok(PIPELINES) };
    wrapped(<AtRiskRulesPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('the shape that fixes it, and the screen that cannot see it', () => {
  const ROOT = process.cwd();
  const PAGE = 'app/tenant/settings/at-risk-rules/page.tsx';
  const own = 'panel-page-error-not-empty-at-risk-rules-stale-2872.test.tsx';
  const src = readFileSync(join(ROOT, PAGE), 'utf8');

  it('splits the two states on the payload, not on the flag', () => {
    expect(src).toMatch(/const failed = Boolean\(rulesError\) && !rulesData;/);
    expect(src, 'the caveat keys off the kept payload, not the error alone').toMatch(
      /const stale = Boolean\(rulesError\) && Boolean\(rulesData\);/,
    );
    expect(src).toMatch(/const reason = rulesError\?\.message \|\| 'no response from the server';/);
    expect(src).toMatch(/\{stale && \(/);
    expect(src).toMatch(/\{failed && \(/);
  });

  it('retires the re-derived string the sweep is blind to', () => {
    expect(src, 'the string fold is still standing').not.toMatch(/queryErrorMsg/);
    expect(src, 'the messageless refusal can still print nothing').not.toMatch(
      /rulesError \? \(rulesError\.message/,
    );
    expect(src).toMatch(/import InlineErrorState from '@\/components\/shared\/inline-error-state';/);
    // Both read states and the write slot are separate affordances, each bound to a retry where
    // a retry is the point.
    expect(src.match(/<InlineErrorState/g)).toHaveLength(3);
    expect(src).toMatch(/onRetry=\{\(\) => void refetchRules\(\)\}/);
  });

  it('gates only the absence sentence, and invents no new write lock', () => {
    expect(src).toMatch(/!failed && rules\.length === 0 && !editing/);
    expect(src, 'the hand-rolled box with no role="alert" is back').not.toMatch(
      /p-4 bg-destructive\/10 border border-destructive\/20/,
    );
    expect(src, 'the box that failure affordance replaced is still wired up').not.toMatch(/AlertCircle/);
    expect(src, 'an invented early return would hide the region the loading branch owns').not.toMatch(
      /if \(failed\) return|if \(stale\) return/,
    );
    expect(src, 'a last read does not lock the save it is showing').not.toMatch(
      /disabled=\{[^}]*(?:failed|stale)/,
    );
  });

  it('stays invisible to check-panel-error-state even when the split is rewound away', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const split = /const failed = Boolean\(rulesError\) && !rulesData;\s*\n\s*const stale = Boolean\(rulesError\) && Boolean\(rulesData\);\s*\n\s*const reason = rulesError\?\.message \|\| 'no response from the server';/;
    expect(src, 'the shape this slice depends on moved').toMatch(split);
    expect(inspect(PAGE, src).offends, 'the guard already flagged this file').toBe(false);
    const rewind = src.replace(
      split,
      "const queryErrorMsg = rulesError ? (rulesError.message || 'Failed to load rules') : null;",
    );
    expect(rewind, 'the rewind never reached a gate').not.toContain('const stale');
    expect(inspect(PAGE, rewind).offends, 'the guard would catch this rewind after all').toBe(false);
  });

  it('keeps the baseline empty and both sweeps green', () => {
    const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'));
    expect(Object.keys(baseline.files ?? {}), 'a ceiling, not a count').toHaveLength(0);
    for (const script of ['check-panel-error-state.mjs', 'check-file-size.mjs', 'check-catch-empty.mjs', 'check-any-suppressions.mjs']) {
      const res = spawnSync('node', [`scripts/${script}`], { cwd: ROOT, encoding: 'utf8' });
      expect(res.status, `${script}: ${res.stdout}${res.stderr}`).toBe(0);
    }
  });

  it('stays inside the page ceiling it was granted', () => {
    const lines = src.split('\n').length - 1;
    expect(lines).toBeLessThanOrEqual(500);
    expect(lines, 'the file drifted toward the ceiling instead of resting under it').toBeLessThan(460);
  });

  it('is the only suite that mounts this page', () => {
    const dir = join(ROOT, 'tests/unit');
    const mounters = readdirSync(dir)
      .filter((f) => f.endsWith('.test.tsx') && f !== own)
      .filter((f) => /settings\/at-risk-rules\/page/.test(readFileSync(join(dir, f), 'utf8')));
    expect(mounters, `${mounters.join(', ')} also names this page`).toEqual([]);
    expect(readFileSync(join(dir, own), 'utf8')).toMatch(/last read/);
  });
});
