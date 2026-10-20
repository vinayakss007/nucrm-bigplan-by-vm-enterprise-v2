// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — two tenant panels that mishandle the refresh that comes AFTER a good read:
 * `app/tenant/trash/page.tsx`, which reads `/api/tenant/trash` (and one URL per type
 * tab, `?type=contact|deal|task|company`), and `app/tenant/notifications/page.tsx`,
 * which reads `/api/tenant/notifications?limit=20&offset=N` (one key per page).
 *
 * `useApiQuery` is a thin `useQuery` wrapper, so when a revalidation of a query that
 * already succeeded fails, TanStack Query hands the page back the payload it had. Both
 * pages judge that as though it were the read that never answered at all:
 *
 *   trash — `trashError && !items.length` sits over the empty branch, so a bin the last
 *   read reported EMPTY gets "this is a failed request, not an empty one", while a bin
 *   still showing its tombstones gets nothing said about the restore just clicked; and
 *   the tab tallies, which count `items`, print `All (0)` above four per-type zeros when
 *   the read never answered. #2829 took that lie out of the sentence and left it in the
 *   numbers.
 *   notifications — no failure branch at all. The one channel was
 *   `if (error) toast.error('Failed to load notifications')` in the RENDER BODY: a
 *   ~4-second toast, re-fired every render, while the panel went on answering the refusal
 *   with "0 total · 0 unread", the Unread tab with no count, and "All caught up!".
 *
 * Both triggers are the page's own writes. Trash's restore and permanent-delete both call
 * `load()`, which invalidates the `['tenant','trash']` prefix — the tab on screen plus every
 * other tab. Notifications' four mutations (`markRead` from clicking a row, `markAllRead`,
 * `del`, `clearAll`) all call `reload()`, which invalidates `['tenant','notifications']` —
 * every offset's view of the same list read. So "answered, then refused" is the normal state
 * immediately after the operator acted, and neither page could say so.
 *
 * The fix is the house shape: `failed = Boolean(error) && !data` keeps #2829's outage banner
 * (and is the only thing that may dash a derived number), `stale = Boolean(error) &&
 * Boolean(data)` keeps the rows and adds a second banner naming what the last read cannot
 * show. `filter` and `offset` are part of the query keys, so a tab or a page that has never
 * answered is a failure, not a stale read — those cases are here too.
 *
 * Nothing in this file mocks `react-hot-toast`. That is deliberate: every failure assertion
 * below is a `role="alert"` in the panel's own subtree, which is the point — a state that
 * erases itself in four seconds cannot be a page state, and a test that stubs the toast
 * library cannot tell the two apart.
 *
 * RED AT BASE: with the two product files at `ae866c07` and this file as committed,
 * 21 of the 30 cases fail — the thirteen that put a page in the kept-rows / refused-refresh
 * state (six for trash, seven for notifications, including both success → refused reload →
 * success walks, both stale-over-an-empty-list cases and the one proving the failure survives
 * the toast window), the five that page into a type tab or an offset whose read never answered
 * and expect the reason quoted or a derived count dashed, and the three ratchet cases that read
 * the sources for `failed` / `stale`, for the toast this slice takes out of the render body, and
 * for the split's shape. The other 9 pass at base and stay green: #2829's controls — the rows,
 * the genuine zero, the honest filter-tab miss, the outage banner's retry — which replacing
 * `trashError && !items.length` with `failed` must not break.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
  ConfirmDialog: () => null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant/notifications',
}));

import NotificationsPage from '@/app/tenant/notifications/page';
import TrashPage from '@/app/tenant/trash/page';

const TRASH = '/api/tenant/trash';
const TRASH_CONTACTS = '/api/tenant/trash?type=contact';
const TRASH_DEALS = '/api/tenant/trash?type=deal';
const NOTIFS = '/api/tenant/notifications?limit=20&offset=0';
const NOTIFS_PAGE2 = '/api/tenant/notifications?limit=20&offset=20';

const NOW = '2026-03-04T10:00:00.000Z';
const trashRows = {
  data: [
    { id: 't1', name: 'Northwind Trading', resource_type: 'company', email: null, extra: null, deleted_at: '2026-02-20T00:00:00.000Z', days_remaining: 16 },
    { id: 't2', name: 'Priya Raman', resource_type: 'contact', email: 'priya@corp.test', extra: null, deleted_at: '2026-03-01T00:00:00.000Z', days_remaining: 2 },
  ],
};
const emptyTrash = { data: [] };
const notificationRows = {
  data: [
    { id: 'n1', type: 'task_assigned', title: 'Deal review call assigned to you', body: 'Northwind Trading · stage Proposal', link: '/tenant/deals/deal-7', createdAt: NOW },
    { id: 'n2', type: 'mention', title: 'Nadia mentioned you in a note', body: 'Needs the Gulf pricing before Friday.', link: null, createdAt: NOW, readAt: NOW },
    { id: 'n3', type: 'trial_expiring', title: 'Trial ends in 3 days', body: null, link: null, createdAt: NOW },
  ],
  total: 45,
};
const emptyInbox = { data: [], total: 0 };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before, this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
/** A tab's whole label, e.g. `All (—)` or `Unread (2)`. */
const tabLabel = (prefix: string) => {
  const hits = screen.getAllByRole('button').filter((b) => (b.textContent ?? '').trim().startsWith(prefix));
  expect(hits.length, `expected exactly one tab starting "${prefix}"`).toBe(1);
  return hits[0].textContent?.trim() ?? '';
};
const headerCounts = () => screen.getByText(/total ·/).textContent ?? '';

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const openTrash = () => wrapped(<TrashPage />);
const openNotifications = () => wrapped(<NotificationsPage />);
const goTab = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('trash: a refused reload keeps the tombstones and the tallies (#2872)', () => {
  beforeEach(() => {
    registry.byUrl = {
      [TRASH]: staleRead(trashRows),
      [TRASH_CONTACTS]: ok(emptyTrash),
      [TRASH_DEALS]: ok(emptyTrash),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
    vi.clearAllMocks();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps both rows and says the refusal happened after the read', () => {
    openTrash();
    expect(screen.getByText('Northwind Trading')).toBeTruthy();
    expect(screen.getByText('Priya Raman')).toBeTruthy();
    expect(alerts()).toContain('the trash below is the last read');
    expect(alerts()).toContain('Request failed (504)');
    // The outage sentence would be the lie here: the bin is on the screen.
    expect(alerts()).not.toContain('this is a failed request, not an empty one');
    expect(screen.queryByText(/Trash is empty/)).toBeNull();
  });

  it('names what the kept rows cannot show and keeps the tallies counting them', () => {
    openTrash();
    expect(alerts()).toContain('Something you just restored or deleted forever is still listed the way it was');
    expect(tabLabel('All')).toBe('All (2)');
    expect(tabLabel('contacts')).toBe('contacts (1)');
  });

  it('re-runs the trash read from the caveat, not the type tab beside it', () => {
    const trash = registry.byUrl[TRASH];
    const contacts = registry.byUrl[TRASH_CONTACTS];
    openTrash();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(trash.refetch).toHaveBeenCalledTimes(1);
    expect(contacts.refetch).not.toHaveBeenCalled();
  });

  it('walks the restore path: a good read, a refused reload, a good read again', () => {
    // `load()` on restore invalidates the whole `['tenant','trash']` prefix, so this is the
    // transition the page is in right after the operator clicks Restore. Asserting the hop is
    // what proves the rows are kept rather than re-fetched from a fresh mock.
    registry.byUrl = { [TRASH]: ok(trashRows) };
    const view = openTrash();
    expect(screen.getByText('Northwind Trading')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    registry.byUrl = { [TRASH]: staleRead(trashRows) };
    view.rerender(tree(<TrashPage />));
    expect(screen.getByText('Northwind Trading')).toBeTruthy();
    expect(alerts()).toContain('the trash below is the last read');

    registry.byUrl = { [TRASH]: ok(trashRows) };
    view.rerender(tree(<TrashPage />));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still calls an empty bin empty when it is the last read who said so', () => {
    // The mis-branch #2872 exists for: the bin WAS read, and it was empty; only the refresh
    // was refused. #2829's banner claimed the opposite.
    registry.byUrl = { [TRASH]: staleRead(emptyTrash) };
    openTrash();
    expect(screen.getByText(/Trash is empty/)).toBeTruthy();
    expect(tabLabel('All')).toBe('All (0)');
    expect(alerts()).toContain('the trash below is the last read');
    expect(alerts()).not.toContain('this is a failed request, not an empty one');
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [TRASH]: staleRead(trashRows, '') };
    openTrash();
    expect(alerts()).toContain('no response from the server');
    expect(screen.getByText('Northwind Trading')).toBeTruthy();
  });
});

describe('trash: a read that never answered stays an outage (#2829 controls)', () => {
  beforeEach(() => {
    registry.byUrl = {
      [TRASH]: failed('Request failed (500)'),
      [TRASH_CONTACTS]: failed('Request failed (500)'),
      [TRASH_DEALS]: failed('Request failed (500)'),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
    vi.clearAllMocks();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('dashes the tallies, quotes the reason and never claims an empty bin', () => {
    openTrash();
    expect(screen.queryByText(/Trash is empty/)).toBeNull();
    expect(alerts()).toContain('Could not load the trash');
    expect(alerts()).toContain('this is a failed request, not an empty one');
    expect(alerts()).toContain('Request failed (500)');
    expect(tabLabel('All')).toBe('All (—)');
    expect(tabLabel('contacts')).toBe('contacts (—)');
  });

  it('offers to re-run the read that failed, not the tabs it did not ask about', () => {
    const trash = registry.byUrl[TRASH];
    const contacts = registry.byUrl[TRASH_CONTACTS];
    openTrash();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(trash.refetch).toHaveBeenCalledTimes(1);
    expect(contacts.refetch).not.toHaveBeenCalled();
  });

  it('treats a type tab that never answered as a failure, not an empty bin', () => {
    registry.byUrl = {
      [TRASH]: ok(trashRows),
      [TRASH_CONTACTS]: failed('Request failed (503)'),
      [TRASH_DEALS]: ok(trashRows),
    };
    openTrash();
    goTab(/^contacts/);
    expect(alerts()).toContain('this is a failed request, not an empty one');
    expect(alerts()).toContain('Request failed (503)');
    expect(screen.queryByText(/No deleted contacts/)).toBeNull();
    expect(screen.queryByText(/Trash is empty/)).toBeNull();
  });
});

describe('trash: what a good read still answers (#2829 regression pins)', () => {
  beforeEach(() => {
    registry.byUrl = {
      [TRASH]: ok(trashRows),
      [TRASH_CONTACTS]: ok(trashRows),
      [TRASH_DEALS]: ok(trashRows),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
    vi.clearAllMocks();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('renders the rows with their countdowns and no alert', () => {
    openTrash();
    expect(screen.getByText('Northwind Trading')).toBeTruthy();
    expect(screen.getByText('16 days left')).toBeTruthy();
    expect(screen.getByText('2d left')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(tabLabel('All')).toBe('All (2)');
  });

  it('says the bin is empty, with real zeros and no alert, when that is what came back', () => {
    registry.byUrl = { [TRASH]: ok(emptyTrash), [TRASH_CONTACTS]: ok(emptyTrash), [TRASH_DEALS]: ok(emptyTrash) };
    openTrash();
    expect(screen.getByText(/Trash is empty/)).toBeTruthy();
    expect(tabLabel('All')).toBe('All (0)');
    expect(tabLabel('deals')).toBe('deals (0)');
    expect(alerts()).toBe('');
  });

  it('keeps an empty filter tab honest while the read is fine', () => {
    // The tab sentence is a question about the rows in hand, so it stays (#2825's KB rule) —
    // with no caveat attached, because nothing was refused.
    openTrash();
    goTab(/^deals/);
    expect(screen.getByText(/No deleted deals/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('notifications: a refused reload keeps the inbox (#2872)', () => {
  beforeEach(() => {
    registry.byUrl = {
      [NOTIFS]: staleRead(notificationRows),
      [NOTIFS_PAGE2]: ok(notificationRows),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
    vi.clearAllMocks();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps the rows and the header counts and labels them the last read', () => {
    openNotifications();
    expect(screen.getByText('Deal review call assigned to you')).toBeTruthy();
    expect(screen.getByText('Trial ends in 3 days')).toBeTruthy();
    expect(headerCounts()).toBe('3 total · 2 unread');
    expect(tabLabel('Unread')).toBe('Unread (2)');
    expect(alerts()).toContain('the notifications below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(alerts()).not.toContain('Failed to load your notifications');
  });

  it('says which actions the kept list may not reflect', () => {
    openNotifications();
    expect(alerts()).toContain('One you just opened, marked read or deleted is still shown the way it was');
  });

  it('re-runs the page on screen from the caveat, not the page beside it', () => {
    // `reload()` invalidates the prefix, so both offsets are revalidating; the caveat has to
    // retry the read the operator is looking at.
    const first = registry.byUrl[NOTIFS];
    const second = registry.byUrl[NOTIFS_PAGE2];
    openNotifications();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(first.refetch).toHaveBeenCalledTimes(1);
    expect(second.refetch).not.toHaveBeenCalled();
  });

  it('is a rendered state, not a toast: it outlives the toast window with no toast mock here', () => {
    // react-hot-toast auto-dismisses in ~4 s and this file deliberately never stubs it, so the
    // only channel that can be asserted is the panel's own DOM.
    registry.byUrl = { [NOTIFS]: failed('Request failed (500)') };
    const view = openNotifications();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load your notifications: Request failed (500)');
    expect(view.container.contains(alert)).toBe(true);

    view.rerender(tree(<NotificationsPage />));
    expect(screen.getByRole('alert').textContent).toContain('Failed to load your notifications');

    cleanup();
    openNotifications();
    expect(screen.getByRole('alert').textContent).toContain('Failed to load your notifications');
    expect(screen.queryByText(/All caught up/)).toBeNull();
  });

  it('calls an empty inbox caught up when the last read found nothing, and caveats it', () => {
    registry.byUrl = { [NOTIFS]: staleRead(emptyInbox) };
    openNotifications();
    expect(screen.getByText(/All caught up/)).toBeTruthy();
    expect(headerCounts()).toBe('0 total · 0 unread');
    // The caveat is what separates "there are none" from "I could not check".
    expect(alerts()).toContain('the notifications below are the last read');
    expect(alerts()).not.toContain('Failed to load your notifications');
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [NOTIFS]: staleRead(notificationRows, '') };
    openNotifications();
    expect(alerts()).toContain('no response from the server');
    expect(screen.getByText('Trial ends in 3 days')).toBeTruthy();
  });

  it('walks the mark-read path: a good read, a refused reload, a good read again', () => {
    registry.byUrl = { [NOTIFS]: ok(notificationRows) };
    const view = openNotifications();
    expect(screen.getByText('Deal review call assigned to you')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

    registry.byUrl = { [NOTIFS]: staleRead(notificationRows) };
    view.rerender(tree(<NotificationsPage />));
    expect(screen.getByText('Deal review call assigned to you')).toBeTruthy();
    expect(alerts()).toContain('the notifications below are the last read');

    registry.byUrl = { [NOTIFS]: ok(notificationRows) };
    view.rerender(tree(<NotificationsPage />));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('notifications: a list that never answered is not an empty inbox (#2872)', () => {
  beforeEach(() => {
    registry.byUrl = {
      [NOTIFS]: failed('Request failed (500)'),
      [NOTIFS_PAGE2]: failed('Request failed (500)'),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
    vi.clearAllMocks();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('dashes the header, drops "All caught up!" and quotes the reason', () => {
    openNotifications();
    expect(screen.queryByText(/All caught up/)).toBeNull();
    expect(screen.queryByText(/You'll be notified about tasks/)).toBeNull();
    expect(headerCounts()).toBe('— total · — unread');
    expect(tabLabel('Unread')).toBe('Unread (—)');
    expect(alerts()).toContain('Failed to load your notifications: Request failed (500)');
    expect(alerts()).not.toContain('last read');
  });

  it('offers to re-run the refused read from the banner', () => {
    const first = registry.byUrl[NOTIFS];
    openNotifications();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(first.refetch).toHaveBeenCalledTimes(1);
  });

  it('treats a page of the list that never answered as a failure, not a stale read', () => {
    // offset is part of the key, so paging into an unread view has no last read to keep.
    registry.byUrl = { [NOTIFS]: ok(notificationRows), [NOTIFS_PAGE2]: failed('Request failed (502)') };
    openNotifications();
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(alerts()).toContain('Failed to load your notifications: Request failed (502)');
    expect(screen.queryByText(/All caught up/)).toBeNull();
    expect(screen.queryByText('Deal review call assigned to you')).toBeNull();
  });
});

describe('notifications: what a good read still answers (#2872 controls)', () => {
  beforeEach(() => {
    registry.byUrl = {
      [NOTIFS]: ok(notificationRows),
      [NOTIFS_PAGE2]: ok(notificationRows),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as Response));
    vi.clearAllMocks();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('renders the rows, their counts and no caveat at all', () => {
    openNotifications();
    expect(screen.getByText('Nadia mentioned you in a note')).toBeTruthy();
    expect(headerCounts()).toBe('3 total · 2 unread');
    expect(tabLabel('Unread')).toBe('Unread (2)');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says the inbox is caught up, with a real zero and no alert, when that came back', () => {
    registry.byUrl = { [NOTIFS]: ok(emptyInbox), [NOTIFS_PAGE2]: ok(emptyInbox) };
    openNotifications();
    expect(screen.getByText(/All caught up/)).toBeTruthy();
    expect(headerCounts()).toBe('0 total · 0 unread');
    expect(alerts()).toBe('');
  });

  it('keeps an empty Unread tab honest while the read is fine', () => {
    // A client-side filter over rows the page holds: the sentence belongs, the alert does not.
    registry.byUrl = {
      [NOTIFS]: ok({ data: notificationRows.data.map((n) => ({ ...n, readAt: NOW })), total: 45 }),
      [NOTIFS_PAGE2]: ok(notificationRows),
    };
    openNotifications();
    goTab(/^Unread/);
    expect(screen.getByText(/No unread notifications/)).toBeTruthy();
    expect(tabLabel('Unread')).toBe('Unread');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const TRASH_FILE = 'app/tenant/trash/page.tsx';
  const NOTIFS_FILE = 'app/tenant/notifications/page.tsx';
  const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('trash separates the outage from the kept read instead of one flag', () => {
    const s = src(TRASH_FILE);
    expect(s).toMatch(/const failed = Boolean\(trashError\) && !data;/);
    expect(s).toMatch(/const stale = Boolean\(trashError\) && Boolean\(data\);/);
    expect(s).toMatch(/trashError\?\.message \|\| 'no response from the server'/);
    expect(s).toMatch(/\{stale && \(/);
    expect(s, 'the banner still has no reason in it').toMatch(/not an empty one\. \$\{reason\}/);
    expect(s, 'the emptiness branch still keys off the bare flag').not.toMatch(/^\s*trashError && !items\.length \?/m);
    expect(s, 'a kept read is still dashed in the tabs').not.toMatch(/trashError \? '—'/);
    expect(s).toMatch(/\{failed \? '—' : items\.length\}/);
  });

  it('notifications separates the two states and stopped toasting its read failure', () => {
    const s = src(NOTIFS_FILE);
    expect(s).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(s).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(s).toMatch(/error\?\.message \|\| 'no response from the server'/);
    expect(s).toMatch(/\{stale && \(/);
    expect(s).toMatch(/\{loading \? \([\s\S]*?\) : failed \? \(/);
    // The render body no longer owns the failure: nothing routes a load refusal to a toast.
    expect(s, 'the load failure is still a toast').not.toMatch(/toast\.error\([^)]*load/i);
    expect(s, 'the toast is still fired from the render body').not.toMatch(/^\s*if \(error\) toast\./m);
    expect(s, 'a kept read is still dashed in the header').not.toMatch(/error \? '—'/);
  });

  it('reports both pages clean before and after the split is rewound', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [string, RegExp, string][] = [
      [TRASH_FILE, /const failed = Boolean\(trashError\) && !data;\s*\n\s*const stale = Boolean\(trashError\) && Boolean\(data\);/, 'const failed = Boolean(trashError);'],
      [NOTIFS_FILE, /const failed = Boolean\(error\) && !data;\s*\n\s*const stale = Boolean\(error\) && Boolean\(data\);/, 'const failed = Boolean(error);'],
    ];
    for (const [file, pattern, replacement] of rewinds) {
      const s = src(file);
      expect(s, `the shape this slice depends on moved: ${file}`).toMatch(pattern);
      expect(inspect(file, s).offends, `${file} was already on the guard's list`).toBe(false);
      expect(
        inspect(file, s.replace(pattern, replacement)).offends,
        `the guard would catch this rewind after all: ${file}`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    expect(files, 'trash went back on the list it was never on').not.toContain(TRASH_FILE);
    expect(files, 'notifications went back on the list it was never on').not.toContain(NOTIFS_FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('keeps both pages inside the size ceiling', () => {
    for (const f of [TRASH_FILE, NOTIFS_FILE]) {
      expect(src(f).split('\n').length, `${f} past the 500-line ceiling`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
