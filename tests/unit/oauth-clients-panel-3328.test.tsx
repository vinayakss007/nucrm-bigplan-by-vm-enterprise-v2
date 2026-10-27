/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3328 — `app/tenant/settings/oauth-clients/page.tsx`.
 *
 * Two properties this screen has to keep, both of which a later edit can undo quietly:
 *
 *  - the secret is on screen exactly once. `/api/tenant/oauth-clients` never returns it,
 *    so the reveal card is the only place it exists after registration and the only way
 *    an admin can get one at all is a create or a rotate that just answered.
 *  - a write that reloads this screen can fail its refresh while still holding the last
 *    read (#2872), and "no OAuth clients yet" next to a Register button would invite a
 *    duplicate registration of a client that exists.
 *
 * The destructive verbs are behind `confirmThen`, and the copy there is load-bearing: it
 * is what tells the operator that a delete cascades to codes and tokens while a
 * deactivation does not.
 */
// @vitest-environment jsdom
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

const LIST_URL = '/api/tenant/oauth-clients';
const ROOT = join(process.cwd());
const PAGE = 'app/tenant/settings/oauth-clients/page.tsx';

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));
const calls = vi.hoisted(() => ({
  confirms: [] as string[],
  sent: [] as { url: string; method: string; body: string }[],
  clipboard: [] as string[],
  responses: [] as unknown[],
}));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (message: string, fn: () => unknown) => {
    calls.confirms.push(message);
    return fn();
  },
}));

import OAuthClientsPage from '@/app/tenant/settings/oauth-clients/page';

const CREATED = '2026-01-04T00:00:00.000Z';
const rows = {
  data: [
    { id: 'oc1', name: 'Accounting sync', client_id: 'oc_1111', redirect_uris: ['https://erp.example.test/cb'], is_active: true, created_at: CREATED },
    { id: 'oc2', name: 'Legacy portal', client_id: 'oc_2222', redirect_uris: ['https://old.example.test/cb', 'https://staging.example.test/cb'], is_active: false, created_at: CREATED },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (503)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () => screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

const src = (file: string) => readFileSync(join(ROOT, file), 'utf8');

/** Answers the writes, in the order the page makes them. */
function mount(node: ReactNode, qc = new QueryClient()) {
  cleanup();
  calls.sent.length = 0;
  vi.spyOn(qc, 'invalidateQueries');
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    calls.sent.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ?? '' });
    const next = calls.responses.shift();
    const payload = next ?? { ok: true };
    const status = typeof payload === 'object' && 'status' in payload ? Number((payload as { status: number }).status) : 200;
    const body = typeof payload === 'object' && 'body' in payload ? (payload as { body: unknown }).body : payload;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }));
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  registry.byUrl = { [LIST_URL]: ok(rows) };
  calls.confirms.length = 0;
  calls.responses.length = 0;
  calls.clipboard.length = 0;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (text: string) => { calls.clipboard.push(text); return Promise.resolve(); } },
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the list keeps its own shape', () => {
  it('shows each client, its id and every registered URI as its own chip', () => {
    mount(<OAuthClientsPage />);
    expect(screen.getByText('Accounting sync')).toBeTruthy();
    expect(screen.getByText('oc_1111')).toBeTruthy();
    expect(screen.getByText('https://erp.example.test/cb')).toBeTruthy();
    expect(screen.getAllByText('https://staging.example.test/cb')).toHaveLength(1);
  });

  it('marks a deactivated client and offers the way back', () => {
    mount(<OAuthClientsPage />);
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Enable$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Disable$/ })).toBeTruthy();
  });

  it('says none exist, without an alert, when that is what came back', () => {
    registry.byUrl = { [LIST_URL]: ok({ data: [] }) };
    mount(<OAuthClientsPage />);
    expect(screen.getByText(/No OAuth clients yet/)).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

describe('a refused refresh is not an empty list (#2872)', () => {
  it('keeps both clients and says the list is the last read', () => {
    registry.byUrl = { [LIST_URL]: staleRead(rows) };
    mount(<OAuthClientsPage />);
    expect(screen.getByText('Accounting sync')).toBeTruthy();
    expect(screen.getByText('Legacy portal')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(alerts()).toMatch(/registered, rotated or deleted/i);
  });

  it('does not call kept rows a failed load, nor an empty list', () => {
    registry.byUrl = { [LIST_URL]: staleRead(rows) };
    mount(<OAuthClientsPage />);
    expect(alerts()).not.toMatch(/this is a failed request, not an empty list/);
    expect(screen.queryByText(/No OAuth clients yet/)).toBeNull();
  });

  it('shows the outage card for a read that never answered', () => {
    registry.byUrl = { [LIST_URL]: failed('Request failed (503)') };
    mount(<OAuthClientsPage />);
    expect(screen.queryByText('Accounting sync')).toBeNull();
    expect(screen.queryByText(/No OAuth clients yet/)).toBeNull();
    expect(alerts()).toContain(
      "Could not load this workspace's OAuth clients — this is a failed request, not an empty list. Request failed (503)",
    );
    expect(alerts()).not.toMatch(/last read/);
  });

  it('says none exist when the empty list is all the last read has', () => {
    registry.byUrl = { [LIST_URL]: staleRead({ data: [] }) };
    mount(<OAuthClientsPage />);
    expect(screen.getByText(/No OAuth clients yet/)).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('re-runs the read from the caveat', () => {
    registry.byUrl = { [LIST_URL]: staleRead(rows) };
    mount(<OAuthClientsPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[LIST_URL].refetch).toHaveBeenCalledTimes(1);
  });
});

describe('registering a client', () => {
  it('sends the URI textarea as one array entry per line, blank lines dropped', async () => {
    const qc = new QueryClient();
    mount(<OAuthClientsPage />, qc);
    fireEvent.click(screen.getByRole('button', { name: /new client/i }));
    fireEvent.change(screen.getByLabelText(/Name \*/i), { target: { value: 'Accounting sync' } });
    fireEvent.change(screen.getByLabelText(/Redirect URIs/i), {
      target: { value: 'https://a.example.test/cb\n\n  https://b.example.test/cb  \n' },
    });
    calls.responses.push({ status: 201, body: { ok: true, id: 'oc9', client_id: 'oc_new', client_secret: 'ocs_new', name: 'Accounting sync', warning: 'Store this secret now.' } });
    fireEvent.click(screen.getByRole('button', { name: /register client/i }));
    await waitFor(() => expect(calls.sent[0]?.method).toBe('POST'));
    expect(JSON.parse(calls.sent[0]!.body).redirect_uris).toEqual([
      'https://a.example.test/cb', 'https://b.example.test/cb',
    ]);
    expect(JSON.parse(calls.sent[0]!.body).name).toBe('Accounting sync');
    await waitFor(() => expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['tenant', 'oauth-clients'] }));
  });

  it('reveals the pair once, with the warning the server sent', async () => {
    mount(<OAuthClientsPage />);
    fireEvent.click(screen.getByRole('button', { name: /new client/i }));
    fireEvent.change(screen.getByLabelText(/Name \*/i), { target: { value: 'Partner' } });
    fireEvent.change(screen.getByLabelText(/Redirect URIs/i), { target: { value: 'https://a.example.test/cb' } });
    calls.responses.push({ status: 201, body: { ok: true, id: 'oc9', client_id: 'oc_new', client_secret: 'ocs_new', name: 'Partner', warning: 'It will never be shown again.' } });
    fireEvent.click(screen.getByRole('button', { name: /register client/i }));

    await waitFor(() => expect(screen.getByText('ocs_new')).toBeTruthy());
    expect(screen.getByText('oc_new')).toBeTruthy();
    expect(screen.getByText(/Partner registered/)).toBeTruthy();
    expect(screen.getByText('It will never be shown again.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Dismiss$/ }));
    expect(screen.queryByText('ocs_new')).toBeNull();
  });

  it('prints the field-level refusal instead of pretending the client exists', async () => {
    const toast = (await import('react-hot-toast')).default;
    mount(<OAuthClientsPage />);
    fireEvent.click(screen.getByRole('button', { name: /new client/i }));
    fireEvent.change(screen.getByLabelText(/Name \*/i), { target: { value: 'Partner' } });
    fireEvent.change(screen.getByLabelText(/Redirect URIs/i), { target: { value: 'javascript:alert(1)' } });
    calls.responses.push({ status: 400, body: { error: 'Validation failed', details: [{ field: 'redirect_uris', message: 'redirect_uri "javascript:alert(1)" has scheme javascript — only http and https can receive a redirect' }] } });
    fireEvent.click(screen.getByRole('button', { name: /register client/i }));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const shown = String(vi.mocked(toast.error).mock.calls[0][0]);
    expect(shown).toContain('Validation failed');
    expect(shown).toContain('only http and https');
    expect(screen.queryByText('ocs_new')).toBeNull();
  });

  it('states the matching rule where the URIs are typed', () => {
    mount(<OAuthClientsPage />);
    fireEvent.click(screen.getByRole('button', { name: /new client/i }));
    expect(screen.getByText(/Exact match, including path and port/i)).toBeTruthy();
    expect(screen.getByText(/No fragments, no commas, no other schemes/i)).toBeTruthy();
  });
});

describe('rotating and retiring a client', () => {
  it('warns that the old secret stops working, then reveals the new one once', async () => {
    mount(<OAuthClientsPage />);
    calls.responses.push({ status: 200, body: { ok: true, id: 'oc1', client_id: 'oc_1111', client_secret: 'ocs_rotated', warning: 'The previous one stopped working.' } });
    fireEvent.click(screen.getByRole('button', { name: /rotate the secret of Accounting sync/i }));

    expect(calls.confirms[0]).toMatch(/old secret stops working immediately/i);
    await waitFor(() => expect(screen.getByText('ocs_rotated')).toBeTruthy());
    expect(calls.sent[0].url).toBe('/api/tenant/oauth-clients/oc1/rotate');
    expect(calls.sent[0].method).toBe('POST');
  });

  it('names the token cascade before it deletes', async () => {
    const qc = new QueryClient();
    mount(<OAuthClientsPage />, qc);
    calls.responses.push({ status: 200, body: { success: true } });
    fireEvent.click(screen.getByRole('button', { name: /Delete Accounting sync/i }));
    expect(calls.confirms[0]).toMatch(/authorization codes and every token it holds are revoked/i);
    expect(calls.confirms[0]).toMatch(/Deactivating keeps the record/i);
    await waitFor(() => expect(calls.sent[0]?.method).toBe('DELETE'));
    expect(qc.invalidateQueries).toHaveBeenCalled();
  });

  it('flips is_active on the row it clicked and reloads', async () => {
    const qc = new QueryClient();
    mount(<OAuthClientsPage />, qc);
    calls.responses.push({ status: 200, body: { data: { ...rows.data[1], is_active: true } } });
    fireEvent.click(screen.getByRole('button', { name: /^Enable$/ }));
    await waitFor(() => expect(calls.sent[0]?.method).toBe('PATCH'));
    expect(calls.sent[0].url).toBe('/api/tenant/oauth-clients/oc2');
    expect(JSON.parse(calls.sent[0]!.body)).toEqual({ is_active: true });
    await waitFor(() => expect(qc.invalidateQueries).toHaveBeenCalled());
  });

  it('says which client could not be changed when the write is refused', async () => {
    const toast = (await import('react-hot-toast')).default;
    mount(<OAuthClientsPage />);
    calls.responses.push({ status: 500, body: { error: 'Could not reach the directory' } });
    fireEvent.click(screen.getByRole('button', { name: /^Disable$/ }));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Could not reach the directory'));
  });

  it('copies the id of a listed client without ever showing a secret', async () => {
    mount(<OAuthClientsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy client id for Accounting sync' }));
    await waitFor(() => expect(calls.clipboard).toEqual(['oc_1111']));
    expect(screen.queryByText(/ocs_/)).toBeNull();
  });
});

describe('source shape', () => {
  it('reads the secret only off a fresh response, never off a row', () => {
    const s = src(PAGE);
    // Both reveals are POST bodies; the list endpoint cannot return a secret, so a row
    // type carrying one would mean the page expects it from a read that never has it.
    expect(s).not.toMatch(/\b(clients|client|row|data)\b[^\n]*client_secret/);
    expect(s.match(/client_secret: body\.client_secret/g)).toHaveLength(2);
    expect(s).toMatch(/interface OAuthClient \{[^}]*redirect_uris: string\[\]/s);
    expect(s).not.toMatch(/interface OAuthClient \{[^}]*client_secret/s);
  });

  it('sends every credential it holds through the clipboard, not the URL', () => {
    const s = src(PAGE);
    expect(s).toMatch(/navigator\.clipboard\.writeText/);
    expect(s).not.toMatch(/window\.location\s*=\s*[^;]*client_secret/);
  });

  it('stays inside the panel contract and the size ceiling', () => {
    expect(src(PAGE).split('\n').length).toBeLessThanOrEqual(500);
    const guard = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(guard.status, guard.stdout + guard.stderr).toBe(0);
    const size = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(size.status, size.stdout + size.stderr).toBe(0);
  });
});
