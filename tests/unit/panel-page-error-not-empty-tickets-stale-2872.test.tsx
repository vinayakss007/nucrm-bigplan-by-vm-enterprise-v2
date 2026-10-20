// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the helpdesk list and the ticket record: `app/tenant/tickets/page.tsx` and
 * `app/tenant/tickets/[id]/page.tsx`. Both read through `useApiQuery` (lib/query/client.tsx:
 * `staleTime: 30_000`, `retry: 2`, so a background revalidation of a query that already
 * answered leaves `data` in place while `error` is set) and both looked only at the flag.
 *
 * The list page had #2829's banner and got the worse half of the same split backwards. Its
 * own writes produce the refused refresh: `bulkActionMutation.onSuccess` and the create
 * modal's `onCreated` both call `loadTickets()`, which invalidates the prefix
 * `['tenant','tickets']` — and the current view's key is `['tenant','tickets',
 * {filter, search, offset}]`, so it is inside that prefix. Branching on `ticketsError`
 * therefore deleted the rows one second after a bulk Resolve and reported "Failed to load
 * tickets" over a page that had just been told the write succeeded, while the four stat
 * cards above it printed `0 Open / 0 Urgent` from the array it had thrown away. Because
 * `filter`, `search` and `offset` are in the key AND in the URL — the server narrows, the
 * page does not — a status tab nobody has opened is a read that never answered (`failed`),
 * not a last read of the tab they came from; and a search that came back with nothing is a
 * server-answered miss, which stays "No tickets found" and never becomes an outage claim.
 *
 * The detail page was the raw toast-only shape, and worse than the brief's census predicts:
 * `useEffect(() => { if (error) { toast.error(…); router.push('/tenant/tickets'); } })`.
 * `invalidate()` targets `TICKET_QUERY` exactly — the same key the page reads — after every
 * reply and every status change, so the routine state after sending a reply was: keep the
 * error flag, toast for four seconds, and throw the ticket the operator is working on away
 * by navigating to the list. `if (!ticket) return null` then left a blank screen for a read
 * that never answered at all. Replies and the Customer History aside ride inside this one
 * response (`ticket.replies`, `ticket.customer`), so there is no second read on the page:
 * one refusal stales the whole record, and there is no sibling key to retry by mistake.
 *
 * Per page: `failed = Boolean(error) && !data` renders the outage with the reason; `stale =
 * Boolean(error) && Boolean(data)` keeps what is on screen and adds a "last read" caveat
 * naming the action whose refresh was refused; every derived figure keys off `failed`.
 *
 * RED AT BASE. Against the two pages as they are on `origin/main`, measured by rewinding
 * them and running this file: 20 failed | 10 passed (30). The ten that pass at base are the
 * controls — the list page's honest server-answered search miss and its genuine zero, the
 * detail page's actionable record / real tallies / clean success render, the two
 * mutation-toast and overlap-hygiene pins, and the three ratchet pins that only read the
 * source or run the guards (one read on the detail page, an empty baseline, the line
 * ceiling). None of the stale-state cases pass at base: the list page had already committed
 * to the outage, and the detail page had no channel at all. They must keep passing.
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
const pushSpy = vi.hoisted(() => vi.fn());

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
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'tk-1' }),
  useRouter: () => ({ push: pushSpy, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/tickets',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import TicketsPage from '@/app/tenant/tickets/page';
import TicketDetailPage from '@/app/tenant/tickets/[id]/page';

/** The list page builds `?limit&offset` first, then appends `status` and `q` — the URL is the
 *  key's `{filter, search, offset}` spelled out. Drift here is the test failing correctly. */
const LIST = '/api/tenant/tickets?limit=50&offset=0';
const LIST_OPEN = '/api/tenant/tickets?limit=50&offset=0&status=open';
const LIST_SEARCH = '/api/tenant/tickets?limit=50&offset=0&q=zzz-no-match';
const DETAIL = '/api/tenant/tickets/tk-1';

const ROW = {
  id: 'tk-1', subject: 'Scanner pairs then drops', body: 'Reproducible on dock 3.',
  status: 'open', priority: 'urgent', category: 'hardware',
  created_at: '2026-10-01T00:00:00Z', first_name: 'Kestrel', last_name: 'Vane', assigned_name: null,
};
const RESOLVED = { ...ROW, id: 'tk-2', subject: 'Invoice PDF will not download', status: 'resolved', priority: 'low' };

/** `{ data, total }`, the envelope the list endpoint answers with. */
const page = (rows: unknown[]) => ({ data: rows, total: rows.length });

const TICKET = {
  ...ROW,
  replies: [
    { id: 'rp-1', body: 'Tried a fresh pairing on dock 3 — same drop.', created_at: '2026-10-02T00:00:00Z', author_name: 'Ada Operator', is_internal: false },
  ],
  customer: {
    contact_id: 'ct-1', contact_name: 'Kestrel Vane', contact_email: 'kestrel@acme.test',
    company_id: 'co-1', company_name: 'Northwind Freight',
    deals: [{ id: 'dl-1', title: 'Dock scanner rollout', amount: '18000', stage_name: 'Qualified', created_at: '2026-09-01T00:00:00Z' }],
    invoices: [{ id: 'in-1', invoice_number: 'INV-2041', status: 'sent', total_amount: '4200.00', currency: 'USD', issue_date: '2026-10-01T00:00:00Z', due_date: '2026-10-31T00:00:00Z' }],
  },
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the rows are cached, the refresh refused. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

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

/** The stat card is `<p>{value}</p>` next to `<p>{label}</p>`; climb to the pair so the dash is
 *  read out of the card that owns it instead of matching a `—` somewhere else on the page. */
const statCard = (label: string) =>
  screen.getByText(label).closest('div')?.textContent ?? '';

beforeEach(() => { registry.byUrl = {}; pushSpy.mockClear(); vi.clearAllMocks(); });
afterEach(cleanup);

describe('tickets list: a refused refresh keeps the rows it just changed (#2872)', () => {
  const OUTAGE = /Failed to load tickets/;
  const CAVEAT = /the tickets below are the last read/;

  it('keeps the rows, the pager and the counts, and says they are the last read', () => {
    const result = staleRead(page([ROW, RESOLVED]));
    registry.byUrl = { [LIST]: result };
    wrapped(<TicketsPage />);
    // `loadTickets()` invalidates the ['tenant','tickets'] prefix after bulk Resolve /
    // Priority / Delete and after the create modal, so this is the page's own state right
    // after the operator acted — not a server problem.
    expect(screen.getByText('Scanner pairs then drops')).toBeTruthy();
    expect(screen.getByText('Invoice PDF will not download')).toBeTruthy();
    expect(alerts()).toContain('the tickets below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).not.toMatch(OUTAGE);
    expect(screen.queryByText('No tickets found')).toBeNull();
    // Nothing was thrown away, so the derived figures still count what is on screen.
    expect(statCard('Open')).toContain('1Open');
    expect(statCard('Urgent')).toContain('1Urgent');
    expect(statCard('Resolved')).toContain('1Resolved');
    expect(screen.getByText(/2 tickets on this page/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('the caveat retries this view and not the tab that was never fetched', () => {
    const here = staleRead(page([ROW]));
    const sibling = ok(page([]));
    registry.byUrl = { [LIST]: here, [LIST_OPEN]: sibling };
    wrapped(<TicketsPage />);
    expect(alerts()).toMatch(CAVEAT);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(here.refetch).toHaveBeenCalledTimes(1);
    expect(sibling.refetch).not.toHaveBeenCalled();
  });

  it('a status tab nobody opened is an outage, not somebody else’s last read', () => {
    // {filter} is part of the key and of the URL: the 'open' view has never answered, so
    // calling its failure "the last read" would claim a freshness nobody has.
    registry.byUrl = { [LIST]: staleRead(page([ROW])), [LIST_OPEN]: failed('Request failed (503)') };
    wrapped(<TicketsPage />);
    expect(alerts()).toMatch(CAVEAT);
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    expect(alerts()).toContain('Failed to load tickets: Request failed (503)');
    expect(alerts()).not.toMatch(/last read/);
    expect(screen.queryByText('No tickets found')).toBeNull();
    // The rows belong to the other key; this view never had them.
    expect(screen.queryByText('Scanner pairs then drops')).toBeNull();
  });

  it('a search that answered with nothing stays an honest miss, never an outage', () => {
    registry.byUrl = { [LIST]: ok(page([ROW, RESOLVED])), [LIST_SEARCH]: ok(page([])) };
    wrapped(<TicketsPage />);
    fireEvent.change(screen.getByPlaceholderText(/search tickets/i), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('No tickets found')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(alerts()).not.toMatch(OUTAGE);
    // The server answered this view with zero rows, so zero is what the cards say.
    expect(statCard('Open')).toContain('0Open');
  });

  it('an unread list is still the outage #2829 added, with the reason and no sentence', () => {
    registry.byUrl = { [LIST]: failed('Request failed (500)') };
    wrapped(<TicketsPage />);
    expect(alerts()).toContain('Failed to load tickets: Request failed (500)');
    expect(screen.queryByText('No tickets found')).toBeNull();
    expect(screen.queryByText(/Want to automate support\?/)).toBeNull();
    expect(alerts()).not.toMatch(/last read/);
    expect(alerts()).not.toMatch(/last read/);
    // Four cards that reduce the array the page never got.
    expect(statCard('Open')).toContain('—');
    expect(statCard('In Progress')).toContain('—');
    expect(statCard('Resolved')).toContain('—');
    expect(statCard('Urgent')).toContain('—');
    expect(screen.queryByText('0Open')).toBeNull();
    // No row controls exist to write against: the whole rows branch, select-all bar and
    // pager included, is unreachable, so the bulk mutation has nothing to act on.
    expect(screen.queryByText(/tickets on this page/)).toBeNull();
  });

  it('a refusal that arrives without a message still names the server', () => {
    registry.byUrl = { [LIST]: staleRead(page([ROW]), '') };
    wrapped(<TicketsPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Scanner pairs then drops')).toBeTruthy();
  });

  it('a genuine zero is still a zero, and the upsell keeps its place', () => {
    registry.byUrl = { [LIST]: ok({ data: [], total: 0 }) };
    wrapped(<TicketsPage />);
    expect(screen.getByText('No tickets found')).toBeTruthy();
    expect(screen.getByText(/Want to automate support\?/)).toBeTruthy();
    expect(statCard('Open')).toContain('0Open');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stale over an empty answer says none AND carries the caveat', () => {
    registry.byUrl = { [LIST]: staleRead({ data: [], total: 0 }) };
    wrapped(<TicketsPage />);
    expect(screen.getByText('No tickets found')).toBeTruthy();
    expect(alerts()).toMatch(CAVEAT);
    // The list sentence may state the last read; the marketing block below it may not
    // pile a second claim onto a page whose refresh was just refused.
    expect(screen.queryByText(/Want to automate support\?/)).toBeNull();
  });

  it('a kept row is still clickable and still selectable under a stale read', () => {
    registry.byUrl = { [LIST]: staleRead(page([ROW])) };
    wrapped(<TicketsPage />);
    // The rows survived the refused refresh, so the row's own navigation and its bulk
    // checkboxes stay attached — they address a ticket by id, server-side.
    fireEvent.click(screen.getByText('Scanner pairs then drops'));
    expect(pushSpy).toHaveBeenCalledWith('/tenant/tickets/tk-1');
    expect(screen.getByRole('button', { name: 'all' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New Ticket' })).toBeTruthy();

    const selectAll = screen.getByText(/tickets on this page/).closest('div')?.querySelector('button');
    expect(selectAll).toBeTruthy();
    fireEvent.click(selectAll as Element);
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy();
  });

  it('walks the bulk path: read, refused revalidation, read again', () => {
    registry.byUrl = { [LIST]: ok(page([ROW])) };
    const view = wrapped(<TicketsPage />);
    expect(screen.queryByRole('alert')).toBeNull();

    registry.byUrl = { [LIST]: staleRead(page([ROW])) };
    view.rerender(tree(<TicketsPage />));
    expect(screen.getByText('Scanner pairs then drops')).toBeTruthy();
    expect(alerts()).toMatch(CAVEAT);
    expect(screen.queryByText(OUTAGE)).toBeNull();

    registry.byUrl = { [LIST]: ok(page([ROW])) };
    view.rerender(tree(<TicketsPage />));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Scanner pairs then drops')).toBeTruthy();
  });
});

describe('ticket detail: a refused refresh keeps the ticket it loaded (#2872)', () => {
  const CAVEAT = /the ticket below is the last read/;

  it('keeps the subject, body, replies and customer aside, and says they are the last read', () => {
    const result = staleRead({ data: TICKET });
    registry.byUrl = { [DETAIL]: result };
    wrapped(<TicketDetailPage />);
    expect(screen.getByText('Scanner pairs then drops')).toBeTruthy();
    expect(screen.getByText('Reproducible on dock 3.')).toBeTruthy();
    expect(screen.getByText('Tried a fresh pairing on dock 3 — same drop.')).toBeTruthy();
    expect(screen.getByText('Ada Operator')).toBeTruthy();
    expect(screen.getByText('Northwind Freight')).toBeTruthy();
    expect(alerts()).toContain('the ticket below is the last read');
    expect(alerts()).toContain('A reply you just sent or a status you just changed may not be reflected here');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText(/Failed to load ticket/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('does not bounce the operator off the ticket they are working on', async () => {
    // The old effect pushed /tenant/tickets whenever the flag was set, so sending a reply
    // and having the revalidation refused navigated away from the record just written.
    registry.byUrl = { [DETAIL]: staleRead({ data: TICKET }) };
    wrapped(<TicketDetailPage />);
    await waitFor(() => expect(alerts()).toMatch(CAVEAT), { interval: 10 });
    expect(pushSpy).not.toHaveBeenCalledWith('/tenant/tickets');
    expect(screen.getByText('Scanner pairs then drops')).toBeTruthy();
  });

  it('the kept ticket is still actionable', () => {
    registry.byUrl = { [DETAIL]: staleRead({ data: TICKET }) };
    wrapped(<TicketDetailPage />);
    const status = screen.getByRole('button', { name: 'resolved' });
    expect(status.disabled).toBe(false);
    fireEvent.click(status);
    const box = screen.getByPlaceholderText(/write a reply/i) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Following up on the last read.' } });
    expect((screen.getByRole('button', { name: /send reply/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('its counters count the record it is holding', () => {
    registry.byUrl = { [DETAIL]: staleRead({ data: TICKET }) };
    wrapped(<TicketDetailPage />);
    expect(screen.getByText(/Deals \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Invoices \(1\)/));
    expect(screen.getByText('$4,200.00').textContent).toBeTruthy();
  });

  it('an unread ticket is an outage, and writes against it are not offered', () => {
    registry.byUrl = { [DETAIL]: failed('Request failed (500)') };
    wrapped(<TicketDetailPage />);
    expect(alerts()).toContain('Failed to load ticket: Request failed (500)');
    expect(alerts()).not.toMatch(/last read/);
    expect(screen.queryByText('No replies yet')).toBeNull();
    expect(screen.queryByText(/isn't linked to a contact or company/)).toBeNull();
    // The aside's tallies cannot print a false zero: the record is not on the screen.
    expect(document.body.textContent).not.toMatch(/Deals \(/);
    expect(screen.queryByPlaceholderText(/write a reply/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'resolved' })).toBeNull();
    expect(pushSpy).not.toHaveBeenCalledWith('/tenant/tickets');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[DETAIL].refetch).toHaveBeenCalledTimes(1);
  });

  it('a refusal with no message falls back to the server', () => {
    registry.byUrl = { [DETAIL]: staleRead({ data: TICKET }, '') };
    wrapped(<TicketDetailPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Scanner pairs then drops')).toBeTruthy();
  });

  it('an answered-but-absent record says so with no alert', () => {
    registry.byUrl = { [DETAIL]: ok({ data: null }) };
    wrapped(<TicketDetailPage />);
    expect(screen.getByText('Ticket not found')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('stale over an empty answer says not found AND carries the caveat', () => {
    registry.byUrl = { [DETAIL]: staleRead({ data: null }) };
    wrapped(<TicketDetailPage />);
    expect(screen.getByText('Ticket not found')).toBeTruthy();
    expect(alerts()).toMatch(/last read/);
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [DETAIL]: ok({ data: TICKET }) };
    wrapped(<TicketDetailPage />);
    expect(screen.getByText('Scanner pairs then drops')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('overlap hygiene with #2829 (#2872)', () => {
  it('the read state lives in the panel, not in a fading toast', async () => {
    registry.byUrl = { [DETAIL]: failed('Request failed (500)') };
    wrapped(<TicketDetailPage />);
    await waitFor(() => expect(alerts()).toMatch(/Failed to load ticket/), { interval: 10 });
    expect(document.body.textContent).not.toMatch(/No replies yet/);

    registry.byUrl = { [LIST]: staleRead(page([ROW])) };
    wrapped(<TicketsPage />);
    expect(alerts()).toMatch(/the tickets below are the last read/);
  });

  it('keeps the mutation toasts the actions still need', () => {
    for (const f of ['app/tenant/tickets/page.tsx', 'app/tenant/tickets/[id]/page.tsx']) {
      expect(readFileSync(join(process.cwd(), f), 'utf8')).toMatch(/onError:.*toast\.error/);
    }
  });

  it('does not make #2829 speak about a kept read', () => {
    const prior = readFileSync(
      join(process.cwd(), 'tests/unit/panel-page-error-not-empty-money-path-2829.test.tsx'), 'utf8',
    );
    expect(prior).not.toMatch(/last read/);
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const LIST_FILE = 'app/tenant/tickets/page.tsx';
  const DETAIL_FILE = 'app/tenant/tickets/[id]/page.tsx';

  it('separates the two states on the list page', () => {
    const src = readFileSync(join(ROOT, LIST_FILE), 'utf8');
    expect(src).toMatch(/const failed = Boolean\(ticketsError\) && !ticketsResp;/);
    expect(src).toMatch(/const stale = Boolean\(ticketsError\) && Boolean\(ticketsResp\);/);
    expect(src).toMatch(/const reason = ticketsError\?\.message \|\| 'no response from the server';/);
    expect(src, 'the list branch still treats any error as an outage').not.toMatch(/\)\s*:\s*ticketsError \? \(/);
    expect(src).toMatch(/\) : failed \? \(/);
    expect(src).toMatch(/\{stale && \(/);
  });

  it('separates the two states on the detail page', () => {
    const src = readFileSync(join(ROOT, DETAIL_FILE), 'utf8');
    expect(src).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(src).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(src).toMatch(/const reason = error\?\.message \|\| 'no response from the server';/);
    expect(src).toMatch(/if \(failed\) return \(/);
    expect(src, 'a read that never answered may not render a blank page').not.toMatch(/if \(!ticket\) return null/);
  });

  it('retires the effect toast that carried the read failure, both pages', () => {
    for (const f of [LIST_FILE, DETAIL_FILE]) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still toasts the read failure from the render body`).not.toMatch(/^\s*if \(error\) toast\.error/m);
      expect(src, `${f} still routes a page state through an effect toast`)
        .not.toMatch(/useEffect\(\(\) => \{\s*if \(\w*[Ee]rror\) toast\.error/);
      expect(src, `${f} has no banner to carry the state instead`).toMatch(/InlineErrorState/);
    }
    // The detail page navigated away on the flag; that redirect is the whole bug there.
    expect(readFileSync(join(ROOT, DETAIL_FILE), 'utf8'))
      .not.toMatch(/if \(error\)[\s\S]{0,80}router\.push\('\/tenant\/tickets'\)/);
  });

  it('keys every derived figure off the outage, never off the flag', () => {
    const src = readFileSync(join(ROOT, LIST_FILE), 'utf8');
    for (const status of ['open', 'in_progress', 'resolved']) {
      expect(src, `the ${status} card still counts an unread list`)
        .toContain(`value: failed ? '—' : tickets.filter(t => t.status === '${status}').length`);
    }
    expect(src).toContain(`value: failed ? '—' : tickets.filter(t => t.priority === 'urgent').length`);
    expect(src).not.toMatch(/\w*[Ee]rror \? '—'/);
  });

  it('leaves the detail page with one read, so its caveat has no sibling to mis-wire', () => {
    const src = readFileSync(join(ROOT, DETAIL_FILE), 'utf8');
    // Replies and the customer aside are fields of this response, not their own queries:
    // `invalidate()` matches TICKET_QUERY exactly and there is nothing else to invalidate.
    expect(src.match(/useApiQuery</g)).toHaveLength(1);
    expect(src.match(/invalidateQueries\(\{ queryKey: TICKET_QUERY \}\)/g)).toHaveLength(1);
    expect(src).toMatch(/onSuccess: \(\) => \{ toast\.success\('Reply sent'\); setReplyText\(''\); invalidate\(\); \}/);
    expect(src).toMatch(/onSuccess: \(status\) => \{ toast\.success\(`Status: \$\{status\}`\); invalidate\(\); \}/);
  });

  it('keeps #2829’s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of [LIST_FILE, DETAIL_FILE]) {
      expect(files, `${f} should never have been baselined`).not.toContain(f);
    }
  });

  it('is not something the guard could have caught anyway', async () => {
    // Both files bind `error` and render InlineErrorState, so the screen calls them clean
    // today, called them clean at base, and still calls them clean with the split rewound.
    // These render tests are the only thing standing in its place for this class.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const listSrc = readFileSync(join(ROOT, LIST_FILE), 'utf8');
    const listRewind = listSrc
      .replace(/\n\s*\{stale && \([\s\S]*?\n\s*\)\}\n/, '\n')
      .replace(/\) : failed \? \(/, ') : ticketsError ? (');
    expect(listRewind, 'the list split changed shape, update this check').not.toBe(listSrc);
    expect(inspect(LIST_FILE, listSrc).offends, 'the list page was already visible').toBe(false);
    expect(inspect(LIST_FILE, listRewind).offends, 'the rewound list would now be visible').toBe(false);

    const detailSrc = readFileSync(join(ROOT, DETAIL_FILE), 'utf8');
    const detailRewind = detailSrc.replace('const failed = Boolean(error) && !data;', 'const failed = Boolean(error);');
    expect(detailRewind, 'the detail split changed shape, update this check').not.toBe(detailSrc);
    expect(inspect(DETAIL_FILE, detailSrc).offends, 'the detail page was already visible').toBe(false);
    expect(inspect(DETAIL_FILE, detailRewind).offends, 'the rewound detail would now be visible').toBe(false);
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const f of [LIST_FILE, DETAIL_FILE]) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
