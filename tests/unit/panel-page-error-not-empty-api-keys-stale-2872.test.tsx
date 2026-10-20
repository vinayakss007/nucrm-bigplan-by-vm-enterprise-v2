// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2872 — `app/tenant/settings/api-keys/page.tsx`.
 *
 * #2829 asked only "does a refused read print a there-are-none sentence?" This page
 * passed that: `keysError` gated an InlineErrorState instead of "No API keys yet".
 * But `keysError` is a bare flag, and it conflates two different facts. This page
 * invalidates `['tenant','api-keys']` after create (page.tsx:66 `reload()`) and after
 * revoke (page.tsx:72 `reload()`), and TanStack keeps the previous `data` whenever a
 * *revalidation* of an already-answered query fails. So a refused refresh — the exact
 * state a save drops you into — used to render the kept rows and say nothing at all.
 *
 * The split this suite pins:
 *   failed (error, no data)  → #2829's verbatim outage sentence, empty claim absent;
 *   stale  (error, data kept) → rows STILL on screen, an alert above them that names
 *                                THIS page's loss, and never "No API keys yet".
 *
 * The loss it names, and why the Revoke button is not disabled:
 *   - GET selects named columns and never returns the secret (route.ts:31-42, only
 *     `key_prefix`), so the one-time reveal is driven by `newKey` state — never the
 *     read model, and it must render regardless.
 *   - the `[id]` DELETE re-reads the row (route.ts:34) and 404s when it is gone
 *     (route.ts:48), so a Revoke click on a vanished key gets a real 404 — the button
 *     may stay live over a stale read.
 *   - `is_active` (the Revoked badge, :140) and `last_used_at` (:144) are frozen at
 *     the last read: a key revoked/expired elsewhere still shows Revoke, and "Last
 *     used" is the OLDER value — a key that looks idle may be live traffic right now.
 *
 * Fixtures are documentation-only; the revealed key is an obviously fake sentinel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
}));
// The real formatters/cn are kept; only the network edge is stubbed so the create
// (POST) and revoke (DELETE) handlers can run against a fake, obviously-not-live key.
vi.mock('@/lib/utils', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/utils')>();
  return {
    ...actual,
    apiFetch: vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ key: 'ak_live_test_never_real', prefix: 'ak_live' }),
      }),
    ),
  };
});

import APIKeysPage from '@/app/tenant/settings/api-keys/page';
import { apiFetch } from '@/lib/utils';

const KEYS = '/api/tenant/api-keys';

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** TanStack's refused-refresh state: the error is set but `data` survives. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

// Documentation-only rows. `last_used_at` set so the "Last used" span renders;
// a second row is inactive so the Revoked badge renders.
const liveRow = {
  id: 'k1', name: 'Reporting integration', key_prefix: 'ak_live_abc', scopes: ['leads:read'],
  is_active: true, created_at: '2026-01-04T00:00:00.000Z',
  last_used_at: '2026-03-01T09:00:00.000Z', expires_at: null,
};
const revokedRow = {
  id: 'k2', name: 'Old Zapier hook', key_prefix: 'ak_live_def', scopes: [],
  is_active: false, created_at: '2025-12-01T00:00:00.000Z',
  last_used_at: null, expires_at: null,
};
const rows = { data: [liveRow, revokedRow] };

const SENTINEL = 'ak_live_test_never_real';
const EMPTY = /No API keys yet/;
const OUTAGE = "Could not load this workspace's API keys — this is a failed request, not an empty list.";

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

// The Revoke control carries no text (icon-only), so scope it to its row: the row
// wrapper is the only element with the `items-start` class between the name and button.
const revokeButtonFor = (name: string) => {
  const row = screen.getByText(name).closest('.items-start')!;
  return within(row).getByRole('button');
};

beforeEach(() => { registry.byUrl = {}; vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('api keys: a healthy or empty read is not reported as a failure (#2872)', () => {
  it('renders the rows, with no alert and no emptiness claim', () => {
    registry.byUrl = { [KEYS]: ok(rows) };
    wrapped(<APIKeysPage />);
    expect(screen.getByText('Reporting integration')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('says "No API keys yet" with no alert when the read answered with none', () => {
    registry.byUrl = { [KEYS]: ok({ data: [] }) };
    wrapped(<APIKeysPage />);
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('renders the Revoked badge and the "Last used" figure from the kept rows', () => {
    registry.byUrl = { [KEYS]: ok(rows) };
    wrapped(<APIKeysPage />);
    expect(screen.getByText('Revoked')).toBeTruthy();
    expect(screen.getByText(/Last used/i)).toBeTruthy();
  });
});

describe('api keys: a read that never answered still gets #2829\'s verbatim outage sentence (#2872)', () => {
  it('shows the outage sentence, not the emptiness claim', () => {
    registry.byUrl = { [KEYS]: failed('Request failed (500)') };
    wrapped(<APIKeysPage />);
    expect(alerts()).toContain(OUTAGE);
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('wires the alert\'s "Try again" to this read\'s refetch', () => {
    registry.byUrl = { [KEYS]: failed('Request failed (500)') };
    wrapped(<APIKeysPage />);
    const banner = screen.queryAllByRole('alert').find((el) => /API keys/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[KEYS].refetch).toHaveBeenCalled();
  });
});

describe('api keys: a refused refresh keeps the rows AND says what it cost (#2872 — ratchet)', () => {
  it('keeps the rows on screen while raising an alert above them', () => {
    registry.byUrl = { [KEYS]: staleRead(rows) };
    wrapped(<APIKeysPage />);
    expect(screen.getByText('Reporting integration')).toBeTruthy();
    expect(screen.getByText('Old Zapier hook')).toBeTruthy();
    // The empty claim must not appear — rows are on screen, they just stopped updating.
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it('names THIS page\'s loss, not a generic "may be out of date"', () => {
    registry.byUrl = { [KEYS]: staleRead(rows, 'Request failed (504)') };
    wrapped(<APIKeysPage />);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    // The specific loss: revoked-elsewhere + still-offered Revoke, and a stale "Last used".
    expect(alerts()).toMatch(/Revoke/i);
    expect(alerts()).toMatch(/signs nothing new out/i);
    expect(alerts()).toMatch(/live traffic right now/i);
    // Operator-facing: the route facts above are what makes that true, but the banner
    // is not where a status code belongs.
    expect(alerts()).not.toMatch(/\b404\b|route|endpoint/i);
  });

  it('leaves the Revoke button clickable over a stale row — the route 404s on a gone key', () => {
    registry.byUrl = { [KEYS]: staleRead(rows) };
    wrapped(<APIKeysPage />);
    const btn = revokeButtonFor('Reporting integration');
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(apiFetch).toHaveBeenCalledWith(`/api/tenant/api-keys/${liveRow.id}`, { method: 'DELETE' });
  });

  it('re-runs the read from the stale banner', () => {
    registry.byUrl = { [KEYS]: staleRead(rows) };
    wrapped(<APIKeysPage />);
    const banner = screen.queryAllByRole('alert').find((el) => /last read/i.test(el.textContent ?? ''))!;
    fireEvent.click(within(banner).getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[KEYS].refetch).toHaveBeenCalled();
  });

  it('the one-time key reveal still renders regardless of the refused read', async () => {
    // newKey is POST-response state (page.tsx), never re-readable from GET, so the
    // read model — even a stale one — must not touch it.
    registry.byUrl = { [KEYS]: staleRead(rows) };
    wrapped(<APIKeysPage />);
    fireEvent.click(screen.getByRole('button', { name: /new key/i }));
    fireEvent.change(screen.getByPlaceholderText(/Zapier Integration/i), { target: { value: 'Doc only key' } });
    const form = screen.getByRole('button', { name: /create key/i }).closest('form')!;
    fireEvent.submit(form);
    expect(await screen.findByText(SENTINEL)).toBeTruthy();
  });
});
