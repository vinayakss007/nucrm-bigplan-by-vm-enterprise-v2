// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — third slice: `invoices` and `contracts`, the rest of the money path.
 *
 * Same measurement as #2877, applied to the two pages that carry the largest numbers in the
 * product. Both already answer #2829's question (a refused read never prints "there are none" —
 * pinned in `panel-page-error-not-empty-money-path-2829.test.tsx`, which this slice extends with
 * `missCopy` for both pages). Neither survives the second question: a read that **answered
 * before** and fails **now**.
 *
 * Both invalidate their own key after a create (`invoices/page.tsx:98`, `contracts/page.tsx:103`)
 * and `lib/query/client.tsx:51-52` runs with `refetchOnWindowFocus: false` and `retry: 2`, so this
 * state is not background revalidation flicker — it arrives after two failed retries, which is
 * after the operator acted.
 *
 * What each page did with it:
 *   - `invoices` routed the error flag straight into the list branch (`:218`), so a refused
 *     refresh replaced the whole ledger with `Failed to load invoices` — and the four header
 *     cards at `:174-177`, guarded on that same flag, printed `—` for Outstanding above rows the
 *     page was still counting. An owner reads `—` on Outstanding the way they read `$0.00`: as
 *     "everyone paid".
 *   - `contracts` did the same (`:206`, cards at `:147-149`) and additionally toasted
 *     `Failed to load contracts` **from the render body** (`:65`, and `:72` for the contacts
 *     read). While an error meant "there is nothing to show" that was merely noisy; a stale state
 *     sustains on screen with a live search box in front of it, so it became one toast per
 *     keystroke. Both now sit in a `useEffect`, which is what the sibling pages already did.
 *
 * Both pages also read `/api/tenant/contacts` beside their list (`:77` each) — the secondary read
 * `guard:panel-error-state` cannot see, feeding `getContactName` (so every row's Contact column
 * falls back to `-`) and the Contact filter (so it offers nobody). An unread contacts list was
 * indistinguishable from invoices with no customer on file.
 *
 * Deliberately **not** changed, so this stays one issue per PR: both pages compute some derived
 * numbers from `filtered` rather than from the read — `invoices:157` (`Outstanding`),
 * `contracts:143` (`Total Value`) and the expiring-soon strip at `contracts:162`. Typing in the
 * search box therefore re-scopes a card whose label promises a tenant-wide figure, and can hide an
 * expiring contract from the amber warning. That is a pre-existing question about what those
 * numbers *mean*, not about whether the read landed; the counters now at least stop printing
 * anything at all when the list is unread. Recorded on #2872 rather than decided here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/tenant',
}));

import toast from 'react-hot-toast';
import InvoicesPage from '@/app/tenant/invoices/page';
import ContractsPage from '@/app/tenant/contracts/page';

const INVOICES = '/api/tenant/invoices';
const CONTRACTS = '/api/tenant/contracts';
const CONTACTS = '/api/tenant/contacts';

const NOW = new Date().toISOString();
const SOON = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
const invoiceRows = {
  data: [
    { id: 'inv1', invoiceNumber: 'INV-2041', title: 'Northwind retainer', status: 'sent', issueDate: NOW, dueDate: NOW, totalAmount: '4200.00', balanceDue: '4200.00', contactId: 'ct1' },
    { id: 'inv2', invoiceNumber: 'INV-2042', title: 'Depot audit', status: 'overdue', issueDate: NOW, dueDate: NOW, totalAmount: '900.00', balanceDue: '900.00', contactId: 'ct1' },
  ],
};
const contractRows = {
  contracts: [
    { id: 'c1', title: 'Master services agreement', contractNumber: 'MSA-12', contractType: 'msa', status: 'active', startDate: NOW, endDate: SOON, totalValue: '60000.00', contactId: 'ct1' },
  ],
};
const contactRows = { contacts: [{ id: 'ct1', firstName: 'Kestrel', lastName: 'Vane', email: 'kestrel@example.test' }] };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state neither page could reach before this slice. */
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
const cardFor = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';

describe('invoices: a refused refresh does not hide the ledger it is totalling (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the rows and calls them the last read, with the reason', () => {
    registry.byUrl = { [INVOICES]: staleRead(invoiceRows), [CONTACTS]: ok(contactRows) };
    wrapped(<InvoicesPage />);
    expect(screen.getByText('INV-2041')).toBeTruthy();
    expect(alerts()).toContain('Could not refresh the invoices');
    expect(alerts()).toContain('Request failed (504)');
    // The outage sentence is gone: the ledger is not unread, the refresh was.
    expect(alerts()).not.toContain('Failed to load invoices');
  });

  it('keeps Outstanding counting the last read instead of printing — above it', () => {
    registry.byUrl = { [INVOICES]: staleRead(invoiceRows), [CONTACTS]: ok(contactRows) };
    wrapped(<InvoicesPage />);
    expect(screen.queryByText('—')).toBeNull();
    expect(cardFor('Outstanding')).toContain('$5100.00');
  });

  it('binds the last-read banner to the invoices query, so Try again re-runs the read that failed', () => {
    const result = staleRead(invoiceRows);
    registry.byUrl = { [INVOICES]: result, [CONTACTS]: ok(contactRows) };
    wrapped(<InvoicesPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a ledger that never answered is still an outage, and the money is unavailable rather than zero', () => {
    registry.byUrl = { [INVOICES]: failed('Request failed (500)'), [CONTACTS]: ok(contactRows) };
    wrapped(<InvoicesPage />);
    expect(screen.queryByText('INV-2041')).toBeNull();
    expect(alerts()).toContain('Failed to load invoices');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText(/Could not refresh/)).toBeNull();
  });

  it('says so when a successful read genuinely returned nothing', () => {
    registry.byUrl = { [INVOICES]: ok({ data: [] }), [CONTACTS]: ok(contactRows) };
    wrapped(<InvoicesPage />);
    expect(screen.getByText('No invoices found')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('separates a filtered miss from an empty tenant, keeping the count the read established', () => {
    registry.byUrl = { [INVOICES]: ok(invoiceRows), [CONTACTS]: ok(contactRows) };
    wrapped(<InvoicesPage />);
    fireEvent.change(screen.getByPlaceholderText(/search invoices/i), { target: { value: 'zzz-no-such-row' } });
    expect(screen.getByText(/No invoice matches this search — the read returned 2/)).toBeTruthy();
    expect(screen.queryByText('No invoices found')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats an unread contacts list as unread, not as invoices with no customer', () => {
    registry.byUrl = { [INVOICES]: ok(invoiceRows), [CONTACTS]: failed('Contacts request failed (502)') };
    wrapped(<InvoicesPage />);
    expect(screen.getByText('INV-2041')).toBeTruthy();
    expect(alerts()).toContain('Failed to load contacts');
    expect(alerts()).toContain('not the same as these invoices having no contact');
  });

  it('says the contacts are the last read when a populated list fails to refresh', () => {
    registry.byUrl = { [INVOICES]: ok(invoiceRows), [CONTACTS]: staleRead(contactRows) };
    wrapped(<InvoicesPage />);
    expect(within(screen.getByRole('table')).getAllByText('Kestrel Vane')).toHaveLength(2);
    expect(alerts()).toContain('working from the last read');
    expect(alerts()).not.toContain('Failed to load contacts');
  });

  it('does not offer an empty contact picker when the picker could not be read', () => {
    registry.byUrl = { [INVOICES]: ok(invoiceRows), [CONTACTS]: failed('Contacts request failed (502)') };
    wrapped(<InvoicesPage />);
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }));
    expect(screen.getByText(/nobody to pick from/)).toBeTruthy();
    expect(screen.queryByText('Select contact...')).toBeNull();
  });

  it('keeps "no contacts saved yet" for the read that genuinely came back empty', () => {
    registry.byUrl = { [INVOICES]: ok(invoiceRows), [CONTACTS]: ok({ contacts: [] }) };
    wrapped(<InvoicesPage />);
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }));
    expect(screen.getByText('Select contact...')).toBeTruthy();
    expect(screen.getByText(/No contacts saved yet/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('contracts: the agreement list survives a refused refresh (#2872)', () => {
  beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); });
  afterEach(cleanup);

  it('keeps the cards and calls them the last read, still warning about the expiring one', () => {
    const result = staleRead(contractRows);
    registry.byUrl = { [CONTRACTS]: result, [CONTACTS]: ok(contactRows) };
    wrapped(<ContractsPage />);
    // Twice: once as the card, once named by the amber strip that warns it is expiring.
    expect(screen.getAllByText('Master services agreement')).toHaveLength(2);
    expect(alerts()).toContain('Could not refresh the contracts');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText('—')).toBeNull();
    expect(cardFor('Total Value')).toContain('$60000.00');
    // The amber strip is derived from the same array as the rows, so the last read still warns.
    expect(screen.getByText(/expiring within 30 days/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });

  it('a list that never answered is still an outage, and the value is unavailable rather than zero', () => {
    registry.byUrl = { [CONTRACTS]: failed('Request failed (500)'), [CONTACTS]: ok(contactRows) };
    wrapped(<ContractsPage />);
    expect(screen.queryByText('Master services agreement')).toBeNull();
    expect(alerts()).toContain('Failed to load contracts');
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText(/expiring within 30 days/)).toBeNull();
  });

  it('says so when a successful read genuinely returned nothing', () => {
    registry.byUrl = { [CONTRACTS]: ok({ contracts: [] }), [CONTACTS]: ok(contactRows) };
    wrapped(<ContractsPage />);
    expect(screen.getByText('No contracts found')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('separates a filtered miss from an empty tenant', () => {
    registry.byUrl = { [CONTRACTS]: ok(contractRows), [CONTACTS]: ok(contactRows) };
    wrapped(<ContractsPage />);
    fireEvent.change(screen.getByPlaceholderText(/search contracts/i), { target: { value: 'zzz-no-such-row' } });
    expect(screen.getByText(/No contract matches this search — the read returned 1/)).toBeTruthy();
    expect(screen.queryByText('No contracts found')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces each failure once, not once per render', () => {
    // Both toasts used to fire from the render body. With a sustained stale state and a search
    // box in front of it, that was one error toast per keystroke.
    registry.byUrl = { [CONTRACTS]: staleRead(contractRows), [CONTACTS]: staleRead(contactRows) };
    const view = wrapped(<ContractsPage />);
    view.rerender(tree(<ContractsPage />));
    view.rerender(tree(<ContractsPage />));
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it('gives the unread contacts list its own failure, instead of a Contact column of dashes', () => {
    registry.byUrl = { [CONTRACTS]: ok(contractRows), [CONTACTS]: failed('Contacts request failed (502)') };
    wrapped(<ContractsPage />);
    expect(alerts()).toContain('Failed to load contacts');
    fireEvent.click(screen.getByRole('button', { name: /new contract/i }));
    expect(screen.getByText(/nobody to pick from/)).toBeTruthy();
    expect(screen.queryByText('Select contact...')).toBeNull();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const FILES = ['app/tenant/invoices/page.tsx', 'app/tenant/contracts/page.tsx'];

  it('splits the two states apart on every page it touched', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} never separates the outage from the stale read`).toMatch(/Boolean\(\w+\) && !\w+/);
      expect(src, `${f} keeps the rows without saying they are the last read`).toMatch(/const stale = Boolean\(/);
      expect(src, `${f} prints a raw error that can be undefined`).toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${f} renders the miss and the absence as the same sentence`).toMatch(/length > 0 \?/);
    }
  });

  it('announces a failed read from an effect, not from the render body', () => {
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      expect(src, `${f} toasts during render`).not.toMatch(/^\s*if \(\w*[Ee]rror\)\s*toast\.error/m);
    }
  });

  it('keeps #2829\'s guard green, with no new baseline entry and nothing left stale', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling rather than a count — pinning the number is what #2858, #2865 and #2866 each
    // had to undo.
    expect(files.length).toBeLessThanOrEqual(20);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    for (const f of FILES) {
      expect(files, `${f} was already visible to #2829's guard and must not be baselined`)
        .not.toContain(f);
    }
  });

  it('is not something the guard could have caught anyway', async () => {
    // The guard asks whether the file binds an error and renders one failure affordance. Both
    // pages did that before this slice — which is why they were never on the baseline, and why
    // #2872 is a separate epic rather than more commits on #2829.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const withoutStale = src
        .replace(/\n\s*\{\s*stale && \([\s\S]*?\)\s*\}\s*\n/g, '\n')
        .replace(/\n\s*\{\s*contactsStale && \([\s\S]*?\)\s*\}\s*\n/g, '\n')
        .replace(/\n\s*\{\s*contactsFailed \? \([\s\S]*?\)\s*:\s*contactsStale \? \([\s\S]*?\)\s*:\s*null\}\s*\n/g, '\n')
        .replace(/const stale = [^\n]*\n/g, '')
        .replace(/const contactsStale = [^\n]*\n/g, '');
      expect(withoutStale, `${f}: the stale blocks changed shape, update this check`)
        .not.toBe(src);
      expect(inspect(f, withoutStale).offends, `${f} would now be visible to the guard`)
        .toBe(false);
    }
  });

  it('is not something the counters could have caught either', async () => {
    // The specific blindness this slice exists for: `error ? '—' : n` is correct-looking code
    // that reports an unread list over a list the page is still showing. Stripping it back to a
    // bare flag leaves the guard, the file-size ratchet and every #2829 assertion green.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const f of FILES) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const bare = src
        .replace(/\bfailed \? '—'/g, "errorFlag ? '—'")
        .replace(/const failed = [^\n]*\n/g, 'const errorFlag = Boolean(error);\n');
      expect(bare, `${f}: the dash guard changed spelling, update this check`).not.toBe(src);
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
