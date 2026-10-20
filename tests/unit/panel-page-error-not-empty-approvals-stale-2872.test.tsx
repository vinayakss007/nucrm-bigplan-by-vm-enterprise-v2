// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/approvals/page.tsx`, the queue a manager decides from.
 *
 * One flag answered two questions: `const queryErrorMsg = queryError ? (queryError.message ||
 * 'Failed to load') : null`. Both answers were lies. Approve/Reject call
 * `invalidateQueries(['tenant','approvals'])`, the failure strip rendered off that flag and the
 * rows were gated on `data`, so a refused refresh left the whole queue on screen while the banner
 * above it announced the queue could not be loaded. The other half is worse because it is acted
 * on: after a read that never answered, `data?.summary` is unset, so the three cards printed
 * Pending 0 · Approved 0 · Rejected 0 and every filter chip printed 0. `summary` is not the view's
 * tally — app/api/tenant/approvals/route.ts:88-95 groups by status under the tenant clause only,
 * while the rows honour the status filter — so "0 pending" is a claim that nobody is waiting on
 * this approver, invented from a request that never came back. #2829 dashed exactly that class of
 * figure on the money panels whose numbers come off a rendered array; this page reads the server's
 * `summary`, so the sweep never reached it, and there was no outage copy here to preserve — the
 * bare flag printed the raw message.
 *
 * The two arms are pinned against each other. A refused refresh keeps rows, figures, chip counts
 * and the decision buttons, and names what it hides: a request another admin decided in the
 * meantime is still shown as pending, and the three tenant-wide totals are the older ones. The
 * buttons staying live is deliberate and verified against the server —
 * app/api/tenant/approvals/[id]/route.ts:57-62 re-reads the row by id and tenant, :63-65 404s when
 * it is gone, and :66-70 answers 409 with the row's real status when it is no longer pending, so a
 * decision on a stale row is refused with the truth rather than applied twice on a guess. An
 * outage, conversely, dashes every figure and never reaches a row, so it cannot drive a decision
 * button at all.
 *
 * `scripts/check-panel-error-state.mjs` reports this file clean before and after the split is
 * rewound — the sweep asks whether a panel binds an error and renders a failure affordance, and
 * this page already did both. These assertions are the only thing keeping the stale half honest.
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

import ApprovalsPage from '@/app/tenant/approvals/page';

// `qs` sets status then limit, and the status is in the key, so each view is its own read.
const PENDING = '/api/tenant/approvals?status=pending&limit=50';
const APPROVED = '/api/tenant/approvals?status=approved&limit=50';
const ALL = '/api/tenant/approvals?status=all&limit=50';

const NOW = '2026-03-02T10:00:00.000Z';
const row = (
  id: string,
  status: 'pending' | 'approved' | 'rejected',
  name: string,
  entity_type = 'deal',
) => ({
  id,
  entity_type,
  entity_id: `${id}-entity`,
  rule_id: `rule-high-value-${id}`,
  status,
  reason: status === 'rejected' ? 'Discount beyond the margin floor' : null,
  requested_at: NOW,
  decided_at: status === 'pending' ? null : NOW,
  requested_by_id: `u-${id}`,
  requested_by_name: name,
  requested_by_email: `${name.toLowerCase().replace(/\W+/g, '.')}@acme.test`,
  decided_by_name: status === 'pending' ? null : 'Deepa Iyer',
});
// The summary is the tenant's totals per status, independent of which view is open, so the chip
// for a queue of three rows can legitimately read 21.
const summary = { pending: 7, approved: 21, rejected: 4 };
const payload = {
  rows: [
    row('p1', 'pending', 'Kestrel Vane'),
    row('a2', 'approved', 'Imran Shaikh', 'contact'),
    row('r3', 'rejected', 'Priya Nair', 'ticket'),
  ],
  pagination: { limit: 50, offset: 0, total: 3 },
  summary,
};
const approvedPayload = {
  rows: [row('a2', 'approved', 'Imran Shaikh', 'contact')],
  pagination: { limit: 50, offset: 0, total: 21 },
  summary,
};
const emptyPayload = {
  rows: [],
  pagination: { limit: 50, offset: 0, total: 0 },
  summary: { pending: 0, approved: 0, rejected: 0 },
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failedRead = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before; this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
/** Stat is `<p>{label}</p><p class="text-3xl">{value}</p>` in one card. Queried on `p` because
 *  the filter chips carry the same three words as buttons. */
const statValue = (label: string) => {
  const ps = [...document.querySelectorAll('p')].filter((el) => el.textContent === label);
  expect(ps.length, `expected one "${label}" stat label, saw ${ps.length}`).toBe(1);
  const card = ps[0].parentElement;
  expect(card, `the "${label}" card lost its wrapper`).not.toBeNull();
  return (card?.textContent ?? '').slice(label.length).trim();
};
const chipEl = (label: string) => {
  const chips = [...document.querySelectorAll('button')].filter((el) => (el.textContent ?? '').startsWith(label));
  expect(chips.length, `expected one "${label}" chip, saw ${chips.length}`).toBe(1);
  return chips[0];
};
const chipCount = (label: string) => (chipEl(label).querySelector('span')?.textContent ?? '').trim();
const openChip = (label: string) => fireEvent.click(chipEl(label));
const requesters = () =>
  [...document.querySelectorAll('p')]
    .map((el) => el.textContent ?? '')
    .filter((t) => t.startsWith('Requested by'))
    .map((t) => t.replace(/^Requested by /, '').split(' · ')[0]);
const buttonsLabeled = (text: string) =>
  [...document.querySelectorAll('button')].filter((el) => (el.textContent ?? '').trim() === text);
const emptySentence = () =>
  [...document.querySelectorAll('p')]
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .find((t) => /^No .*approval requests\.$/.test(t)) ?? '';

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const showPending = () => wrapped(<ApprovalsPage />);

describe('a refused refresh keeps the queue, the figures and the counts (#2872)', () => {
  beforeEach(() => {
    registry.byUrl = { [PENDING]: staleRead(payload), [ALL]: ok({ ...payload }), [APPROVED]: ok(approvedPayload) };
    vi.clearAllMocks();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps all three requests and says they are the last read, with the reason', () => {
    showPending();
    expect(requesters()).toEqual(['Kestrel Vane', 'Imran Shaikh', 'Priya Nair']);
    expect(alerts()).toContain('Could not refresh, so the approvals below, the three figures and the chip counts are the last read: Request failed (504)');
  });

  it('does not tell the operator the queue could not be loaded while it is on screen', () => {
    showPending();
    expect(alerts()).not.toContain('Failed to load approvals');
    expect(document.body.textContent ?? '').not.toMatch(/failed to load/i);
    // One banner only — the caveat. main put the raw `queryError.message` in a strip above the
    // kept rows and gave it no role at all, so both the count and the copy are needed to pin it.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alerts().match(/Request failed \(504\)/g)).toHaveLength(1);
  });

  it('keeps the three figures rather than zeroing them with the banner', () => {
    showPending();
    expect(statValue('Pending')).toBe('7');
    expect(statValue('Approved')).toBe('21');
    expect(statValue('Rejected')).toBe('4');
  });

  it('keeps the chip counts that came with the read', () => {
    showPending();
    expect(chipCount('Pending')).toBe('7');
    expect(chipCount('Approved')).toBe('21');
    expect(chipCount('Rejected')).toBe('4');
    expect(chipCount('All')).toBe('32');
  });

  it('names what a refused refresh actually hides here, not a vague warning', () => {
    showPending();
    expect(alerts()).toMatch(/another admin approved or rejected/);
    expect(alerts()).toMatch(/still listed here as pending with its decision buttons live/);
    expect(alerts()).toMatch(/Pending\/Approved\/Rejected are the older tenant-wide totals/);
    expect(alerts()).not.toMatch(/may be out of date/i);
  });

  it('keeps the decision buttons live over kept rows — verified, not assumed', () => {
    showPending();
    // PATCH re-reads the row by id + tenant (approvals/[id]/route.ts:57-62), 404s when it is
    // gone (:63-65) and refuses a row that is no longer pending with a 409 naming its real
    // status (:66-70). So deciding a stale row is answered by the server with the truth; the
    // banner warns instead of disabling, and the one pending row keeps both buttons.
    expect(buttonsLabeled('Approve')).toHaveLength(1);
    expect(buttonsLabeled('Approve')[0].disabled).toBe(false);
    expect(buttonsLabeled('Reject')).toHaveLength(1);
    expect(requesters()).toContain('Kestrel Vane');
  });

  it('reports a decision the server refused as a refused decision, never as a lost read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Approval request is already approved — cannot approve' }),
    }));
    showPending();
    fireEvent.click(buttonsLabeled('Approve')[0]);
    await waitFor(() => expect(alerts()).toContain('already approved — cannot approve'));
    // An action failure does not eat the queue: the rows and the figures stay, and the read is
    // not suddenly reported as never having answered.
    expect(requesters()).toHaveLength(3);
    expect(statValue('Pending')).toBe('7');
    expect(alerts()).not.toContain('Failed to load approvals');
  });

  it('re-runs this read from the caveat', () => {
    const result = staleRead(payload);
    registry.byUrl = { [PENDING]: result };
    showPending();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('the read that never answered dashes the figures instead of reporting zero (#2872)', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows the outage card and dashes all three figures', () => {
    registry.byUrl = { [PENDING]: failedRead() };
    showPending();
    expect(alerts()).toContain('Failed to load approvals: Request failed (500)');
    expect(statValue('Pending')).toBe('—');
    expect(statValue('Approved')).toBe('—');
    expect(statValue('Rejected')).toBe('—');
    expect(statValue('Pending')).not.toContain('0');
    expect(statValue('Approved')).not.toContain('0');
  });

  it('dashes every chip count but leaves the chips clickable', () => {
    registry.byUrl = { [PENDING]: failedRead(), [ALL]: ok(payload) };
    showPending();
    expect(chipCount('Pending')).toBe('—');
    expect(chipCount('All')).toBe('—');
    openChip('All');
    expect(requesters()).toHaveLength(3);
  });

  it('drives no decision button off a queue it never read', () => {
    registry.byUrl = { [PENDING]: failedRead() };
    showPending();
    expect(requesters()).toHaveLength(0);
    expect(buttonsLabeled('Approve')).toHaveLength(0);
    expect(buttonsLabeled('Reject')).toHaveLength(0);
  });

  it('never claims the queue is empty when the read is what failed', () => {
    registry.byUrl = { [PENDING]: failedRead() };
    showPending();
    expect(emptySentence()).toBe('');
  });

  it('names the server rather than printing undefined when the refusal has no message', () => {
    registry.byUrl = { [PENDING]: { data: undefined, error: new Error(''), isLoading: false, refetch: vi.fn() } };
    showPending();
    expect(alerts()).toContain('Failed to load approvals: no response from the server');
    expect(alerts()).not.toMatch(/undefined/);
  });

  it('re-runs the outage from its own retry, once', () => {
    const result = failedRead();
    registry.byUrl = { [PENDING]: result };
    showPending();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('reads a genuine zero as a zero, with no alert and no dash', () => {
    registry.byUrl = { [PENDING]: ok(emptyPayload) };
    showPending();
    expect(emptySentence()).toBe('No pending approval requests.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(statValue('Pending')).toBe('0');
    expect(statValue('Approved')).toBe('0');
    expect(chipCount('All')).toBe('0');
  });

  it('still says none are pending, with the caveat over it, when that is all the last read had', () => {
    registry.byUrl = { [PENDING]: staleRead(emptyPayload) };
    showPending();
    expect(emptySentence()).toBe('No pending approval requests.');
    expect(alerts()).toMatch(/last read/i);
    expect(statValue('Pending')).toBe('0');
  });
});

describe('each view is its own read, and each is judged on its own (#2872)', () => {
  afterEach(cleanup);

  it('calls a view that never answered an outage, not a stale copy of the view it left', () => {
    registry.byUrl = { [PENDING]: staleRead(payload), [ALL]: failedRead('Request failed (503)') };
    showPending();
    openChip('All');
    expect(alerts()).toContain('Failed to load approvals: Request failed (503)');
    expect(alerts()).not.toMatch(/last read/i);
    expect(requesters()).toHaveLength(0);
    // The dashes belong to the view that never answered; the kept view\'s numbers are gone with it.
    expect(statValue('Pending')).toBe('—');
  });

  it('gives the view you came back to its rows and its caveat, not the outage you just saw', () => {
    registry.byUrl = { [PENDING]: staleRead(payload), [ALL]: failedRead() };
    showPending();
    openChip('All');
    openChip('Pending');
    expect(requesters()).toHaveLength(3);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).not.toContain('Failed to load approvals');
    expect(statValue('Pending')).toBe('7');
    expect(chipCount('All')).toBe('32');
  });

  it('judges a filter opened for the first time by that filter\'s read, not by the one before it', () => {
    registry.byUrl = { [PENDING]: ok(payload), [APPROVED]: failedRead('Request failed (502)') };
    showPending();
    expect(screen.queryByRole('alert')).toBeNull();
    openChip('Approved');
    expect(alerts()).toContain('Failed to load approvals: Request failed (502)');
    expect(statValue('Rejected')).toBe('—');
    expect(buttonsLabeled('Approve')).toHaveLength(0);
  });

  it('shows the kept rows and no alert at all once the refresh answers', () => {
    registry.byUrl = { [PENDING]: ok(payload), [ALL]: ok(payload) };
    showPending();
    expect(requesters()).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(statValue('Approved')).toBe('21');
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/approvals/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits the read instead of branching on the bare flag', () => {
    const s = src();
    expect(s, 'a refused refresh still judged as no data at all').toMatch(/const failed = Boolean\(queryError\) && !data;/);
    expect(s).toMatch(/const stale = Boolean\(queryError\) && Boolean\(data\);/);
    expect(s).toMatch(/const reason = queryError\?\.message \|\| 'no response from the server';/);
    expect(s, 'the old one-flag collapse is still there').not.toMatch(/queryError \? \(queryError\.message \|\| 'Failed to load'\) : null/);
    expect(s, 'the single flag is still feeding a banner').not.toMatch(/queryErrorMsg/);
    expect(s).toMatch(/\{stale && \(/);
    expect(s).toMatch(/\{error && \(/);
  });

  it('gates every figure the read produces, not just the banner', () => {
    const s = src();
    const dashed = (s.match(/failed \? '—'/g) ?? []).length;
    expect(dashed, 'a card or a chip count still reports 0 for an unread summary').toBeGreaterThanOrEqual(4);
    expect(s).toMatch(/const count = failed \? '—'/);
    expect(s, 'a stat still reads the summary unguarded').not.toMatch(/value=\{summary\.pending\}/);
    expect(s, 'a stat still reads the summary unguarded').not.toMatch(/value=\{summary\.approved\}/);
    expect(s).toMatch(/value=\{failed \? '—' : summary\.pending\}/);
  });

  it('keeps the rows and the empty card off the bare flag, and the decisions off both flags', () => {
    const s = src();
    expect(s, 'an arm still reads the bare queryError').not.toMatch(/!loading && !queryError/);
    expect(s, 'the empty card is gated on the flag rather than on data').toMatch(/!loading && data && data\.rows\.length === 0/);
    // Deliberate, and pinned because the route earns it (approvals/[id]/route.ts:57-70): a
    // stale row may still be decided — the server re-reads it and 409s if it is not pending.
    // Neither flag may disable a decision, and neither may create one.
    expect(s, 'a decision button is gated on the read flags').not.toMatch(/disabled=\{[^}]*\b(failed|stale)\b/);
    expect(s).toMatch(/disabled=\{busyId === row\.id\}/);
  });

  it('reports the page clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [string, string][] = [
      [/const failed = Boolean\(queryError\) && !data;[^\n]*\n\s*const stale = Boolean\(queryError\) && Boolean\(data\);/,
       'const failed = Boolean(queryError);'],
      [/\{stale && \(/, '{false && ('],
      [/const count = failed \? '—'/, "const count = failed ? 0"],
    ];
    for (const [pattern, replacement] of rewinds) {
      const s = src();
      expect(s, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(inspect(FILE, s).offends, `${FILE} was already on the guard's list`).toBe(false);
      expect(
        inspect(FILE, s.replace(pattern, replacement)).offends,
        `the guard would catch this rewind after all: ${replacement}`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    expect(files, 'approvals went back on the list it was never on').not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps the file inside the size ceiling', () => {
    expect(src().split('\n').length, 'past the 500-line ceiling').toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
