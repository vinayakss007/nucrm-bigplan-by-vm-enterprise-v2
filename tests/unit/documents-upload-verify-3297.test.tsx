// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3297 — the panel is the half of the meter that has to ask.
 *
 * `app/api/tenant/documents/[id]/verify` settles `documents.size_bytes` against the
 * object the store actually holds, and `route.ts:126` records the number the browser
 * typed. If nobody calls the settle, the route is decoration: the declared size stays
 * in the column that `max_storage_gb` is summed from, and the workspace reports
 * itself nearly empty while the bucket grows. #3298 made this exact mistake visible
 * — a control that only some callers reach reads as working — so the guarantee this
 * spec owns is "the uploader reaches it", not "the endpoint works" (that is
 * `document-size-verify-3297.test.ts`).
 *
 * `fakeFetch` below is the route, the same way `documents-panel-contract-2782.test.tsx`
 * stubs the list and metadata endpoints: it stores the declared size, then on the
 * settle replaces it with the object's real length and behaves the four ways the
 * route can answer — 200 settled, 200 nothing-to-do, 413 over-plan-and-removed,
 * 502 store-unreachable. An unmatched URL still throws, so a panel that calls the
 * wrong path fails here instead of passing on a canned 200.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import DocumentsPanel from '@/components/documents/documents-panel';

const TENANT = '11111111-1111-4111-8111-111111111111';
const DEAL_ID = '22222222-2222-4222-8222-222222222222';
const REAL_BYTES = 104_857_600; // what the store holds for a file declared as 4096

const toast = vi.hoisted(() => ({
  loading: vi.fn(() => 'toast-1'),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({ default: toast }));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_m: string, onConfirm: () => void) => onConfirm(),
}));

let events: string[] = [];
let verifyPaths: string[] = [];
let verifyBodies: Record<string, unknown>[] = [];
let rows: Record<string, unknown>[] = [];
let settleAnswer: 'settled' | 'clean' | 'over-plan' | 'store-down' = 'settled';
let id = 0;

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

function fakeFetch(input: string, init?: RequestInit) {
  const method = init?.method ?? 'GET';
  const url = new URL(input, 'http://localhost:3000');

  if (method === 'GET' && url.pathname === '/api/tenant/documents') {
    const entityType = url.searchParams.get('entityType');
    const entityId = url.searchParams.get('entityId');
    let out = rows;
    if (entityType) out = out.filter((r) => r.entityType === entityType);
    if (entityId) out = out.filter((r) => r.entityId === entityId);
    return json({ data: { documents: out, folders: [] }, page: 1, limit: 50, total: out.length });
  }

  if (method === 'POST' && url.pathname === '/api/tenant/documents') {
    events.push('meta');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const created = {
      id: `new-${(id += 1)}`,
      tenantId: TENANT,
      name: body.name,
      mimeType: body.mimeType,
      // The route stores the claim. Nothing here corrects it except the settle.
      sizeBytes: body.sizeBytes,
      s3Key: `documents/${TENANT}/new-${id}.pdf`,
      s3Bucket: 'nucrm-user-files',
      entityType: body.entityType ?? null,
      entityId: body.entityId ?? null,
      createdAt: '2026-10-01T10:00:00.000Z',
    };
    rows = [created, ...rows];
    return json({ data: { document: created, uploadUrl: `http://s3.test/${created.s3Key}` } }, 201);
  }

  if (method === 'PUT' && url.hostname === 's3.test') {
    events.push('put');
    return json({}, 200);
  }

  const settle = method === 'POST' && /^\/api\/tenant\/documents\/[^/]+\/verify$/.exec(url.pathname);
  if (settle) {
    events.push('verify');
    verifyPaths.push(url.pathname);
    verifyBodies.push((init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>);
    const docId = url.pathname.split('/')[4];
    const row = rows.find((r) => r.id === docId);
    if (!row) return json({ error: 'Not found' }, 404);

    if (settleAnswer === 'store-down') {
      return json({ error: 'store answered 503', measured: false }, 502);
    }
    if (settleAnswer === 'over-plan') {
      rows = rows.filter((r) => r.id !== docId);
      return json({
        error: 'The uploaded file does not fit within this plan once measured',
        declaredBytes: row.sizeBytes, measuredBytes: REAL_BYTES, removed: true,
      }, 413);
    }
    const adjusted = Number(row.sizeBytes) !== REAL_BYTES;
    if (adjusted && settleAnswer === 'settled') {
      rows = rows.map((r) => (r.id === docId ? { ...r, sizeBytes: REAL_BYTES } : r));
    }
    if (settleAnswer === 'clean') {
      return json({ data: { id: row.id, name: row.name, declaredBytes: row.sizeBytes, measuredBytes: row.sizeBytes, adjusted: false } });
    }
    return json({
      data: {
        id: row.id, name: row.name,
        declaredBytes: row.sizeBytes, measuredBytes: REAL_BYTES, adjusted,
      },
    });
  }

  throw new Error(`unhandled fetch: ${method} ${input}`);
}

function file(bytes: number, name = 'contract-scan.pdf') {
  return new File(['x'.repeat(bytes)], name, { type: 'application/pdf' });
}

async function upload(f: File) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  fireEvent.change(input);
  await waitFor(() => expect(events).toContain('verify'));
}

async function mount() {
  render(<DocumentsPanel entityType="deal" entityId={DEAL_ID} />);
  await waitFor(() => {
    if (screen.queryAllByRole('button', { name: /download/i }).length > 0
      || screen.queryByText(/no documents attached/i)) return;
    throw new Error('panel still loading');
  });
}

beforeEach(() => {
  events = [];
  verifyPaths = [];
  verifyBodies = [];
  id = 0;
  settleAnswer = 'settled';
  toast.loading.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
  rows = [];
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the panel settles the bytes it uploaded (#3297)', () => {
  it('calls the settle for the id the metadata route returned', async () => {
    await mount();
    await upload(file(4096));
    expect(verifyPaths).toEqual([`/api/tenant/documents/new-1/verify`]);
    expect(verifyBodies[0]).toEqual({});
  });

  it('settles after the bytes landed, never before', async () => {
    await mount();
    await upload(file(4096));
    expect(events).toEqual(['meta', 'put', 'verify']);
  });

  it('leaves the meter showing the measured size, not the declared one', async () => {
    await mount();
    await upload(file(4096));
    await waitFor(() => expect(screen.getByText(/100\.0 MB/)).toBeTruthy());
    expect(screen.queryByText(/4\.0 KB/)).toBeNull();
  });

  it('still reports success when the settle had nothing to correct', async () => {
    settleAnswer = 'clean';
    await mount();
    await upload(file(4096));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports an over-plan removal as a failed upload, because the file is gone', async () => {
    settleAnswer = 'over-plan';
    await mount();
    await upload(file(4096));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/no documents attached/i)).toBeTruthy());
  });

  it('does not fail an upload the store merely could not be measured on', async () => {
    // A 502 leaves the file exactly where the user put it. Telling them it failed
    // would be a lie, and they would re-upload bytes that are already stored.
    settleAnswer = 'store-down';
    await mount();
    await upload(file(4096));
    await waitFor(() => expect(screen.getByText('contract-scan.pdf')).toBeTruthy());
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('an unverified upload is not allowed to pass silently (#3297)', () => {
  it('the settle is reached for every file in a multi-file drop', async () => {
    await mount();
    const el = document.querySelector('input[type=file]') as HTMLInputElement;
    Object.defineProperty(el, 'files', {
      value: [file(1024, 'a.pdf'), file(2048, 'b.pdf')],
      configurable: true,
    });
    fireEvent.change(el);
    await waitFor(() => expect(verifyPaths).toHaveLength(2));
    expect(new Set(verifyPaths)).toEqual(new Set([
      '/api/tenant/documents/new-1/verify',
      '/api/tenant/documents/new-2/verify',
    ]));
  });
});
