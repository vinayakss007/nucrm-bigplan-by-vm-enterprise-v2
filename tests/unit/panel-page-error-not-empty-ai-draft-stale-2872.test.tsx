// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/ai/draft/page.tsx`: the template picker that an outage banner replaced
 * after the read had already answered.
 *
 * Two reads. The primary one is `['tenant','admin','ai-templates']` →
 * `/api/tenant/admin/ai-templates`, and at base the page collapsed its three states into one:
 *
 *     if (templatesError) return [];                       // the memo, :83
 *     {templatesError && templatesError.status !== 404 ? <InlineErrorState …/>
 *      : templates !== null && templates.length === 0 ? "No templates configured…" : null}
 *
 * `lib/query/client.tsx:41` is what makes that a lie: `apiFetcher` throws on non-2xx, and
 * TanStack hands a FAILED REVALIDATION of an already-answered read back WITH its `data`. So the
 * refused refresh — the ordinary state after anything invalidates the key — took the payload the
 * tenant was holding, ran it through the memo's `return []`, and printed the outage banner over an
 * empty picker: the templates vanished, the banner claimed they could not be loaded, and Generate
 * would still draft from `selectedTemplate`, the row the last read picked for them.
 *
 * Three states, and the 404 arm stays an arm of its own:
 *   templatesFailed = Boolean(templatesError) && !templatesData && !is404
 *   templatesStale  = Boolean(templatesError) && Boolean(templatesData) && !is404
 * `app/api/tenant/admin/ai-templates` is admin-only and #1328 documented that on purpose, so a
 * 404 is the server ANSWERING "you have nothing to pick" — it must not become the outage banner
 * (#2829 pinned exactly that, and this suite re-pins it) and it must not be reported as a refused
 * refresh either. Same idea as the detail card's `notFound` predicate: the status the read came
 * back with is part of the answer, not evidence of an outage.
 *
 * THE SECOND READ gets the same split, and at base it was worse: `useApiQuery` at :103 (the
 * entity typeahead, `/api/tenant/<contacts|deals|companies>?limit=8&search=…`) never bound its
 * `error` at all. Its result feeds `entityHits`, which renders only `entityHits.length > 0`, so a
 * search that never answered and a search whose refresh was refused were both invisible — the type
 * box sat there with nothing under it, and the only way to notice was to already know the list
 * should have had rows. That is the silent half #2868's lesson is about: the primary read got the
 * banner and the secondary one swallowed its own failure. It now has `searchFailed`,
 * `searchStale` and `searchReason`, each with its own sentence and its own retry, keyed on
 * `searchData` — not on whether the last read happened to have rows.
 *
 * The two numbers on the draft card (`tokens_used`, `latency_ms`) and the generate mutation's own
 * message box are the page's other printed messages. The box renders `error` from state, and
 * `onError` handed it `e.message` raw — a rejection with nothing to say put `''` in state, so the
 * box did not arm at all and the draft simply never appeared. It now defaults where the failure
 * enters state, and the two numbers print `—` when the payload left them out instead of printing
 * a blank next to the unit.
 *
 * What this slice deliberately does NOT do: gate Generate. The button is
 * `disabled={busy !== null || !selectedEntity}` and stays that way — the outage branch already
 * owns the picker region, and a stale read of the template list does not make the entity the user
 * picked wrong. The case below pins the button ENABLED over a kept read, because "we could not
 * refresh" must not quietly become "you may not act".
 *
 * RED AT BASE — measured on this branch's base (`c7c74088`) with `app/tenant/ai/draft/page.tsx`
 * rewound to what main carries and this file as committed: **16 failed | 11 passed (27)**. Four are
 * the refused templates read (the rows kept under the caveat, the empty last answer, the
 * messageless refusal, the good→refused→good walk), six are the second read (its outage, its stale
 * caveat, its empty last answer, its messageless refusal, the two retries keyed apart, the
 * entity-tab switch — none of which could pass while the typeahead bound no `error` at all), two
 * are the draft the page writes (the numbers a payload left out, the rejection with nothing to
 * say), and four are the source ratchets. The 11 that pass at base are the behaviour this fix must
 * not regress: #2829's outage banner and its wording, the 404 that really is an answer, the honest
 * empty sentence, the freshness silence on a good read, the first-load spinner, "no internals in
 * the copy", Generate still reachable, and the four guard/ceiling/ownership pins.
 *
 * Fixtures are documentation-only (RFC 2606 .test names, no live identifiers).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/errors-client', () => ({ logError: vi.fn() }));

import AIDraftPage from '@/app/tenant/ai/draft/page';

// The URLs the page builds — the typeahead concatenates the debounced term, which starts empty.
const TEMPLATES = '/api/tenant/admin/ai-templates';
const SEARCH_CONTACTS = '/api/tenant/contacts?limit=8&search=';
const SEARCH_DEALS = '/api/tenant/deals?limit=8&search=';

const TEMPLATE = {
  id: 'tpl-1', slug: 'quarterly-checkin', name: 'Quarterly check-in',
  description: 'A short note to a customer', kind: 'email' as const, seed: false,
};
const SEED = {
  id: null, slug: 'renewal-nudge', name: 'Renewal nudge',
  description: null, kind: 'reply' as const, seed: true,
};
const templatesPayload = { templates: [TEMPLATE], seeds: [SEED] };
const emptyTemplates = { templates: [], seeds: [] };
const searchPayload = {
  contacts: [
    { id: 'cn-1', firstName: 'Ada', lastName: 'Oper', email: 'ada@acme.test' },
    { id: 'cn-2', firstName: 'Bo', lastName: 'Lin', email: 'bo@acme.test' },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)', status = 500): QueryResult => ({
  data: undefined, error: Object.assign(new Error(message), { status }), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the read answered before, this refresh was refused. */
const staleRead = (data: unknown, message = 'Request failed (504)', status = 504): QueryResult => ({
  data, error: Object.assign(new Error(message), { status }), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/**
 * Matches of `re` that are NOT inside an alert. The replacement copy quotes the sentence it
 * retires, so a bare `queryByText(/No templates configured/)` would find the banner's own words
 * and report the false claim as still standing.
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

describe('the template picker keeps its rows through a refused refresh (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('a refused refresh keeps both templates on screen and names the read it is holding', () => {
    const read = staleRead(templatesPayload);
    registry.byUrl = { [TEMPLATES]: read, [SEARCH_CONTACTS]: ok(searchPayload) };
    const { container } = wrapped(<AIDraftPage />);
    expect(screen.getByText('Quarterly check-in')).toBeTruthy();
    expect(screen.getByText('Renewal nudge')).toBeTruthy();
    expect(alerts()).toContain(
      'Could not refresh your AI templates, so the list below is the last read: Request failed (504). ' +
      'A template added, edited or removed since that read is missing or wrong here, and Generate drafts from what is listed.',
    );
    // The two claims this state must stop making: an outage, and an absence.
    expect(claimsOutsideAlerts(/Failed to load your AI templates/)).toEqual([]);
    expect(claimsOutsideAlerts(/No templates configured/)).toEqual([]);
    // The caveat sits ABOVE the rows it describes, and its retry re-runs this read alone.
    const banner = container.querySelector('[role="alert"]') as HTMLElement;
    const row = screen.getByText('Quarterly check-in');
    expect(banner.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('Generate stays reachable over a kept read — a refused refresh is not a reason to block the write', () => {
    registry.byUrl = { [TEMPLATES]: staleRead(templatesPayload), [SEARCH_CONTACTS]: ok(searchPayload) };
    wrapped(<AIDraftPage />);
    fireEvent.click(screen.getByRole('button', { name: /Ada Oper/i }));
    const generate = screen.getByRole('button', { name: /generate draft/i });
    expect(generate.disabled).toBe(false);
  });

  it('a refused refresh of an empty last answer says so, and does not print the configured sentence', () => {
    registry.byUrl = { [TEMPLATES]: staleRead(emptyTemplates), [SEARCH_CONTACTS]: ok(searchPayload) };
    wrapped(<AIDraftPage />);
    expect(alerts()).toContain(
      'Could not refresh your AI templates, so the empty picker below is the last read: Request failed (504).',
    );
    expect(claimsOutsideAlerts(/No templates configured/)).toEqual([]);
    expect(claimsOutsideAlerts(/Failed to load your AI templates/)).toEqual([]);
  });

  it('a refusal with no message names the server instead of printing undefined', () => {
    registry.byUrl = { [TEMPLATES]: staleRead(templatesPayload, ''), [SEARCH_CONTACTS]: ok(searchPayload) };
    wrapped(<AIDraftPage />);
    expect(alerts()).toContain('the last read: no response from the server');
    expect(alerts()).not.toMatch(/undefined|\bnull\b/);
    expect(screen.getByText('Quarterly check-in')).toBeTruthy();
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [TEMPLATES]: ok(templatesPayload), [SEARCH_CONTACTS]: ok(searchPayload) };
    wrapped(<AIDraftPage />);
    expect(screen.getByText('Quarterly check-in')).toBeTruthy();
    expect(screen.getByText('Renewal nudge')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('walks the refresh: a good read, a refused one, a good read again', () => {
    registry.byUrl = { [TEMPLATES]: ok(templatesPayload), [SEARCH_CONTACTS]: ok(searchPayload) };
    const view = wrapped(<AIDraftPage />);
    expect(alerts()).toBe('');

    registry.byUrl = { [TEMPLATES]: staleRead(templatesPayload), [SEARCH_CONTACTS]: ok(searchPayload) };
    view.rerender(tree(<AIDraftPage />));
    expect(screen.getByText('Quarterly check-in')).toBeTruthy();
    expect(alerts()).toContain('is the last read');

    registry.byUrl = { [TEMPLATES]: ok(templatesPayload), [SEARCH_CONTACTS]: ok(searchPayload) };
    view.rerender(tree(<AIDraftPage />));
    expect(alerts()).toBe('');
  });

  it('prints no server internals in the copy the tenant actually reads', () => {
    for (const read of [failed('Request failed (503)'), staleRead(templatesPayload)]) {
      registry.byUrl = { [TEMPLATES]: read, [SEARCH_CONTACTS]: ok(searchPayload) };
      wrapped(<AIDraftPage />);
      const spoken = alerts().replace(/Request failed \(\d{3}\)/g, '');
      expect(spoken.length).toBeGreaterThan(20);
      expect(spoken).not.toMatch(/\b(?:4|5)\d\d\b/);
      expect(spoken).not.toMatch(/endpoint|status code|useApiQuery|\.tsx?\b|app\/api/i);
      cleanup();
    }
  });
});

describe('the template read that never answered, and the 404 that did (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('an unread read is the outage banner #2829 wrote, wording unchanged', () => {
    const read = failed('Request failed (500) — pool down', 500);
    registry.byUrl = { [TEMPLATES]: read, [SEARCH_CONTACTS]: ok(searchPayload) };
    wrapped(<AIDraftPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load your AI templates: Request failed (500) — pool down');
    expect(alerts()).not.toContain('last read');
    expect(claimsOutsideAlerts(/No templates configured/)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('a 404 is the server answering that there is nothing to pick, not an outage and not a stale read', () => {
    // #1328 documented this endpoint as admin-only; for a non-admin the 404 IS the answer.
    registry.byUrl = { [TEMPLATES]: failed('Request failed (404)', 404), [SEARCH_CONTACTS]: ok(searchPayload) };
    wrapped(<AIDraftPage />);
    expect(alerts()).toBe('');
    expect(screen.getByText(/No templates configured/)).toBeTruthy();
    expect(screen.getByText('Add one').closest('a')?.getAttribute('href')).toBe('/tenant/settings/ai-templates');
  });

  it('an answered read that really did come back empty keeps saying so', () => {
    registry.byUrl = { [TEMPLATES]: ok(emptyTemplates), [SEARCH_CONTACTS]: ok(searchPayload) };
    wrapped(<AIDraftPage />);
    expect(screen.getByText(/No templates configured/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('a first load is a spinner that claims nothing', () => {
    registry.byUrl = {
      [TEMPLATES]: { data: undefined, error: null, isLoading: true, refetch: vi.fn() },
      [SEARCH_CONTACTS]: ok(searchPayload),
    };
    const { container } = wrapped(<AIDraftPage />);
    expect(container.querySelector('svg')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(claimsOutsideAlerts(/No templates configured/)).toEqual([]);
  });
});

describe('the entity typeahead read, which used to fail in silence (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('a search that never answered says so, and does not leave the box looking like "no matches"', () => {
    const read = failed('Request failed (500)', 500);
    registry.byUrl = { [TEMPLATES]: ok(templatesPayload), [SEARCH_CONTACTS]: read };
    const { container } = wrapped(<AIDraftPage />);
    expect(screen.getByRole('alert').textContent).toContain(
      'Failed to load the Contact search: Request failed (500). The match list is unanswered, and this is not a statement that nothing matched.',
    );
    expect(screen.queryByText('Ada Oper')).toBeNull();
    expect(alerts()).not.toContain('last read');
    // the outage banner for templates is absent: that read answered fine
    expect(claimsOutsideAlerts(/Failed to load your AI templates/)).toEqual([]);
    const input = screen.getByPlaceholderText(/search contacts/i);
    const banner = container.querySelector('[role="alert"]') as HTMLElement;
    // the caveat/banner is above the region it describes, and does not remove the type box
    expect(banner.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('a refused refresh keeps the matches the last read gave and says they are the last read', () => {
    const read = staleRead(searchPayload);
    registry.byUrl = { [TEMPLATES]: ok(templatesPayload), [SEARCH_CONTACTS]: read };
    const { container } = wrapped(<AIDraftPage />);
    expect(screen.getByText('Ada Oper')).toBeTruthy();
    expect(screen.getByText('Bo Lin')).toBeTruthy();
    expect(alerts()).toContain(
      'Could not refresh the Contact search, so what is listed below is the last read: Request failed (504). ' +
      'An entity added, renamed or removed since that read is wrong here, and Generate drafts against it.',
    );
    expect(claimsOutsideAlerts(/Failed to load the Contact search/)).toEqual([]);
    const banner = container.querySelector('[role="alert"]') as HTMLElement;
    const row = screen.getByText('Ada Oper');
    expect(banner.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('a refused refresh of an empty last answer is still described as a read, not as an outage', () => {
    // The typeahead answered "nothing matched", then this refresh was refused. That is the second
    // state, and it is not the first one: the page may not silently fall back to no message at all
    // (what base did with no `error` bound) nor to the outage banner.
    registry.byUrl = { [TEMPLATES]: ok(templatesPayload), [SEARCH_CONTACTS]: staleRead({ contacts: [] }) };
    wrapped(<AIDraftPage />);
    expect(alerts()).toContain('Could not refresh the Contact search, so what is listed below is the last read: Request failed (504).');
    expect(claimsOutsideAlerts(/Failed to load the Contact search/)).toEqual([]);
  });

  it('a refusal with no message names the server, not undefined', () => {
    registry.byUrl = { [TEMPLATES]: ok(templatesPayload), [SEARCH_CONTACTS]: staleRead(searchPayload, '') };
    wrapped(<AIDraftPage />);
    expect(alerts()).toContain('the last read: no response from the server');
    expect(alerts()).not.toMatch(/undefined|\bnull\b/);
  });

  it('the two reads are keyed apart, and each retry re-runs only its own read', () => {
    const t = staleRead(templatesPayload);
    const s = staleRead(searchPayload);
    registry.byUrl = { [TEMPLATES]: t, [SEARCH_CONTACTS]: s };
    wrapped(<AIDraftPage />);
    expect(screen.queryAllByRole('alert')).toHaveLength(2);
    const retries = screen.getAllByRole('button', { name: /try again/i });
    fireEvent.click(retries[0]);
    expect(t.refetch).toHaveBeenCalledTimes(1);
    expect(s.refetch).not.toHaveBeenCalled();
    fireEvent.click(retries[1]);
    expect(s.refetch).toHaveBeenCalledTimes(1);
    expect(t.refetch).toHaveBeenCalledTimes(1);
  });

  it('switching the entity tab re-reads through the same three states', () => {
    registry.byUrl = {
      [TEMPLATES]: ok(templatesPayload),
      [SEARCH_CONTACTS]: ok(searchPayload),
      [SEARCH_DEALS]: failed('Request failed (500)', 500),
    };
    wrapped(<AIDraftPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Deal' }));
    expect(screen.getByRole('alert').textContent).toContain(
      'Failed to load the Deal search: Request failed (500). The match list is unanswered, and this is not a statement that nothing matched.',
    );
    registry.byUrl[SEARCH_DEALS] = staleRead({ deals: [{ id: 'dl-1', title: 'Acme renewal' }] });
    wrapped(<AIDraftPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Deal' }));
    expect(screen.getByText('Acme renewal')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the Deal search, so what is listed below is the last read');
  });
});

describe('the draft this page writes, printed beside the reads it is holding (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('a draft whose payload left out its numbers prints —, and the refused typeahead is still named', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        kind: 'email', subject: 'Renewal', body: 'Hi Ada', provider: 'openai', model: 'gpt-4o-mini',
        tokens_used: null, latency_ms: null, fallbacks_used: 0,
        activity_id: 'aa-1', template: 'quarterly-checkin',
      }),
    })));
    registry.byUrl = { [TEMPLATES]: ok(templatesPayload), [SEARCH_CONTACTS]: staleRead(searchPayload) };
    wrapped(<AIDraftPage />);
    fireEvent.click(screen.getByRole('button', { name: /Ada Oper/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate draft/i }));
    await waitFor(() => expect(screen.getByText(/— tokens/)).toBeTruthy());
    expect(screen.getByText(/—ms/)).toBeTruthy();
    expect(screen.queryByText(/0 tokens/)).toBeNull();
    expect(screen.getByText('Hi Ada')).toBeTruthy();
    // the write went through; the read that was refused is still described, and its rows are still
    // the ones the entity was picked from (the row prints twice: the list and the selection chip)
    expect(alerts()).toContain('Could not refresh the Contact search, so what is listed below is the last read');
    expect(screen.getAllByText('Ada Oper').length).toBeGreaterThan(0);
  });

  it('a generate that failed with nothing to say still says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(''); }));
    registry.byUrl = { [TEMPLATES]: ok(templatesPayload), [SEARCH_CONTACTS]: ok(searchPayload) };
    wrapped(<AIDraftPage />);
    fireEvent.click(screen.getByRole('button', { name: /Ada Oper/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate draft/i }));
    await waitFor(() => expect(screen.getByText('no response from the server')).toBeTruthy());
    // the validation sentence is a different problem, and must not be what this failure says
    expect(screen.queryByText('Pick a contact, deal or company first')).toBeNull();
    expect(alerts()).toBe('');
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const PAGE = 'app/tenant/ai/draft/page.tsx';
  const src = () => readFileSync(join(ROOT, PAGE), 'utf8');

  it('splits BOTH reads into three states, keyed on the payload and not the flag', () => {
    const text = src();
    expect(text).toMatch(/const templatesFailed = Boolean\(templatesError\) && !templatesData && !is404;/);
    expect(text).toMatch(/const templatesStale = Boolean\(templatesError\) && Boolean\(templatesData\) && !is404;/);
    expect(text).toMatch(/const templatesReason = templatesError\?\.message \|\| 'no response from the server';/);
    expect(text).toMatch(/const searchFailed = Boolean\(searchError\) && !searchData;/);
    expect(text).toMatch(/const searchStale = Boolean\(searchError\) && Boolean\(searchData\);/);
    expect(text).toMatch(/const searchReason = searchError\?\.message \|\| 'no response from the server';/);
    // …and the server's own answer about this account's access never folds into either arm.
    expect(text).toMatch(/const is404 = templatesError\?\.status === 404;/);
    expect(text, 'a refused refresh is reported as missing templates again')
      .not.toMatch(/templatesError && templatesError\.status !== 404 \?/);
  });

  it('stops the memo from turning a kept read into an empty list', () => {
    const text = src();
    expect(text, 'the memo still erases the last read on any error').not.toMatch(/if \(templatesError\) return \[\];/);
    expect(text).toMatch(/templatesData\?\.templates \?\? \[\]/);
    // the absence sentence cannot fire in either failure state
    expect(text).toMatch(/!templatesFailed && !templatesStale && templates !== null && templates\.length === 0/);
  });

  it('speaks its five banners verbatim, above what they describe, and binds each retry to its own read', () => {
    const text = src();
    expect(text).toContain(
      '`Failed to load your AI templates: ${templatesReason}. The picker is unanswered, and this is not a statement that you have nothing to pick.`',
    );
    expect(text).toContain(
      '`Could not refresh your AI templates, so the list below is the last read: ${templatesReason}. ' +
      'A template added, edited or removed since that read is missing or wrong here, and Generate drafts from what is listed.`',
    );
    expect(text).toContain(
      '`Could not refresh your AI templates, so the empty picker below is the last read: ${templatesReason}. ' +
      'A template created since that read is not offered here, and this is not a statement that you have none.`',
    );
    expect(text).toContain(
      '`Failed to load the ${searchCfg.label} search: ${searchReason}. The match list is unanswered, and this is not a statement that nothing matched.`',
    );
    expect(text).toContain(
      '`Could not refresh the ${searchCfg.label} search, so what is listed below is the last read: ${searchReason}. ' +
      'An entity added, renamed or removed since that read is wrong here, and Generate drafts against it.`',
    );
    expect(text.match(/onRetry=\{refetchTemplates\}/g)).toHaveLength(2);
    expect(text.match(/onRetry=\{refetchSearch\}/g)).toHaveLength(2);
    expect(text, 'a retry became a full page reload').not.toMatch(/location\.reload|window\.location/);
    expect(text, 'a retry became a queue-wide invalidation').not.toMatch(/invalidateQueries/);
    // each caveat precedes the region it is holding still
    expect(text.indexOf('{templatesStale')).toBeLessThan(text.indexOf('templates?.map'));
    expect(text.indexOf('{searchStale')).toBeLessThan(text.indexOf('entityHits.map'));
  });

  it('leaves no message printed raw, and dashes the two numbers a payload may leave out', () => {
    const text = src();
    expect(text, 'a banner interpolated the message instead of the reason').not.toMatch(/templatesError\.message \|\|/);
    expect(text, 'the write failure entered state with its message un-defaulted')
      .toMatch(/onError: \(e: Error\) => setError\(e\.message \|\| 'no response from the server'\),/);
    expect((text.match(/no response from the server/g) ?? []), 'every printed message has the fallback')
      .toHaveLength(3);
    expect(text).toMatch(/draft\.tokens_used \?\? '—'/);
    expect(text).toMatch(/draft\.latency_ms \?\? '—'/);
    expect(text).toMatch(/tokens_used: number \| null;/);
    expect(text, 'a left-out count printed as a zero').not.toMatch(/tokens_used \?\? 0/);
  });

  it('does not gate what a refused refresh does not make wrong', () => {
    const text = src();
    expect(text, 'the outage early-return took over a region the banner already owns')
      .not.toMatch(/if \(templatesFailed\) return;/);
    expect(text, 'Generate was disabled over a kept read').not.toMatch(/disabled=\{busy !== null \|\| !selectedEntity \|\|/);
    expect(text).toMatch(/disabled=\{busy !== null \|\| !selectedEntity\}/);
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const doc = JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'));
    const files = Object.keys(doc.files ?? doc);
    expect(files, `${PAGE} was baselined`).not.toContain(PAGE);
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('stays inside the line ceiling the page is allowed', () => {
    const lines = src().split('\n').length - 1;
    expect(lines, `${PAGE} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('owns this page: #2829 keeps its outage copy, and nobody else starts claiming this one', () => {
    const dir = join(ROOT, 'tests/unit');
    const own = 'panel-page-error-not-empty-ai-draft-stale-2872.test.tsx';
    const speakers = readdirSync(dir)
      .filter((f) => f.endsWith('.test.tsx'))
      .filter((f) => /tenant\/ai\/draft\/page/.test(readFileSync(join(dir, f), 'utf8')))
      .sort();
    expect(speakers).toEqual([own, 'panel-page-error-not-empty-tenant-ai-2829.test.tsx'].sort());
    // #2829 owns the never-answered half; it must not start speaking about a kept read.
    expect(readFileSync(join(dir, 'panel-page-error-not-empty-tenant-ai-2829.test.tsx'), 'utf8'))
      .not.toMatch(/last read|refused refresh|Could not refresh/);
    expect(readFileSync(join(dir, own), 'utf8')).toMatch(/last read/);
  });
});
