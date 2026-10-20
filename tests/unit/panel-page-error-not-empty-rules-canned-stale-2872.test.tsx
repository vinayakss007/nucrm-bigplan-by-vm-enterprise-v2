// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/settings/assignment-rules/page.tsx` and
 * `app/tenant/settings/canned-responses/page.tsx`, the two settings panels whose only failure
 * channel was a toast fired from the render body.
 *
 * Both pages bound `error` and spent it on `if (error) toast.error(...)`, which fades in about
 * four seconds and re-fires on every render, while the panel went on answering the refusal with
 * its own absence sentence — "No assignment rules / Create rules to automatically assign records
 * to team members" and "No canned responses / Create templates to speed up ticket replies". TanStack
 * Query keeps `data` when a revalidation of a read that already succeeded fails, so the flag also
 * could not tell *never answered* from *answered, then refused*.
 *
 * The refused revalidation is the page's own doing on both:
 *
 * - assignment-rules reads `/api/tenant/assignment-rules` under `['tenant','assignment-rules']`,
 *   and `reload()` invalidates exactly that key from `saveRule.onSuccess` *and*
 *   `deleteRule.onSuccess` — so the state right after creating, editing or deleting a rule is kept
 *   rows plus an error flag. The row that was just deleted sat there with a toast four seconds old
 *   as the only evidence anything happened.
 * - canned-responses reads `/api/tenant/canned-responses?${params}` (category and search, when
 *   set) under `['tenant','canned-responses',{categoryFilter,search}]`, and `reload()` invalidates
 *   the `['tenant','canned-responses']` prefix, which both `saveResponse` and `deleteResponse`
 *   call. Because the filter values are in the key, a filtered view that has never answered has no
 *   `data` of its own: that view is `failed`, and must not be dressed up as a last read of the list
 *   the operator was looking at a second ago.
 *
 * assignment-rules carries the worse of the two reads. Its teams list —
 * `/api/tenant/teams` under `['tenant','teams','for-assignment-rules']`, the picker the rule builder
 * routes `config.teamId` through — destructured *neither* `error` *nor* `refetch`. Nothing in the
 * app invalidates that key (`reload()` touches only the rules prefix), so it is refetched when the
 * operator returns to the page past the 30-second `staleTime`; when that read refused, the builder
 * offered only "— Choose a team —", which is precisely what a tenant with no teams sees, and there
 * was no retry anywhere for it.
 *
 * Neither page derives a count from these reads, so there is no `—` counter here — the failure is
 * the absence sentence and the picker, not a number printing `0`.
 *
 * `scripts/check-panel-error-state.mjs` cannot see either page, and not only because of the split:
 * "No assignment rules" and "No canned responses" end in nouns outside its `EMPTY_SENTENCE`
 * vocabulary (`yet|found|here|configured|recorded|logged|match…`), so the sweep reported both clean
 * before this fix and reports them clean after every rewind below. These assertions are the screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readdirSync, readFileSync } from 'node:fs';
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

import AssignmentRulesPage from '@/app/tenant/settings/assignment-rules/page';
import CannedResponsesPage from '@/app/tenant/settings/canned-responses/page';

const RULES = '/api/tenant/assignment-rules';
const TEAMS = '/api/tenant/teams';
// `categoryFilter`/`search` start empty, so `?${params}` keeps the trailing '?' in the URL the
// page actually asks for.
const CANNED = '/api/tenant/canned-responses?';
const CANNED_BILLING = '/api/tenant/canned-responses?category=billing';

const NOW = '2026-02-11T09:00:00.000Z';
const ruleRows = {
  data: [
    { id: 'ar-1', name: 'Round robin for leads', type: 'round_robin', config: { teamId: 'tm-1' }, isActive: true, priority: 1, entityType: 'lead', createdAt: NOW },
    { id: 'ar-2', name: 'Territory for tickets', type: 'territory', config: {}, isActive: true, priority: 2, entityType: 'ticket', createdAt: NOW },
  ],
};
const teamRows = {
  data: [
    { id: 'tm-1', name: 'Gulf Sales', memberCount: 4 },
    { id: 'tm-2', name: 'EMEA Support', memberCount: 2 },
  ],
};
const cannedRows = {
  data: [
    { id: 'cr-1', category: 'billing', title: 'Invoice timeline', content: 'Your invoice is due on the 5th of the month.', shortcut: '/invoice', createdAt: NOW },
    { id: 'cr-2', category: 'general', title: 'Thanks for reaching out', content: 'Hi {{name}}, thanks for contacting us.', shortcut: null, createdAt: NOW },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before, this refresh did not — the state one `error` flag cannot express. */
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

/** Rejects every write while leaving the reads to the registry. */
const refusedWrite = (message: string) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: false, status: 500, json: async () => ({ error: message }),
  } as Response));

/** The rule builder is a modal; the header button is index 0 when the empty state also has one. */
function openRuleBuilder() {
  const add = screen.getAllByRole('button', { name: /add rule/i });
  fireEvent.click(add[0]);
}
/** The builder's own container, so a retry can be attributed to the read it belongs to. */
const builder = () => {
  const el = document.querySelector('div.fixed.inset-0');
  expect(el, 'the rule builder did not open').not.toBeNull();
  return el as HTMLElement;
};
/**
 * The picker's <label> is not wired to the <select> (no htmlFor/id), so `getByLabelText` cannot
 * reach it — climb from the label text instead, the way the other panel suites do for counts.
 */
const teamPicker = () => {
  const label = [...builder().querySelectorAll('label')].find((el) => el.textContent === 'Assign to team');
  expect(label, 'the builder lost its team field').not.toBeUndefined();
  return (label as Element).parentElement?.querySelector('select') ?? null;
};
const optionTexts = (select: Element) =>
  [...select.querySelectorAll('option')].map((o) => o.textContent ?? '');
const ruleRow = (name: string) => {
  const el = screen.getByText(name).closest('.admin-card');
  expect(el, `row "${name}" is not on screen`).not.toBeNull();
  return el as HTMLElement;
};

describe('assignment-rules: a refused reload after a save or delete keeps the list (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps both rules and calls them the last read', () => {
    const result = staleRead(ruleRows);
    registry.byUrl = { [RULES]: result, [TEAMS]: ok(teamRows) };
    wrapped(<AssignmentRulesPage />);
    expect(screen.getByText('Round robin for leads')).toBeTruthy();
    expect(screen.getByText('Territory for tickets')).toBeTruthy();
    expect(alerts()).toMatch(/the rules below are the last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(alerts()).toMatch(/just created, edited or deleted/);
    // The outage sentence would deny the rows the panel is showing.
    expect(alerts()).not.toMatch(/Failed to load assignment rules/);
    expect(screen.queryByText('No assignment rules')).toBeNull();
  });

  it('the caveat re-runs the rules read and not the teams read beside it', () => {
    const result = staleRead(ruleRows);
    const teams = staleRead(teamRows);
    registry.byUrl = { [RULES]: result, [TEAMS]: teams };
    wrapped(<AssignmentRulesPage />);
    openRuleBuilder();
    const retries = screen.getAllByRole('button', { name: /try again/i });
    expect(retries).toHaveLength(2);
    fireEvent.click(retries[0]);
    expect(result.refetch).toHaveBeenCalledTimes(1);
    expect(teams.refetch).not.toHaveBeenCalled();
  });

  it('an unread list is an outage, and not "No assignment rules"', () => {
    const result = failed('Request failed (503)');
    registry.byUrl = { [RULES]: result, [TEAMS]: ok(teamRows) };
    wrapped(<AssignmentRulesPage />);
    expect(screen.queryByText('No assignment rules')).toBeNull();
    expect(alerts()).toMatch(/Failed to load assignment rules: Request failed \(503\)/);
    expect(alerts()).not.toMatch(/last read/i);
    // One outage card, not the picker's too — the teams read answered.
    expect(screen.queryAllByRole('alert')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty sentence with no alert when empty is what the read answered', () => {
    registry.byUrl = { [RULES]: ok({ data: [] }), [TEAMS]: ok(teamRows) };
    wrapped(<AssignmentRulesPage />);
    expect(screen.getByText('No assignment rules')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('says none still stands when the last read had none, with the caveat added', () => {
    registry.byUrl = { [RULES]: staleRead({ data: [] }), [TEAMS]: ok(teamRows) };
    wrapped(<AssignmentRulesPage />);
    // The sentence is honest here — this list did answer, once. The caveat is what separates it
    // from a read nobody got an answer from.
    expect(screen.getByText('No assignment rules')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [RULES]: ok(ruleRows), [TEAMS]: ok(teamRows) };
    wrapped(<AssignmentRulesPage />);
    expect(screen.getByText('Round robin for leads')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.queryByText('No assignment rules')).toBeNull();
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [RULES]: staleRead(ruleRows, ''), [TEAMS]: ok(teamRows) };
    wrapped(<AssignmentRulesPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Round robin for leads')).toBeTruthy();
  });

  it('leaves a kept rule editable, which is the whole point of keeping the rows', () => {
    registry.byUrl = { [RULES]: staleRead(ruleRows), [TEAMS]: ok(teamRows) };
    wrapped(<AssignmentRulesPage />);
    // Every row has its own Edit button, so the click has to be scoped to the kept one.
    fireEvent.click(within(ruleRow('Round robin for leads')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Edit Rule')).toBeTruthy();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('walks the delete path: a good read, then a refused reload, then a good read again', () => {
    // `reload()` is what delete calls, so this hop is the page's ordinary state, and asserting it
    // proves the rows are *kept* rather than re-rendered from a fresh mock.
    registry.byUrl = { [RULES]: ok(ruleRows), [TEAMS]: ok(teamRows) };
    const view = wrapped(<AssignmentRulesPage />);
    expect(screen.getByText('Round robin for leads')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    registry.byUrl = { [RULES]: staleRead(ruleRows), [TEAMS]: ok(teamRows) };
    view.rerender(tree(<AssignmentRulesPage />));
    expect(screen.getByText('Round robin for leads')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(screen.queryByText(/Failed to load assignment rules/)).toBeNull();

    registry.byUrl = { [RULES]: ok(ruleRows), [TEAMS]: ok(teamRows) };
    view.rerender(tree(<AssignmentRulesPage />));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a refused delete as the write it is, and takes no page state from it', async () => {
    refusedWrite('Failed to delete');
    registry.byUrl = { [RULES]: ok(ruleRows), [TEAMS]: ok(teamRows) };
    wrapped(<AssignmentRulesPage />);
    const row = ruleRow('Territory for tickets');
    // The row's two buttons are Edit then the trash icon; the icon has no accessible name.
    await act(async () => {
      fireEvent.click(row.querySelectorAll('button')[1]);
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to delete'), { interval: 10 });
    // An action keeps its transient feedback; a page state may not be carried by it.
    expect(alerts()).toBe('');
    expect(screen.getByText('Territory for tickets')).toBeTruthy();
  });
});

describe('assignment-rules: the builder\'s team picker stops answering for the teams read (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('a refused teams read is an outage at the picker, not a tenant with no teams', () => {
    const teams = failed('Request failed (503)');
    registry.byUrl = { [RULES]: ok(ruleRows), [TEAMS]: teams };
    wrapped(<AssignmentRulesPage />);
    openRuleBuilder();
    // Today the picker collapses to its one placeholder option and the operator cannot tell a
    // refusal from an empty install — and has no way to retry.
    expect(teamPicker()).toBeNull();
    expect(alerts()).toMatch(/Failed to load your teams/);
    expect(alerts()).toMatch(/not the same as having none: Request failed \(503\)/);
    expect(alerts()).not.toMatch(/last read/i);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(teams.refetch).toHaveBeenCalledTimes(1);
    // The rules read answered, so its list is still on the screen behind the builder.
    expect(screen.getByText('Round robin for leads')).toBeTruthy();
  });

  it('a stale teams read keeps every option and labels them the last read', () => {
    const teams = staleRead(teamRows);
    registry.byUrl = { [RULES]: ok(ruleRows), [TEAMS]: teams };
    wrapped(<AssignmentRulesPage />);
    openRuleBuilder();
    const select = teamPicker();
    expect(select).not.toBeNull();
    expect(optionTexts(select as Element)).toContain('Gulf Sales (4)');
    expect(optionTexts(select as Element)).toContain('EMEA Support (2)');
    expect(alerts()).toMatch(/options below are the last read/i);
    expect(alerts()).toMatch(/member counts beside them are old/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(alerts()).not.toMatch(/Failed to load your teams/);
  });

  it('the picker\'s retry re-runs the teams read and not the rules read', () => {
    const teams = staleRead(teamRows);
    const rules = staleRead(ruleRows);
    registry.byUrl = { [RULES]: rules, [TEAMS]: teams };
    wrapped(<AssignmentRulesPage />);
    openRuleBuilder();
    fireEvent.click(within(builder()).getByRole('button', { name: /try again/i }));
    expect(teams.refetch).toHaveBeenCalledTimes(1);
    expect(rules.refetch).not.toHaveBeenCalled();
  });

  it('a tenant that really has no teams sees the placeholder and no alert', () => {
    registry.byUrl = { [RULES]: ok(ruleRows), [TEAMS]: ok({ data: [] }) };
    wrapped(<AssignmentRulesPage />);
    openRuleBuilder();
    const select = teamPicker();
    expect(select).not.toBeNull();
    expect(optionTexts(select as Element)).toEqual(['— Choose a team —']);
    expect(alerts()).toBe('');
  });

  it('names the server when the teams refusal arrives without a message', () => {
    registry.byUrl = { [RULES]: ok(ruleRows), [TEAMS]: failed('') };
    wrapped(<AssignmentRulesPage />);
    openRuleBuilder();
    expect(alerts()).toMatch(/Failed to load your teams.*not the same as having none: no response from the server/);
  });
});

describe('canned-responses: a refused reload after a save keeps the templates (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps both responses and calls them the last read', () => {
    const result = staleRead(cannedRows);
    registry.byUrl = { [CANNED]: result };
    wrapped(<CannedResponsesPage />);
    expect(screen.getByText('Invoice timeline')).toBeTruthy();
    expect(screen.getByText('Thanks for reaching out')).toBeTruthy();
    expect(alerts()).toMatch(/the responses below are the last read/i);
    expect(alerts()).toMatch(/just created, edited or deleted/);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(screen.queryByText('No canned responses')).toBeNull();
    expect(alerts()).not.toMatch(/Failed to load canned responses/);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('an unread list is an outage, and not "No canned responses"', () => {
    const result = failed('Request failed (503)');
    registry.byUrl = { [CANNED]: result };
    wrapped(<CannedResponsesPage />);
    expect(screen.queryByText('No canned responses')).toBeNull();
    expect(screen.queryByText(/Create templates to speed up ticket replies/)).toBeNull();
    expect(alerts()).toMatch(/Failed to load canned responses: Request failed \(503\)/);
    expect(alerts()).not.toMatch(/last read/i);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty sentence with no alert when empty is what the read answered', () => {
    registry.byUrl = { [CANNED]: ok({ data: [] }) };
    wrapped(<CannedResponsesPage />);
    expect(screen.getByText('No canned responses')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('says none still stands when the last read had none, with the caveat added', () => {
    registry.byUrl = { [CANNED]: staleRead({ data: [] }) };
    wrapped(<CannedResponsesPage />);
    expect(screen.getByText('No canned responses')).toBeTruthy();
    // …and it does not claim the refresh agreed.
    expect(alerts()).toMatch(/last read/i);
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [CANNED]: ok(cannedRows) };
    wrapped(<CannedResponsesPage />);
    expect(screen.getByText('Invoice timeline')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [CANNED]: staleRead(cannedRows, '') };
    wrapped(<CannedResponsesPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Invoice timeline')).toBeTruthy();
  });

  it('treats a category view that has never answered as a failure, not a stale read', () => {
    // `categoryFilter` is in the key, so switching to `billing` is a brand-new read: the payload
    // the unfiltered view succeeded with belongs to that view only.
    registry.byUrl = {
      [CANNED]: ok(cannedRows),
      [CANNED_BILLING]: failed('Request failed (502)'),
    };
    wrapped(<CannedResponsesPage />);
    expect(screen.getByText('Invoice timeline')).toBeTruthy();
    // The form is closed, so the category select is the page's only one.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'billing' } });
    expect(screen.queryByText('Invoice timeline')).toBeNull();
    expect(alerts()).toMatch(/Failed to load canned responses: Request failed \(502\)/);
    expect(alerts()).not.toMatch(/last read/i);
  });

  it('leaves a kept response editable, which is the whole point of keeping the rows', () => {
    registry.byUrl = { [CANNED]: staleRead(cannedRows) };
    wrapped(<CannedResponsesPage />);
    const row = screen.getByText('Invoice timeline').closest('div[class*="bg-card"]') as HTMLElement;
    expect(row).not.toBeNull();
    fireEvent.click(row.querySelectorAll('button')[0]);
    expect(screen.getByText('Edit Canned Response')).toBeTruthy();
  });

  it('walks the create path: a good read, then a refused reload, then a good read again', () => {
    registry.byUrl = { [CANNED]: ok(cannedRows) };
    const view = wrapped(<CannedResponsesPage />);
    expect(screen.queryByRole('alert')).toBeNull();

    registry.byUrl = { [CANNED]: staleRead(cannedRows) };
    view.rerender(tree(<CannedResponsesPage />));
    expect(screen.getByText('Invoice timeline')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(screen.queryByText(/Failed to load canned responses/)).toBeNull();

    registry.byUrl = { [CANNED]: ok(cannedRows) };
    view.rerender(tree(<CannedResponsesPage />));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a refused delete as the write it is, and takes no page state from it', async () => {
    refusedWrite('no');
    registry.byUrl = { [CANNED]: ok(cannedRows) };
    wrapped(<CannedResponsesPage />);
    const row = screen.getByText('Invoice timeline').closest('div[class*="bg-card"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(row.querySelectorAll('button')[1]);
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to delete'), { interval: 10 });
    expect(alerts()).toBe('');
    expect(screen.getByText('Invoice timeline')).toBeTruthy();
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const RULES_FILE = 'app/tenant/settings/assignment-rules/page.tsx';
  const CANNED_FILE = 'app/tenant/settings/canned-responses/page.tsx';
  const FILES = [RULES_FILE, CANNED_FILE];
  const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('splits the two states on every read, including the one that bound nothing before', () => {
    expect(src(RULES_FILE)).toMatch(/Boolean\(rulesError\) && !rulesData/);
    expect(src(RULES_FILE)).toMatch(/const rulesStale = Boolean\(rulesError\) && Boolean\(rulesData\)/);
    expect(src(RULES_FILE)).toMatch(/Boolean\(teamsError\) && !teamsData/);
    expect(src(RULES_FILE)).toMatch(/const teamsStale = Boolean\(teamsError\) && Boolean\(teamsData\)/);
    expect(src(CANNED_FILE)).toMatch(/Boolean\(error\) && !data/);
    expect(src(CANNED_FILE)).toMatch(/const stale = Boolean\(error\) && Boolean\(data\)/);
    for (const f of FILES) {
      expect(src(f), `${f} can print an undefined error`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src(f), `${f} banners on the flag alone again`).toMatch(/\b\w*[Ff]ailed \? \(/);
      expect(src(f), `${f} keeps the rows without calling them a last read`).toMatch(/\{\w*[Ss]tale && \(/);
    }
    // Each read needs its own retry: the teams read destructured neither `error` nor `refetch`,
    // so before this fix there was nothing to point a "Try again" button at.
    expect(src(RULES_FILE)).toMatch(/refetch: refetchRules/);
    expect(src(RULES_FILE)).toMatch(/error: teamsError, refetch: refetchTeams/);
    expect(src(CANNED_FILE)).toMatch(/error, refetch \} = useApiQuery/);
  });

  it('takes the page state off the toast and leaves the writes their feedback', () => {
    for (const f of FILES) {
      const s = src(f);
      expect(s, `${f} still fires a render-body toast for a page state`).not.toMatch(/^\s*if \(error\) toast\.error/m);
      expect(s, `${f} lost the action's own confirmation`).toMatch(/toast\.success/);
      expect(s, `${f} stopped reporting a refused write`).toMatch(/onError: .*\(\) => toast\.error|onError: \(e: Error\) => toast\.error/);
    }
  });

  it('punishes no kept read with a dash it has nothing to count', () => {
    // Neither page derives a figure from these reads — no tab counter, no header total — so the
    // ratchet here is that the fix did not invent one keyed off a flag on the way past. The kept
    // rows themselves are pinned above, and no card of either page prints '—' in them.
    for (const f of FILES) {
      expect(src(f), `${f} dashes on the bare error`).not.toMatch(/\w*[Ee]rror \? '—'/);
      expect(src(f), `${f} dashes on a failed read`).not.toMatch(/(?:Failed|failed|stale) \? '—'/);
    }
  });

  it('reports every page clean before and after the split is taken back out', async () => {
    const { inspect, EMPTY_SENTENCE } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [string, RegExp, string][] = [
      [RULES_FILE,
        /const rulesFailed = Boolean\(rulesError\) && !rulesData;\s*\n\s*const rulesStale = Boolean\(rulesError\) && Boolean\(rulesData\);/,
        'const rulesFailed = Boolean(rulesError);\n  const rulesStale = false;'],
      [RULES_FILE,
        /const teamsFailed = Boolean\(teamsError\) && !teamsData;\s*\n\s*const teamsStale = Boolean\(teamsError\) && Boolean\(teamsData\);/,
        'const teamsFailed = Boolean(teamsError);\n  const teamsStale = false;'],
      [CANNED_FILE,
        /const failed = Boolean\(error\) && !data;\s*\n\s*const stale = Boolean\(error\) && Boolean\(data\);/,
        'const failed = Boolean(error);\n  const stale = false;'],
    ];
    for (const [file, pattern, replacement] of rewinds) {
      const s = src(file);
      expect(s, `${file}: the shape this slice depends on moved`).toMatch(pattern);
      expect(inspect(file, s).offends, `${file} was already on the guard's list`).toBe(false);
      expect(
        inspect(file, s.replace(pattern, replacement)).offends,
        `${file}: the guard would catch this rewind after all`,
      ).toBe(false);
    }
    // …and the reason it never saw these two even at base: the absence copy is outside its
    // vocabulary, so a fixed page is no more visible to it than a broken one was.
    expect(EMPTY_SENTENCE.test('No assignment rules')).toBe(false);
    expect(EMPTY_SENTENCE.test('No canned responses')).toBe(false);
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    for (const f of FILES) expect(files, `${f} went back on the list`).not.toContain(f);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps every file it touched inside the size ceiling', () => {
    for (const f of FILES) {
      expect(src(f).split('\n').length, `${f} is past the ceiling`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('leaves the older suites on these pages free of the kept-read copy', () => {
    // Nothing mounted either page before this slice — the one suite that names canned-responses
    // exercises the route handler. If a #2829/#2872 suite ever starts mounting them, its assertions
    // must not have learned to talk about a last read, which is this file's job.
    const dir = join(ROOT, 'tests/unit');
    const name = 'panel-page-error-not-empty-rules-canned-stale-2872.test.tsx';
    const others = readdirSync(dir).filter((f) => f.endsWith('.test.tsx') && f !== name);
    const mounted = others.filter((f) => {
      const s = readFileSync(join(dir, f), 'utf8');
      return s.includes('settings/assignment-rules') || s.includes('settings/canned-responses');
    });
    for (const f of mounted) {
      expect(readFileSync(join(dir, f), 'utf8'), `${f} speaks about a kept read too`).not.toMatch(/last read/);
    }
    expect(mounted).toEqual([]);
  });
});
