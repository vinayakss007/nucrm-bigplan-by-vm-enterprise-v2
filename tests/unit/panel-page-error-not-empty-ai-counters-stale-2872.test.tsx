// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the three AI pages that dashed their own numbers over a payload they were
 * still holding.
 *
 * `ai/at-risk`, `ai/lead-scoring` and `ai/activity` all bind their read's `error`, all
 * render `InlineErrorState`, and all pass `check-panel-error-state.mjs`: #2829 already
 * closed the half where a failed read claimed an absence. This is the other half — the
 * read that DID answer, and then refused to answer again — and TanStack Query keeps
 * `data` through it.
 *
 * These three are the counter flavour of the class. `at-risk` and `lead-scoring` derive
 * every stat from the same array the page renders below them; `activity` reads them off
 * the `summary_30d` of the response that carries its table. Either way the payload is in
 * hand, and every one of these keyed its numbers off the bare flag:
 *
 *     {loading ? '...' : error ? '—' : deals.length}
 *     <StatCard value={queryError ? '—' : stats.avg} … />
 *     <Stat value={queryError ? '—' : summary?.total_calls ?? 0} />
 *     {(error || queryError) && (<InlineErrorState message="Failed to load AI activity" />)}
 *     ) : error ? (  the whole at-risk table  …
 *
 * `lead-scoring` and `activity` still rendered their rows in that state, so the page
 * said "I could not load anything" and showed three dashes above a queue and a table
 * that were plainly on screen. `at-risk` is worse: its branch is in the render chain,
 * so the refused reload replaced the deal table outright.
 *
 * The triggers are ordinary. `lead-scoring` invalidates its leads key from BOTH of its
 * mutations (`runScoringMutation.onSuccess` and `recomputeMutation.onSuccess` call
 * `load()`), so a scoring run whose reload refused produced exactly that. `at-risk` and
 * `activity` are invalidated by nothing — their refusals arrive on the page's own
 * Refresh button and on the remount refetch past the repo-wide 30s `staleTime`
 * (`lib/query/client.tsx:47-58`; `refetchOnWindowFocus` is off, and `retry: 2` means
 * the dash is a settled state, not a blip).
 *
 * Per page: `failed = Boolean(err) && !data` keeps #2829's outage banner, `stale` keeps
 * the numbers and the rows under a "last read" caveat, and the `queryErrorMsg` /
 * `error.message ||` spellings became the standard `reason` fallback.
 *
 * RED AT BASE — measured on `main` at `64875518` (this branch's base) with the three
 * product files untouched and this file as committed: 10 of these 21 cases fail. Six
 * put a page in the stale state and read its numbers back (both `at-risk` refusals, the
 * `lead-scoring` queue, the scoring-run-after-reload case, the `activity` 30-day stats,
 * and the failed-rating-beside-a-stale-read case), and four are the source ratchets,
 * which cannot pass until the split exists. The other 11 are the outage-and-empty
 * controls from #2829; they pass at base and must keep passing, because letting a
 * refused reload count is exactly the edit that breaks them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  isFetching?: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url]
    ?? { data: undefined, error: null, isLoading: false, isFetching: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import AIAtRiskPage from '@/app/tenant/ai/at-risk/page';
import AILeadScoringPage from '@/app/tenant/ai/lead-scoring/page';
import AIActivityPage from '@/app/tenant/ai/activity/page';

const AT_RISK = '/api/tenant/ai/at-risk';
const LEADS = '/api/tenant/leads?sort_by=score&sort_order=DESC&limit=100';
const ACTIVITY = '/api/tenant/ai/activity?page=1&pageSize=25';

const atRiskDeals = {
  data: [
    {
      id: 'ar-1', title: 'Harbor Fitness - 200 seat rollout', amount: '25000', stageName: 'Negotiation',
      contactName: 'Dana Whitfield', companyName: 'Harbor Fitness',
      atRisk: { reasons: ['No activity in 34 days', 'Negative sentiment on last thread'], severity: 'high', idleDays: 34, stageDays: 41, currentSentiment: -1 },
    },
    {
      id: 'ar-2', title: 'Coral Realty - invoice portal', amount: '15000', stageName: 'Proposal',
      contactName: 'Imran Shah', companyName: 'Coral Realty',
      atRisk: { reasons: ['Stage older than 30 days'], severity: 'medium', idleDays: 12, stageDays: 33, currentSentiment: 0 },
    },
  ],
};
// 92 + 40 + 80 -> avg 71, two at 80+, three ranked.
const scoredLeads = {
  data: [
    { id: 'ls-1', firstName: 'Nadia', lastName: 'Rahman', email: 'nadia@coral.invalid', companyName: 'Coral Realty', score: 92, leadStatus: 'new' },
    { id: 'ls-2', firstName: 'Tomas', lastName: 'Vidal', email: null, companyName: null, score: 40, leadStatus: 'contacted' },
    { id: 'ls-3', firstName: 'Priya', lastName: 'Menon', email: 'priya@harbor.invalid', companyName: 'Harbor Fitness', score: 80, leadStatus: 'qualified' },
  ],
};
const activityResp = {
  rows: [
    {
      id: 'aa-1', action: 'follow_up_draft', provider: 'openai', model: 'gpt-4o-mini', status: 'success',
      tokens_in: 120, tokens_out: 80, tokens_used: 200, cost_cents: 1450, latency_ms: 812,
      entity_type: 'deal', entity_id: 'd-1', error_message: null, accepted: true,
      created_at: '2026-10-01T09:00:00Z', user_id: 'u-1', user_name: 'Dana Whitfield', user_email: null,
    },
    {
      id: 'aa-2', action: 'summary_generate', provider: 'anthropic', model: null, status: 'error',
      tokens_in: 0, tokens_out: 0, tokens_used: 0, cost_cents: 0, latency_ms: null,
      entity_type: 'company', entity_id: 'c-1', error_message: 'provider timeout', accepted: null,
      created_at: '2026-10-01T09:05:00Z', user_id: null, user_name: null, user_email: 'ops@coral.invalid',
    },
  ],
  pagination: { page: 1, pageSize: 25, total: 2, pageCount: 1 },
  summary_30d: { total_calls: 640, total_tokens: 180000, total_cost_cents: 4250, success_calls: 600, accepted_calls: 28, rated_calls: 40 },
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, isFetching: false, refetch: vi.fn() });
const outage = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
});
/** The state this slice is about: the payload is cached, the refresh refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, isFetching: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` that are NOT inside an alert. Every replacement banner in this class
 * quotes the sentence it retires, so a bare `queryByText(/No AI activity yet/)` would
 * find the alert's own copy and report the false claim as still standing.
 */
function claimsOutsideAlerts(re: RegExp): HTMLElement[] {
  return screen.queryAllByText(re).filter((el) => el.closest('[role="alert"]') === null);
}

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);

const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};

/**
 * Reads a stat card's value off the card that carries `label`. `getByText('—')` is
 * useless here — the tables print em-dashes for missing model names and latencies — and
 * the three pages nest label and value differently, so the card is the lowest ancestor
 * that actually contains a value element.
 */
function statValue(label: string): string {
  const cards = screen.getAllByText(label, { exact: true })
    .map((el) => {
      let node: HTMLElement | null = el;
      while (node && !node.querySelector('.text-3xl, .text-2xl')) node = node.parentElement;
      return node;
    })
    .filter((node): node is HTMLElement => node !== null);
  expect(cards, `expected exactly one ${label} card`).toHaveLength(1);
  const value = cards[0].querySelector('.text-3xl, .text-2xl') as HTMLElement;
  return (value.textContent ?? '').trim();
}

describe('at-risk: a refused refresh keeps the pipeline and its arithmetic (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the deal table and counts the deals it is showing', () => {
    const result = staleRead(atRiskDeals);
    registry.byUrl = { [AT_RISK]: result };
    wrapped(<AIAtRiskPage />);
    expect(screen.getByText('Harbor Fitness - 200 seat rollout')).toBeTruthy();
    expect(statValue('Total At-Risk')).toBe('2');
    expect(statValue('High Severity')).toBe('1');
    expect(statValue('Risk Value')).toBe('$40,000');
    expect(alerts()).toContain('the pipeline below is the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(claimsOutsideAlerts(/Failed to check your pipeline/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('an unread scan is an outage, dashes its own cards, and never claims a healthy pipeline', () => {
    registry.byUrl = { [AT_RISK]: outage('Request failed (500)') };
    wrapped(<AIAtRiskPage />);
    expect(screen.queryByText('Harbor Fitness - 200 seat rollout')).toBeNull();
    expect(statValue('Total At-Risk')).toBe('—');
    expect(statValue('Risk Value')).toBe('—');
    expect(claimsOutsideAlerts(/No deals currently match your at-risk criteria/)).toEqual([]);
    expect(alerts()).toContain('Failed to check your pipeline for at-risk deals: Request failed (500)');
    expect(alerts()).not.toContain('Could not refresh');
  });

  it('filtering a last-read pipeline says it was the filter, and keeps the caveat', () => {
    // The search box runs over the rows the page is holding. Narrowing them is the
    // operator's own doing, so "No deals match" is honest here even while the read is
    // stale — and the caveat must not be lost when it is.
    registry.byUrl = { [AT_RISK]: staleRead(atRiskDeals) };
    wrapped(<AIAtRiskPage />);
    fireEvent.change(screen.getByPlaceholderText(/Filter by deal/), { target: { value: 'zzzz' } });
    expect(screen.getByText(/No deals match/)).toBeTruthy();
    expect(claimsOutsideAlerts(/No deals currently match your at-risk criteria/)).toEqual([]);
    expect(alerts()).toContain('the pipeline below is the last read');
  });

  it('a refusal with no message says so, not undefined', () => {
    registry.byUrl = {
      [AT_RISK]: { data: undefined, error: Object.assign(new Error(), { status: 503 }), isLoading: false, refetch: vi.fn() },
    };
    wrapped(<AIAtRiskPage />);
    expect(alerts()).toContain('no response from the server');
    expect(alerts()).not.toContain('undefined');
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [AT_RISK]: ok(atRiskDeals) };
    wrapped(<AIAtRiskPage />);
    expect(statValue('Total At-Risk')).toBe('2');
    expect(statValue('High Severity')).toBe('1');
    expect(alerts()).toBe('');
  });
});

describe('lead-scoring: a refused reload keeps the ranking and its stats (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the queue and its three reductions under a last-read caveat', () => {
    const result = staleRead(scoredLeads);
    registry.byUrl = { [LEADS]: result };
    wrapped(<AILeadScoringPage />);
    expect(screen.getByText(/Nadia Rahman/)).toBeTruthy();
    expect(screen.getByText(/Priya Menon/)).toBeTruthy();
    expect(statValue('Avg. Score')).toBe('71');
    expect(statValue('High Intent')).toBe('2');
    expect(statValue('Scored Leads')).toBe('3');
    expect(alerts()).toContain('the ranking below is the last read');
    expect(claimsOutsideAlerts(/Failed to load your scored leads/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('an unread queue still dashes, and never claims there were no leads to score', () => {
    registry.byUrl = { [LEADS]: outage('Request failed (500)') };
    wrapped(<AILeadScoringPage />);
    expect(statValue('Avg. Score')).toBe('—');
    expect(statValue('Scored Leads')).toBe('—');
    expect(claimsOutsideAlerts(/No leads found to score/)).toEqual([]);
    expect(alerts()).toContain('Failed to load your scored leads: Request failed (500)');
    expect(alerts()).not.toContain('Could not refresh');
  });

  it('a scoring run whose reload refused keeps the ranking instead of announcing a failure', () => {
    // `load()` is what `onSuccess` calls, so this is the state a successful run lands
    // in when the reload that follows it is refused.
    registry.byUrl = { [LEADS]: staleRead(scoredLeads) };
    wrapped(<AILeadScoringPage />);
    expect(screen.getAllByText(/Hot|Cold|Warm/).length).toBeGreaterThan(0);
    expect(alerts()).not.toContain('Failed to load your scored leads');
    expect(alerts()).toContain('Request failed (504)');
  });

  it('a read that answers "there are none" still says so, with no alert', () => {
    registry.byUrl = { [LEADS]: ok({ data: [] }) };
    wrapped(<AILeadScoringPage />);
    expect(screen.getByText(/No leads found to score/)).toBeTruthy();
    expect(statValue('Scored Leads')).toBe('0');
    expect(alerts()).toBe('');
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [LEADS]: ok(scoredLeads) };
    wrapped(<AILeadScoringPage />);
    expect(statValue('High Intent')).toBe('2');
    expect(alerts()).toBe('');
  });
});

describe('ai/activity: a refused refresh keeps the figures and the table (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the 30-day stats and the rows they were computed from', () => {
    const result = staleRead(activityResp);
    registry.byUrl = { [ACTIVITY]: result };
    wrapped(<AIActivityPage />);
    expect(statValue('Calls (30d)')).toBe('640');
    expect(statValue('Tokens (30d)')).toBe('180,000');
    expect(statValue('Cost (30d)')).toBe('$42.50');
    expect(screen.getByText('follow_up_draft')).toBeTruthy();
    expect(alerts()).toContain('these figures and the entries below are the last read');
    expect(claimsOutsideAlerts(/Failed to load AI activity/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('an unread view dashes the three stats that depend on it and says so', () => {
    registry.byUrl = { [ACTIVITY]: outage('Request failed (500)') };
    wrapped(<AIActivityPage />);
    expect(statValue('Calls (30d)')).toBe('—');
    expect(statValue('Tokens (30d)')).toBe('—');
    expect(statValue('Cost (30d)')).toBe('—');
    expect(claimsOutsideAlerts(/No AI activity yet/)).toEqual([]);
    expect(alerts()).toContain('Failed to load AI activity: Request failed (500)');
    expect(alerts()).not.toContain('Could not refresh');
  });

  it('a failed rating is still reported on its own, beside the last-read caveat', async () => {
    // The `error` state and the read are two different failures; the page used to fold
    // them into one banner that always spoke of loading.
    registry.byUrl = { [ACTIVITY]: staleRead(activityResp) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, json: async () => ({ error: 'Rating window closed' }),
    }));
    wrapped(<AIActivityPage />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark rejected' })[0]);
    await waitFor(() => expect(alerts()).toContain('Could not save your rating: Rating window closed'));
    expect(alerts()).toContain('these figures and the entries below are the last read');
    expect(screen.getByText('follow_up_draft')).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('a read that answers "there is none" still says so, with no alert', () => {
    registry.byUrl = {
      [ACTIVITY]: ok({ ...activityResp, rows: [], summary_30d: { ...activityResp.summary_30d, total_calls: 0, total_tokens: 0, total_cost_cents: 0 } }),
    };
    wrapped(<AIActivityPage />);
    expect(screen.getByText(/No AI activity yet/)).toBeTruthy();
    expect(statValue('Calls (30d)')).toBe('0');
    expect(statValue('Cost (30d)')).toBe('$0');
    expect(alerts()).toBe('');
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [ACTIVITY]: ok(activityResp) };
    wrapped(<AIActivityPage />);
    expect(statValue('Success rate')).toBe('94%');
    expect(statValue('Acceptance')).toBe('70%');
    expect(alerts()).toBe('');
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = [
    'app/tenant/ai/at-risk/page.tsx',
    'app/tenant/ai/lead-scoring/page.tsx',
    'app/tenant/ai/activity/page.tsx',
  ];

  it('splits the two states apart on all three pages', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/const failed = Boolean\(\w+\) && !data/);
      expect(src, `${f} keeps the payload without saying it is the last read`).toMatch(/const stale = Boolean\(\w+\) && Boolean\(data\)/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/const reason = \w+\?\.message \|\| 'no response from the server'/);
      expect(src, `${f} never warns over rows it is still showing`).toMatch(/\{stale && \(/);
      expect(src, `${f} still treats any error as an outage`).not.toMatch(/\)\s*:\s*(?:\w*[Ee]rror|error) \? \(/);
      expect(src, `${f} still folds the read's failure into the mutation's`).not.toMatch(/\|\|\s*(?:queryError|\w*[Ee]rror)\)\s*&&\s*\(/);
    }
  });

  it('leaves no derived number keyed off the bare flag', () => {
    // The dash is the whole defect here: `queryError ? '—' : stats.avg` dashes a
    // queue the page is still ranking, and a screen that only asks whether a failure
    // reaches the page cannot see it.
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still dashes on the bare flag`).not.toMatch(/\w*[Ee]rror \? '—'/);
      expect(src, `${f} still interpolates a raw error message`).not.toMatch(/\w*[Ee]rror\.message \|\| 'no response from the server'/);
    }
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality — pinning the count is what #2858, #2865 and #2866
    // each had to undo. #2829's last slice took it to zero.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of FILES) {
      expect(files, `${f} should never be baselined — it is visible to the guard`).not.toContain(f);
    }
  });

  it('would not have been caught by the guard if the stale banners were deleted', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const withoutStale = src
        .replace(/\n\s*\{stale && \([\s\S]*?\)\s*\}\n/g, '\n')
        .replace(/const stale = [^\n]*\n/g, '');
      expect(withoutStale, `${f}: the stale block changed shape, update this check`).not.toBe(src);
      expect(inspect(f, withoutStale).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('would not have been caught by the guard with the flags rewound to the bare error', async () => {
    // The regression this file exists to catch: `failed` back to the bare flag keeps
    // the guard, the baseline, the #2829 import and every outage assertion green.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const bare = src
        .replace(/\bfailed(?=\s*\?|\s*&&|\s*\))/g, 'errorFlag')
        .replace(/const failed = [^\n]*\n/g, '');
      expect(bare, `${f}: the outage branch changed spelling, update this check`).not.toBe(src);
      expect(bare, `${f}: the rewind never reached the gates`).toMatch(/errorFlag/);
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
