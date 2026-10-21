// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/superadmin/tenants/[id]` and `app/tenant/settings/picklists`.
 *
 * The tenant console read is `useApiQuery(['superadmin','tenant',id],
 * '/api/superadmin/tenants/<id>', {enabled, retry:false})`; the picklist admin is
 * `useApiQuery(['tenant','admin','picklists'], '/api/tenant/admin/picklists')` plus
 * the `['tenant','me']` gate read off `/api/tenant/me`. Neither key carries a filter,
 * a tab or an offset, and no other module invalidates either key, so a kept payload is
 * always a previous answer to the *same* question — never an answer for a different view.
 *
 * The refused refresh is the routine state on both.
 *
 *  — tenant detail: the single PATCH (`saveMutation`) ends in
 *    `invalidateQueries({ queryKey })` on this exact key, so every plan change, status
 *    change, billing-email change and saved note is followed by a revalidation of the
 *    record being edited. TanStack Query keeps `data` when that revalidation fails, and
 *    the page branched only on `if (!tenant)` after an `useEffect(() => { if (error)
 *    toast.error(...) }, [error])`. Two false answers followed: a refresh refused right
 *    after a save kept the old fields silently (the toast was the only channel and it
 *    fades in four seconds), and a read that never answered at all printed
 *    "Tenant not found" — a claim about whether the tenant exists, made by a request
 *    that never got through. `No notes` is the same accident one card down: it is the
 *    last read's emptiness, not the server's.
 *    Because the id is in the key, a genuine 404 *is* a server answer ("no such tenant")
 *    and stays "Tenant not found"; a 500/504 with nothing in hand is an outage, and an
 *    outage may not name the tenant's existence.
 *
 *  — picklists: `if (!data)` printed a bare `Failed to load picklists.` with no retry
 *    and no `role="alert"`, and the read's `error` was never bound at all, so the whole
 *    failure surface was one sentence that could not be re-run. The census flagged
 *    `No options. Click "Add option" to start.` as standing whether the read failed or
 *    not; that premise is only half right — an unread list short-circuits above it — but
 *    the dangerous half is exactly there: after a refused refresh the sentence still
 *    reads as a fact about the tenant's lists. `activeCat` is a client-side tab over one
 *    payload that returns all six categories, so no tab is ever "unread": switching tabs
 *    fetches nothing, and the tab counts are all derived from that one read.
 *
 * What a refused refresh costs here is worse than a wrong count, because of the write
 * path: `save()` PATCHes every category it is holding, and the route merges with
 * `settings->'picklists' || <payload>` — a per-category REPLACE. The page never sends
 * `expectedUpdatedAt`, so the route's `concurrencyGuard` cannot refuse the collision.
 * Saving over a read the refresh could not re-check overwrites each list with what the
 * server held at the last read: an option another admin added since then is deleted by
 * the save, and one they removed comes back. The caveat says that in the operator's
 * terms, and everything on the kept list stays editable — the save is the operator's
 * call to make, not ours to hide.
 *
 * Per page: `failed = Boolean(error) && !data` renders the outage card quoting the
 * reason (the false absence sentence becomes unreachable, and so do the row controls);
 * `stale = Boolean(error) && Boolean(data)` keeps the rows and their actions and adds a
 * "last read" caveat. Neither page derives a figure off the bare flag today — the
 * detail page's `member_count ?? '—'` dashes a field the payload left null, and the
 * picklist tab counts only render when the read answered — so this slice pins the
 * absence of that shape rather than inventing a dash.
 *
 * RED AT BASE (both product files as they stand on `origin/main`, this file as
 * committed): 19 failed | 17 passed (36). What already passes is the behaviour the
 * fix must preserve rather than win: the genuine-empty answers ("Tenant not found",
 * `No options. Click "Add option" to start.`), the Admins-only gate, the 404 that is
 * a server answer about this id, the kept rows still being editable and still
 * counted (the picklists page never bound the read's error, so a kept read simply
 * rendered), and the ratchet pins that only measure absences — no dash keyed off
 * `error`, the mutation toasts, the guard's blindness, the line ceiling — plus the
 * hygiene scan that finds no other suite mounting either page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'tn-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/superadmin/tenants',
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import TenantDetailPage from '@/app/superadmin/tenants/[id]/page';
import PicklistsPage from '@/app/tenant/settings/picklists/page';

// The detail page builds its URL off `useParams().id`, mocked above to 'tn-1'.
const TENANT = '/api/superadmin/tenants/tn-1';
const PICKLISTS = '/api/tenant/admin/picklists';
const ME = '/api/tenant/me';

const tenant = {
  id: 'tn-1', name: 'Acme Freight', slug: 'acme-freight', plan_id: 'pro', plan_name: 'Pro',
  status: 'active', billing_type: 'manual', billing_email: 'accounts@acme.test',
  owner_name: 'Ada Operator', owner_email: 'ada@acme.test',
  created_at: '2026-01-05T00:00:00Z', trial_ends_at: null, manual_paid_until: null,
  admin_notes: 'Moved off the legacy plan by the reseller.', member_count: 7,
};

const picklists = {
  picklists: {
    lead_sources: [{ value: 'website', label: 'Website' }, { value: 'referral', label: 'Referral' }],
    loss_reasons: [{ value: 'price', label: 'Price too high' }],
    win_reasons: [{ value: 'product_fit', label: 'Product fit' }],
    activity_types: [{ value: 'call', label: 'Call' }],
    deal_types: [{ value: 'new_business', label: 'New Business' }],
    industries: [{ value: 'logistics', label: 'Logistics' }],
  },
};
/** What the route returns when an admin saved an emptied list: the array is the answer. */
const noIndustries = {
  ...picklists,
  picklists: { ...picklists.picklists, industries: [] },
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before, this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** `apiFetcher` stamps the status it got; a 404 is the server answering about this id. */
const refused404 = (): QueryResult => {
  const error = new Error('Request failed (404)') as Error & { status?: number };
  error.status = 404;
  return { data: undefined, error, isLoading: false, refetch: vi.fn() };
};

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

/** The tab's own label plus the count it derives from the one read. */
const tabText = (label: string) =>
  (screen.getAllByRole('button').find((b) => (b.textContent ?? '').startsWith(label))?.textContent ?? '').replace(/\s+/g, ' ').trim();

const openTab = (label: string) => {
  const tab = screen.getAllByRole('button').find((b) => (b.textContent ?? '').startsWith(label));
  if (!tab) throw new Error(`no ${label} tab`);
  fireEvent.click(tab);
};

describe('tenant detail: a refused refresh keeps the tenant it loaded (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the fields the last read returned and says they are the last read', () => {
    const result = staleRead({ data: tenant });
    registry.byUrl = { [TENANT]: result };
    wrapped(<TenantDetailPage />);
    expect(screen.getByText('Acme Freight')).toBeTruthy();
    expect(screen.getByText('Moved off the legacy plan by the reseller.')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // The outage sentence would be a lie here, and so would the missing-tenant one.
    expect(screen.queryByText(/Failed to load tenant/)).toBeNull();
    expect(screen.queryByText('Tenant not found')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('the tenant it kept is still editable, because a save is what refused', () => {
    registry.byUrl = { [TENANT]: staleRead({ data: tenant }) };
    wrapped(<TenantDetailPage />);
    // saveMutation invalidates this exact key, so kept-rows-plus-error is the state
    // right after every plan / status / note save.
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.getByRole('button', { name: /save changes/i })).toBeTruthy();
    expect((screen.getByPlaceholderText('billing@example.com') as HTMLInputElement).value).toBe('accounts@acme.test');
  });

  it('counts the members the last read reported instead of dashing them', () => {
    registry.byUrl = { [TENANT]: staleRead({ data: tenant }) };
    wrapped(<TenantDetailPage />);
    expect(screen.getByText(/7 members/)).toBeTruthy();
  });

  it('says notes are missing only in the read it actually has', () => {
    registry.byUrl = { [TENANT]: staleRead({ data: { ...tenant, admin_notes: '' } }) };
    wrapped(<TenantDetailPage />);
    // The census flagged `No notes` here: a save that was refused on revalidation used
    // to leave the card claiming the tenant has no notes at all.
    expect(screen.queryByText('No notes')).toBeNull();
    expect(screen.getByText(/No notes in the last read/)).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('walks the save: a good read, then a refused revalidation, then a good read again', async () => {
    registry.byUrl = { [TENANT]: ok({ data: tenant }) };
    const view = wrapped(<TenantDetailPage />);
    expect(screen.getByText('Acme Freight')).toBeTruthy();
    await waitFor(() => expect(alerts()).toBe(''), { interval: 10 });

    registry.byUrl = { [TENANT]: staleRead({ data: tenant }) };
    view.rerender(tree(<TenantDetailPage />));
    expect(screen.getByText('Acme Freight')).toBeTruthy();
    expect(screen.getByText('Moved off the legacy plan by the reseller.')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(screen.queryByText('Tenant not found')).toBeNull();

    registry.byUrl = { [TENANT]: ok({ data: tenant }) };
    view.rerender(tree(<TenantDetailPage />));
    await waitFor(() => expect(alerts()).toBe(''), { interval: 10 });
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [TENANT]: staleRead({ data: tenant }, '') };
    wrapped(<TenantDetailPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Acme Freight')).toBeTruthy();
  });

  it('an unread tenant is an outage, and never "Tenant not found" or "No notes"', () => {
    registry.byUrl = { [TENANT]: failed('Request failed (500)') };
    wrapped(<TenantDetailPage />);
    expect(screen.queryByText('Tenant not found')).toBeNull();
    expect(screen.queryByText('No notes')).toBeNull();
    expect(screen.queryByText(/7 members/)).toBeNull();
    expect(alerts()).toMatch(/Failed to load tenant: Request failed \(500\)/);
    expect(alerts()).not.toMatch(/last read/);
    // Nothing is on the screen to act on, so the row controls go with the fields.
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[TENANT].refetch).toHaveBeenCalledTimes(1);
  });

  it('a 404 is the server answering that this tenant does not exist', () => {
    // Distinct from the refusal above: the read reached the server, and the server
    // named this id. Reporting it as an outage would be its own false statement.
    registry.byUrl = { [TENANT]: refused404() };
    wrapped(<TenantDetailPage />);
    expect(screen.getByText('Tenant not found')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.queryByText(/Failed to load tenant/)).toBeNull();
  });

  it('a genuine empty answer says not found with no alert', () => {
    registry.byUrl = { [TENANT]: ok({ data: null }) };
    wrapped(<TenantDetailPage />);
    expect(screen.getByText('Tenant not found')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('stale over an empty answer says not found AND carries the caveat', () => {
    registry.byUrl = { [TENANT]: staleRead({ data: null }) };
    wrapped(<TenantDetailPage />);
    expect(screen.getByText('Tenant not found')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [TENANT]: ok({ data: { ...tenant, admin_notes: '' } }) };
    wrapped(<TenantDetailPage />);
    expect(screen.getByText('Acme Freight')).toBeTruthy();
    expect(screen.getByText('No notes')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('picklists: a refused refresh keeps the lists the operator is editing (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [ME]: ok({ is_admin: true }) }; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the options the last read returned and says they are the last read', () => {
    const result = staleRead(picklists);
    registry.byUrl = { [PICKLISTS]: result, [ME]: ok({ is_admin: true }) };
    wrapped(<PicklistsPage />);
    expect(screen.getAllByPlaceholderText('Display label')).toHaveLength(2);
    expect(screen.getByDisplayValue('Website')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(screen.queryByText(/Failed to load picklists/)).toBeNull();
  });

  it('the caveat re-runs the picklists read and not the gate read', () => {
    const lists = staleRead(picklists);
    const me = ok({ is_admin: true });
    registry.byUrl = { [PICKLISTS]: lists, [ME]: me };
    wrapped(<PicklistsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(lists.refetch).toHaveBeenCalledTimes(1);
    expect(me.refetch).not.toHaveBeenCalled();
  });

  it('it says what saving over a refused refresh costs', () => {
    registry.byUrl = { [PICKLISTS]: staleRead(picklists), [ME]: ok({ is_admin: true }) };
    wrapped(<PicklistsPage />);
    // PATCH merges per category, so a save replaces each list with the last read.
    expect(alerts()).toMatch(/saving/i);
    expect(alerts()).toMatch(/option/i);
  });

  it('kept options stay editable, and the save bar still arms', () => {
    registry.byUrl = { [PICKLISTS]: staleRead(picklists), [ME]: ok({ is_admin: true }) };
    wrapped(<PicklistsPage />);
    expect(screen.getAllByPlaceholderText('Display label')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /add option/i }));
    const labels = screen.getAllByPlaceholderText('Display label');
    expect(labels).toHaveLength(3);
    fireEvent.change(labels[2] as Element, { target: { value: 'Trade show' } });
    const save = screen.getByRole('button', { name: /save picklists/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it('an option can still be removed from a kept list', () => {
    registry.byUrl = { [PICKLISTS]: staleRead(picklists), [ME]: ok({ is_admin: true }) };
    wrapped(<PicklistsPage />);
    fireEvent.click(screen.getAllByTitle('Remove')[0] as Element);
    expect(screen.queryByDisplayValue('Website')).toBeNull();
    expect(screen.getByDisplayValue('Referral')).toBeTruthy();
  });

  it('counts what the kept read holds, including a real zero', () => {
    registry.byUrl = { [PICKLISTS]: staleRead(noIndustries), [ME]: ok({ is_admin: true }) };
    wrapped(<PicklistsPage />);
    expect(tabText('Lead Sources')).toMatch(/Lead Sources\s*2$/);
    expect(tabText('Industries')).toMatch(/Industries\s*0$/);
  });

  it('re-runs the picklists read from the outage card, not the gate read', () => {
    const lists = failed('Request failed (500)');
    const me = ok({ is_admin: true });
    registry.byUrl = { [PICKLISTS]: lists, [ME]: me };
    wrapped(<PicklistsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(lists.refetch).toHaveBeenCalledTimes(1);
    expect(me.refetch).not.toHaveBeenCalled();
  });

  it('an unread list is an outage, and never "No options" or a tab count', () => {
    registry.byUrl = { [PICKLISTS]: failed('Request failed (500)'), [ME]: ok({ is_admin: true }) };
    wrapped(<PicklistsPage />);
    expect(alerts()).toMatch(/Failed to load picklists: Request failed \(500\)/);
    expect(alerts()).not.toMatch(/last read/);
    expect(screen.queryByText(/No options\. Click/)).toBeNull();
    expect(screen.queryByText('Lead Sources')).toBeNull();
    expect(screen.queryByRole('button', { name: /add option/i })).toBeNull();
  });

  it('names the server when the read never answered and said nothing', () => {
    registry.byUrl = { [PICKLISTS]: failed(''), [ME]: ok({ is_admin: true }) };
    wrapped(<PicklistsPage />);
    expect(alerts()).toMatch(/Failed to load picklists: no response from the server/);
  });

  it('walks the reload: a good read, then a refused refetch, then a good read again', async () => {
    registry.byUrl = { [PICKLISTS]: ok(picklists), [ME]: ok({ is_admin: true }) };
    const view = wrapped(<PicklistsPage />);
    expect(screen.getByDisplayValue('Website')).toBeTruthy();
    await waitFor(() => expect(alerts()).toBe(''), { interval: 10 });

    registry.byUrl = { [PICKLISTS]: staleRead(picklists), [ME]: ok({ is_admin: true }) };
    view.rerender(tree(<PicklistsPage />));
    expect(screen.getByDisplayValue('Website')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);

    registry.byUrl = { [PICKLISTS]: ok(picklists), [ME]: ok({ is_admin: true }) };
    view.rerender(tree(<PicklistsPage />));
    await waitFor(() => expect(alerts()).toBe(''), { interval: 10 });
  });

  it('an empty list the server answered says so, with no alert', () => {
    registry.byUrl = { [PICKLISTS]: ok(noIndustries), [ME]: ok({ is_admin: true }) };
    wrapped(<PicklistsPage />);
    openTab('Industries');
    expect(screen.getByText('No options. Click "Add option" to start.')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('an empty list the refresh could not re-check says none in the last read', () => {
    registry.byUrl = { [PICKLISTS]: staleRead(noIndustries), [ME]: ok({ is_admin: true }) };
    wrapped(<PicklistsPage />);
    openTab('Industries');
    expect(screen.queryByText('No options. Click "Add option" to start.')).toBeNull();
    expect(screen.getByText(/No options in the last read/)).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('says nothing about freshness when the read answers', () => {
    registry.byUrl = { [PICKLISTS]: ok(picklists), [ME]: ok({ is_admin: true }) };
    wrapped(<PicklistsPage />);
    expect(screen.getByDisplayValue('Website')).toBeTruthy();
    expect(screen.getByDisplayValue('Referral')).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('leaves the admin gate a plain refusal, not a load failure', () => {
    registry.byUrl = { [PICKLISTS]: ok(picklists), [ME]: ok({ is_admin: false }) };
    wrapped(<PicklistsPage />);
    expect(screen.getByText('Admins only')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add option/i })).toBeNull();
    expect(alerts()).toBe('');
  });

  it('does not report the gate read as an outage for the lists', () => {
    // `isAdmin` defaults open and the lists come from the other read, so a failed
    // /api/tenant/me changes nothing the panel may claim about the options — the editor
    // it renders is re-checked by the PATCH's own 403.
    registry.byUrl = { [PICKLISTS]: ok(picklists), [ME]: failed('Request failed (500)') };
    wrapped(<PicklistsPage />);
    expect(screen.getByDisplayValue('Website')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.queryByText('Admins only')).toBeNull();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const DETAIL = 'app/superadmin/tenants/[id]/page.tsx';
  const PICKLIST = 'app/tenant/settings/picklists/page.tsx';

  it('splits the two states apart on both pages', () => {
    const detail = readFileSync(join(ROOT, DETAIL), 'utf8');
    expect(detail).toMatch(/const failed = Boolean\(error\) && !data;/);
    expect(detail).toMatch(/const stale = Boolean\(error\) && Boolean\(data\);/);
    expect(detail).toMatch(/error\?\.message \|\| 'no response from the server'/);
    expect(detail, 'the outage card was reached without checking what the server said').toMatch(/\bif \(failed && !notFound\) \{/);
    expect(detail).toMatch(/const notFound = failed && error\?\.status === 404;/);

    const pick = readFileSync(join(ROOT, PICKLIST), 'utf8');
    expect(pick).toMatch(/const failed = Boolean\(picklistsError\) && !picklistsData;/);
    expect(pick).toMatch(/const stale = Boolean\(picklistsError\) && Boolean\(picklistsData\);/);
    expect(pick).toMatch(/picklistsError\?\.message \|\| 'no response from the server'/);
    expect(pick).toMatch(/\bif \(failed\) \{/);
    expect(pick).toMatch(/\{stale && \(/);
  });

  it('retires the render-body / effect toast that carried the read failure', () => {
    for (const f of [DETAIL, PICKLIST]) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} still fires the load-failure toast from an effect`).not.toMatch(/^\s*if \(error\) toast\.error/m);
      expect(src, `${f} still routes the read to an effect toast`).not.toMatch(/useEffect\(\(\) => \{\s*if \(error\) toast\.error/);
      expect(src, `${f} never bound the failure affordance`).toMatch(/InlineErrorState/);
    }
  });

  it('keeps the mutation toasts the actions still need', () => {
    // #2872 is about the read; a write still deserves transient feedback.
    expect(readFileSync(join(ROOT, DETAIL), 'utf8')).toMatch(/onError: \(err: Error\) => toast\.error/);
    expect(readFileSync(join(ROOT, PICKLIST), 'utf8')).toMatch(/onError: \(e: Error\) => toast\.error/);
  });

  it('qualifies both absence sentences instead of letting a kept read claim there are none', () => {
    expect(readFileSync(join(ROOT, DETAIL), 'utf8')).toMatch(/No notes in the last read/);
    expect(readFileSync(join(ROOT, PICKLIST), 'utf8')).toMatch(/No options in the last read/);
  });

  it('leaves no derived number keyed off the bare error', () => {
    for (const f of [DETAIL, PICKLIST]) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} dashes something on the bare error`).not.toMatch(/\w*[Ee]rror \? '—'/);
      expect(src, `${f} hides kept rows behind an outage branch on the bare flag`).not.toMatch(/\)\s*:\s*\w*[Ee]rror \? \(/);
    }
    // The detail page's dash is a field the payload left null, not a read that failed.
    expect(readFileSync(join(ROOT, DETAIL), 'utf8')).toMatch(/tenant\.member_count \?\? '—'/);
  });

  it('keeps #2829\'s guard green and adds nothing to its baseline', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, not a count — the list is empty and every offender is now novel.
    expect(files.length).toBeLessThanOrEqual(3);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of [DETAIL, PICKLIST]) {
      expect(files, `${f} should never have been baselined`).not.toContain(f);
    }
  });

  it('is not something the guard could have caught anyway', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [string, RegExp, string][] = [
      [DETAIL, /const failed = Boolean\(error\) && !data;\n\s*const stale = Boolean\(error\) && Boolean\(data\);/,
        'const failed = Boolean(error);'],
      [PICKLIST, /const failed = Boolean\(picklistsError\) && !picklistsData;\n\s*const stale = Boolean\(picklistsError\) && Boolean\(picklistsData\);/,
        'const failed = Boolean(picklistsError);'],
    ];
    for (const [f, pattern, replacement] of rewinds) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(pattern.test(src), `${f}: the split changed shape, update this check`).toBe(true);
      expect(inspect(f, src).offends, `${f} was already on the guard's list`).toBe(false);
      expect(inspect(f, src.replace(pattern, replacement)).offends, `${f} would now be visible to the guard`).toBe(false);
    }
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const f of [DETAIL, PICKLIST]) {
      const lines = readFileSync(join(ROOT, f), 'utf8').split('\n').length - 1;
      expect(lines, `${f} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});

describe('overlap hygiene with #2829 (#2872)', () => {
  it('the read state lives in the panel, never in a fading toast', async () => {
    registry.byUrl = { [TENANT]: failed('Request failed (500)') };
    wrapped(<TenantDetailPage />);
    await waitFor(() => expect(alerts()).toMatch(/Failed to load tenant/), { interval: 10 });
    expect(screen.queryByText('Tenant not found')).toBeNull();
  });

  it('no other suite mounts these two pages, so nothing else speaks of a last read', () => {
    const own = 'panel-page-error-not-empty-tenantdetail-picklists-stale-2872.test.tsx';
    const dir = join(process.cwd(), 'tests/unit');
    const others = readdirSync(dir)
      .filter((f) => f.endsWith('.test.tsx') && f !== own)
      .filter((f) => {
        const src = readFileSync(join(dir, f), 'utf8');
        return /tenants\/\[id\]\/page|settings\/picklists\/page/.test(src);
      });
    for (const f of others) {
      expect(readFileSync(join(dir, f), 'utf8'), `${f} started talking about a kept read`).not.toMatch(/last read/i);
    }
    expect(readFileSync(join(dir, own), 'utf8')).toMatch(/last read/);
  });
});
