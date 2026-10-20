// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the two customer-facing reads of #2825, plus the tenant-settings copy of the
 * same invoice list.
 *
 * #2825 gave `portal/invoices` and `portal/kb` an error channel and #2829 gave
 * `settings/billing/invoices` an `InlineErrorState`, all three by routing the flag into
 * the branch that prints the absence sentence:
 *
 *     invoices.length === 0 ? (error ? <outage/> : 'No invoices yet') : <table/>
 *
 * That is correct for a read that never answered, and wrong for the state these pages sit
 * in routinely. TanStack Query keeps `data` when a revalidation of an already-succeeded
 * read fails, so the flag plus rows means one of two opposite things, and in all three the
 * emptiness of the list picked which one the reader was told:
 *
 *   - rows kept + refresh refused → the table renders and says NOTHING about the failure;
 *   - a list the last read said was empty + refresh refused → the outage card fires over
 *     an answer that did arrive, reporting an empty history as an outage.
 *
 * On a customer's invoice list the first is not cosmetic: `GET /api/public/invoices`
 * answers 401 the moment the httpOnly portal session expires and 429 once its 30-per-minute
 * budget is spent, neither of which the customer can see, so they keep looking at the list
 * they loaded an hour ago — including an invoice the server has since marked paid — with no
 * hint that the page could not check. Neither portal page writes anything, so the refused
 * revalidation is the plain navigation case: leave the portal, come back through Invoices
 * or Knowledge Base outside `staleTime: 30_000` and inside `gcTime`, and the page mounts on
 * its cached rows and revalidates behind them. The tenant-settings list has the same shape,
 * reached by its Back link, and `requireAuth` answers 401 when the admin session lapses.
 *
 * Per page: `failed = Boolean(error) && !data` keeps the card #2825/#2829 added and
 * continues to make the absence sentence unreachable; `stale = Boolean(error) && data`
 * keeps every row, every amount and every row control, and says they are the last read.
 * None of the three prints a total or a count, so there is no derived figure to re-key —
 * what is at stake instead is that a stale list keeps stating the money it holds, and a
 * list that never answered states no money at all.
 *
 * RED AT BASE, measured on `origin/main` at `22f42426` with the three product files at
 * their committed state and this file as written: 25 failed | 11 passed (36). The 11 that
 * pass are the controls #2825 and #2829 already pinned — rows on a read that answered, a
 * genuine empty read, the tenant card #2829 printed with its reason — plus the guard, size
 * and overlap ratchets. They stay green under the fix, which is the point: routing `failed`
 * in place of the flag must not disturb the contract the two earlier issues wrote. With the
 * three pages fixed: 36 passed.
 *
 * Fixture addresses are documentation-only (`corp.test`, `billing.example.test`); the
 * customer, the invoice numbers and the article titles are invented.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

/** url → the result the page should see for that read. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

// A stable router: both portal pages key their session effect on `router`, so a fresh
// object per call re-runs the effect on every render and the loop never terminates.
const mockRouter = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import PortalInvoicesPage from '@/app/portal/(protected)/invoices/page';
import PortalKbPage from '@/app/portal/(protected)/kb/page';
import TenantInvoicesPage from '@/app/tenant/settings/billing/invoices/page';

const KB = '/api/public/kb/articles?status=published';
const PORTAL_INVOICES = '/api/public/invoices';
const TENANT_INVOICES = '/api/tenant/billing/invoices';

/** One row exactly as `app/api/public/invoices/route.ts` projects it (#2747). */
const portalInvoice = {
  id: '7a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c2f',
  invoiceNumber: 'INV-2026-0042',
  status: 'pending',
  totalAmount: '1250.00',
  amountPaid: '0.00',
  balanceDue: '1250.00',
  currency: 'USD',
  issueDate: '2026-01-05',
  dueDate: '2026-02-04',
  paidAt: null,
};
const article = {
  id: '6a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c30',
  title: 'How password resets work',
  slug: 'password-resets',
  excerpt: 'What to do when the email does not arrive.',
  views: 3,
  createdAt: '2026-01-05T00:00:00.000Z',
};
/** One row exactly as `app/api/tenant/billing/invoices/route.ts` formats it (#2551). */
const billingRow = {
  id: 'be-1',
  date: '2026-10-01T00:00:00.000Z',
  type: 'subscription_monthly',
  amount: '49.00',
  currency: 'USD',
  status: 'paid',
  invoiceUrl: 'https://billing.example.test/invoices/in-1',
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** The state this slice is about: the rows are on screen, the refresh was refused. */
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

/**
 * Mounts a page and waits out the portal session effect, which is what releases the
 * skeleton. `byAlert` looks in the failure banners only, the rest of the string anywhere
 * on the screen — a stale assertion has to be satisfiable by the panel's own subtree.
 */
async function mounted(node: ReactNode) {
  cleanup();
  // The portal pages gate their read on this; the tenant page ignores it.
  localStorage.setItem('portal_session', JSON.stringify({
    email: 'customer@corp.test',
    name: 'Casey Customer',
    permissions: { quotes: true, invoices: true, cases: true },
  }));
  const view = render(tree(node));
  await waitFor(() => expect(document.querySelector('.animate-pulse'), 'skeleton never cleared').toBeNull());
  return view;
}

async function expectCopy(copy: string, where: 'alert' | 'any' = 'any') {
  await waitFor(() => {
    const haystack = where === 'alert' ? alerts() : (document.body.textContent ?? '');
    expect(haystack.includes(copy), `"${copy}" not on screen; alerts were: ${alerts()}`).toBe(true);
  }, { interval: 10 });
}

beforeEach(() => {
  registry.byUrl = {};
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('portal invoices: a refused refresh does not silence the money on screen (#2872)', () => {
  it('keeps the rows, the amount and the download control, and calls them the last read', async () => {
    const read = staleRead({ data: [portalInvoice] });
    registry.byUrl = { [PORTAL_INVOICES]: read };
    await mounted(<PortalInvoicesPage />);
    await expectCopy('INV-2026-0042');
    // The point of a billing list: a refused refresh may not hide the money it holds.
    expect(screen.getByText('$1,250')).toBeTruthy();
    expect(alerts()).toContain('the invoices below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    // …and the kept row is still the row the customer can act on.
    expect(document.querySelector('tbody tr button')).toBeTruthy();
    // Neither of the two sentences this slice replaces may speak here.
    expect(screen.queryByText(/We could not load your invoices/)).toBeNull();
    expect(screen.queryByText('No invoices yet')).toBeNull();
  });

  it('the caveat retries the invoice read', async () => {
    const read = staleRead({ data: [portalInvoice] });
    registry.byUrl = { [PORTAL_INVOICES]: read };
    await mounted(<PortalInvoicesPage />);
    await expectCopy('the invoices below are the last read', 'alert');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('a read that never answered is the outage, with the reason, and "No invoices yet" is unreachable', async () => {
    registry.byUrl = { [PORTAL_INVOICES]: failed('Request failed (500)') };
    await mounted(<PortalInvoicesPage />);
    await expectCopy('We could not load your invoices', 'alert');
    expect(alerts()).toContain('Request failed (500)');
    expect(alerts()).toContain('not an empty list');
    expect(screen.queryByText('No invoices yet')).toBeNull();
    // Nothing answered, so nothing is priced: no row and no amount on the screen.
    expect(document.querySelector('tbody tr')).toBeNull();
    expect(screen.queryByText('$1,250')).toBeNull();
  });

  it('a successful empty read still says none, with no alert', async () => {
    registry.byUrl = { [PORTAL_INVOICES]: ok({ data: [] }) };
    await mounted(<PortalInvoicesPage />);
    await expectCopy('No invoices yet');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal over an answer that was empty says none AND adds the caveat', async () => {
    // #2829's branch read these two as one state and sent both to the outage card. The
    // list really did answer "none", so that is what stays said — with the refusal on top.
    registry.byUrl = { [PORTAL_INVOICES]: staleRead({ data: [] }) };
    await mounted(<PortalInvoicesPage />);
    await expectCopy('No invoices yet');
    expect(alerts()).toContain('the invoices below are the last read');
    expect(screen.queryByText(/We could not load your invoices/)).toBeNull();
  });

  it('a read that answers shows the rows and says nothing about freshness', async () => {
    registry.byUrl = { [PORTAL_INVOICES]: ok({ data: [portalInvoice] }) };
    await mounted(<PortalInvoicesPage />);
    await expectCopy('INV-2026-0042');
    expect(screen.getByText('$1,250')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal that carries no message still names the reason', async () => {
    registry.byUrl = { [PORTAL_INVOICES]: failed('') };
    await mounted(<PortalInvoicesPage />);
    await expectCopy('no response from the server', 'alert');

    registry.byUrl = { [PORTAL_INVOICES]: staleRead({ data: [portalInvoice] }, '') };
    await mounted(<PortalInvoicesPage />);
    await expectCopy('no response from the server', 'alert');
  });
});

describe('portal knowledge base: kept articles are not an outage, and a search miss still is not', () => {
  it('keeps the articles and their links, and calls them the last read', async () => {
    const read = staleRead({ data: [article] });
    registry.byUrl = { [KB]: read };
    await mounted(<PortalKbPage />);
    await expectCopy('How password resets work');
    expect(screen.getByText('3 views')).toBeTruthy();
    // A kept row is still a row the customer can open.
    expect(screen.getByRole('link', { name: /How password resets work/i }).getAttribute('href'))
      .toBe('/portal/kb/6a7b6c5d-4e3f-4a1b-9c8d-7e6f5a4b3c30');
    expect(alerts()).toContain('the articles below are the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText(/We could not load the knowledge base/)).toBeNull();
    expect(screen.queryByText('No articles found')).toBeNull();
  });

  it('a search that matches nothing over a stale read is still an honest miss', async () => {
    // #2825's KB rule: "No articles found" also serves a client-side search miss, which is
    // true of the rows on screen. The caveat rides along; the outage card does not take over.
    registry.byUrl = { [KB]: staleRead({ data: [article] }) };
    await mounted(<PortalKbPage />);
    await expectCopy('How password resets work');
    fireEvent.change(screen.getByPlaceholderText('Search articles...'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('No articles found')).toBeTruthy();
    expect(alerts()).toContain('the articles below are the last read');
    expect(screen.queryByText(/We could not load the knowledge base/)).toBeNull();
  });

  it('a read that never answered is the outage, with the reason, and "No articles found" is unreachable', async () => {
    registry.byUrl = { [KB]: failed('Request failed (500)') };
    await mounted(<PortalKbPage />);
    await expectCopy('We could not load the knowledge base', 'alert');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.queryByText('No articles found')).toBeNull();
  });

  it('the caveat retries the article read', async () => {
    const read = staleRead({ data: [article] });
    registry.byUrl = { [KB]: read };
    await mounted(<PortalKbPage />);
    await expectCopy('the articles below are the last read', 'alert');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(read.refetch).toHaveBeenCalledTimes(1);
  });

  it('a successful empty read still says none, with no alert', async () => {
    registry.byUrl = { [KB]: ok({ data: [] }) };
    await mounted(<PortalKbPage />);
    await expectCopy('No articles found');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal over an answer that was empty says none AND adds the caveat', async () => {
    registry.byUrl = { [KB]: staleRead({ data: [] }) };
    await mounted(<PortalKbPage />);
    await expectCopy('No articles found');
    expect(alerts()).toContain('the articles below are the last read');
    expect(screen.queryByText(/We could not load the knowledge base/)).toBeNull();
  });

  it('a read that answers shows the articles and says nothing about freshness', async () => {
    registry.byUrl = { [KB]: ok({ data: [article] }) };
    await mounted(<PortalKbPage />);
    await expectCopy('How password resets work');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal that carries no message still names the reason', async () => {
    registry.byUrl = { [KB]: staleRead({ data: [article] }, '') };
    await mounted(<PortalKbPage />);
    await expectCopy('no response from the server', 'alert');

    registry.byUrl = { [KB]: failed('') };
    await mounted(<PortalKbPage />);
    await expectCopy('no response from the server', 'alert');
  });
});

describe('tenant settings billing invoices: kept history is not a silent success (#2872)', () => {
  it('keeps the row, its amount and its link, and calls them the last read', async () => {
    const read = staleRead({ data: [billingRow] });
    registry.byUrl = { [TENANT_INVOICES]: read };
    await mounted(<TenantInvoicesPage />);
    expect(screen.getByText('subscription monthly')).toBeTruthy();
    // #2551's money column survives the refused refresh — the list states what it holds.
    expect(screen.getByText('$49.00')).toBeTruthy();
    expect(screen.getByRole('link', { name: /view/i })).toBeTruthy();
    expect(alerts()).toContain('the invoice list below is the last read');
    expect(alerts()).toContain('Request failed (504)');
    expect(screen.queryByText(/Failed to load your invoices/)).toBeNull();
    expect(screen.queryByText('No invoices yet')).toBeNull();
  });

  it('a read that never answered is the outage, with the reason, and "No invoices yet" is unreachable', async () => {
    registry.byUrl = { [TENANT_INVOICES]: failed('Request failed (500)') };
    await mounted(<TenantInvoicesPage />);
    expect(alerts()).toContain('Failed to load your invoices');
    expect(alerts()).toContain('Request failed (500)');
    expect(screen.queryByText('No invoices yet')).toBeNull();
    expect(document.querySelector('tbody tr')).toBeNull();
  });

  it('both the outage and the caveat re-run this read', async () => {
    const outage = failed('Request failed (500)');
    registry.byUrl = { [TENANT_INVOICES]: outage };
    await mounted(<TenantInvoicesPage />);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(outage.refetch).toHaveBeenCalledTimes(1);

    const kept = staleRead({ data: [billingRow] });
    registry.byUrl = { [TENANT_INVOICES]: kept };
    await mounted(<TenantInvoicesPage />);
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: /try again/i }));
    expect(kept.refetch).toHaveBeenCalledTimes(1);
  });

  it('a successful empty read still says none, with no alert', async () => {
    registry.byUrl = { [TENANT_INVOICES]: ok({ data: [] }) };
    await mounted(<TenantInvoicesPage />);
    expect(screen.getByText('No invoices yet')).toBeTruthy();
    expect(screen.getByText('Invoices will appear here after your first payment')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal over an answer that was empty says none AND adds the caveat', async () => {
    // The history did answer "none"; the refused refresh may have picked up a newer
    // invoice, and that is all the page is entitled to say about it.
    registry.byUrl = { [TENANT_INVOICES]: staleRead({ data: [] }) };
    await mounted(<TenantInvoicesPage />);
    expect(screen.getByText('No invoices yet')).toBeTruthy();
    expect(alerts()).toContain('the invoice list below is the last read');
    expect(screen.queryByText(/Failed to load your invoices/)).toBeNull();
  });

  it('a read that answers shows the history and says nothing about freshness', async () => {
    registry.byUrl = { [TENANT_INVOICES]: ok({ data: [billingRow] }) };
    await mounted(<TenantInvoicesPage />);
    expect(screen.getByText('subscription monthly')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refusal that carries no message still names the reason', async () => {
    registry.byUrl = { [TENANT_INVOICES]: failed('') };
    await mounted(<TenantInvoicesPage />);
    expect(alerts()).toContain('no response from the server');

    registry.byUrl = { [TENANT_INVOICES]: staleRead({ data: [billingRow] }, '') };
    await mounted(<TenantInvoicesPage />);
    expect(alerts()).toContain('no response from the server');
  });
});

describe('one refused refresh does not put a retry on the sibling read (#2872)', () => {
  // Both portal lists are open in the same session, both cached, both refused. The caveat
  // on each has to re-run that page's read: a retry wired to the other key would leave the
  // invoice list stale while looking fresh.
  async function bothStale() {
    const invoiceRead = staleRead({ data: [portalInvoice] });
    const kbRead = staleRead({ data: [article] });
    registry.byUrl = { [PORTAL_INVOICES]: invoiceRead, [KB]: kbRead };
    await mounted(
      <>
        <PortalInvoicesPage />
        <PortalKbPage />
      </>,
    );
    await expectCopy('the invoices below are the last read', 'alert');
    return { invoiceRead, kbRead };
  }

  const alertMentioning = (word: string) => {
    const el = screen.getAllByRole('alert').find((a) => (a.textContent ?? '').includes(word));
    expect(el, alerts()).toBeTruthy();
    return el as HTMLElement;
  };

  it('the invoice caveat retries the invoice read, not the article read', async () => {
    const { invoiceRead, kbRead } = await bothStale();
    fireEvent.click(within(alertMentioning('invoice')).getByRole('button', { name: /try again/i }));
    expect(invoiceRead.refetch).toHaveBeenCalledTimes(1);
    expect(kbRead.refetch).not.toHaveBeenCalled();
  });

  it('the article caveat retries the article read, not the invoice read', async () => {
    const { invoiceRead, kbRead } = await bothStale();
    fireEvent.click(within(alertMentioning('article')).getByRole('button', { name: /try again/i }));
    expect(kbRead.refetch).toHaveBeenCalledTimes(1);
    expect(invoiceRead.refetch).not.toHaveBeenCalled();
  });
});

describe('the ratchet this slice is measured by (#2872)', () => {
  const ROOT = process.cwd();
  const PAGES = [
    { file: 'app/portal/(protected)/invoices/page.tsx', error: 'error', failed: 'failed', stale: 'stale' },
    { file: 'app/portal/(protected)/kb/page.tsx', error: 'error', failed: 'failed', stale: 'stale' },
    {
      file: 'app/tenant/settings/billing/invoices/page.tsx',
      error: 'invoicesError',
      failed: 'invoicesFailed',
      stale: 'invoicesStale',
    },
  ];

  for (const { file, error, failed: failedName, stale: staleName } of PAGES) {
    it(`${file} separates the outage from the refused refresh`, () => {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src, `${file} never separates the outage from the stale read`)
        .toMatch(new RegExp(`const ${failedName} = Boolean\\(${error}\\) && !data;`));
      expect(src, `${file} keeps the rows without saying they are the last read`)
        .toMatch(new RegExp(`const ${staleName} = Boolean\\(${error}\\) && Boolean\\(data\\);`));
      expect(src, `${file} prints a raw error that can be undefined`)
        .toMatch(/\.message \|\| 'no response from the server'/);
      expect(src, `${file} never routes the outage through the bare flag`).toMatch(new RegExp(`${failedName} \\?`));
    });

    it(`${file} has stopped asking the bare flag`, () => {
      const src = readFileSync(join(ROOT, file), 'utf8');
      // #2825/#2829's spellings — the flag alone as the branch, and the flag plus emptiness
      // as the branch — are gone. Optional chaining on the error is not one of them.
      expect(src, `${file} still treats any error as an outage`).not.toMatch(/\berror \? \(/);
      expect(src, `${file} still treats any error as an outage`).not.toMatch(new RegExp(`\\b${error}\\s+\\?`));
      expect(src, `${file} still gates the outage on emptiness`).not.toMatch(/\berror && !\(/);
      expect(src, `${file} dashes or zeroes a figure on the bare error`).not.toMatch(/\w*[Ee]rror \? '/);
    });
  }

  it('carries no read failure in a toast, on any of the three', () => {
    // These three never had the toast-only shape, so this is the regression half: a page
    // state may not be moved onto a channel that fades out from under the reader.
    for (const { file } of PAGES) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(src, `${file} hands a page state to a fading toast`).not.toMatch(/toast\.error\(/);
      expect(src, `${file} gained a suppression this repo forbids`).not.toMatch(/no-explicit-any/);
    }
  });

  it("keeps #2829's guard green and adds nothing to its baseline", () => {
    const doc = JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ) as { files: Record<string, string> };
    // A ceiling, never an equality: the other #2872 slices are moving this number down.
    expect(Object.keys(doc.files).length).toBeLessThanOrEqual(0);
    for (const { file } of PAGES) {
      expect(doc.files[file], `${file} should never have been allowlisted`).toBeUndefined();
    }
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
  });

  it('is not something the guard could have caught anyway', async () => {
    // Take the caveat away and the guard still calls the page clean: it asks one question —
    // does a failure reach the screen? — and one does, just in the wrong branch.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const { file, stale: staleName } of PAGES) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      expect(inspect(file, src).offends, `${file} is now visible to the guard on its own`).toBe(false);
      const withoutStale = src
        .replace(/\n\s*\{\s*\/\* Kept [\s\S]*?\n\s*\)\}\n/g, '\n')
        .replace(new RegExp(`const ${staleName} = [^\\r\\n]*\\r?\\n`, 'g'), '');
      expect(withoutStale, `${file}: the stale block changed shape, update this check`).not.toBe(src);
      expect(inspect(file, withoutStale).offends, `${file} would now be visible to the guard`).toBe(false);
    }
  });

  it('is not something the branch order could have caught either', async () => {
    // Rewinding `failed` back to the bare flag keeps the guard, the baseline and every #2825
    // and #2829 assertion green — which is what makes the render cases above the only screen
    // on this class.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    for (const { file, failed: failedName } of PAGES) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      const bare = src
        .replace(new RegExp(`\\b${failedName} \\?`, 'g'), 'errorFlag ?')
        .replace(new RegExp(`const ${failedName} = [^\\r\\n]*\\r?\\n`, 'g'), '');
      expect(bare, `${file}: the outage branch changed spelling, update this check`).not.toBe(src);
      expect(inspect(file, bare).offends, `${file} would now be visible to the guard`).toBe(false);
    }
  });

  it('does not teach the #2825 and #2829 suites to speak about a kept read', () => {
    // Overlap hygiene: those suites are the outage contract. If one of them started saying
    // "last read" it would be asserting this slice's work, and hiding its absence.
    for (const spec of [
      'tests/unit/portal-page-error-not-empty-2825.test.tsx',
      'tests/unit/panel-page-error-not-empty-tenant-lists-2829.test.tsx',
      'tests/unit/portal-invoice-shape-2747.test.tsx',
    ]) {
      expect(readFileSync(join(ROOT, spec), 'utf8'), `${spec} speaks about a kept read`).not.toMatch(/last read/);
    }
  });

  it('stays inside the line ceiling each page is allowed', () => {
    for (const { file } of PAGES) {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n').length - 1;
      expect(lines, `${file} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
