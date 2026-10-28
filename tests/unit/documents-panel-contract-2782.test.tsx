// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2782 — the Documents tab on the deal page speaks a contract
 * `/api/tenant/documents` has never answered.
 *
 * `components/documents/documents-panel.tsx` sends `linked_entity_type` /
 * `linked_entity_id` (`:55-57`) to a route that reads `entityType` / `entityId` /
 * `folderId` (`app/api/tenant/documents/route.ts:57-59`), assigns `json.data` —
 * which is `{ documents, folders }` (`route.ts:106`) — straight into the array it
 * then calls `.map` on (`:63`, `:222`), prints `size_bytes` / `created_at` /
 * `uploaded_by_name` off rows that carry `sizeBytes` / `createdAt` and no uploader
 * at all (`:32-35`, `:232-233`), and POSTs metadata as
 * `{ name, storage_key, mime_type, size_bytes, linked_entity_* }` (`:102-110`) to a
 * handler that requires `name && mimeType && sizeBytes` and answers 400 without them
 * (`route.ts:139-144`).
 *
 * `app/tenant/documents/page.tsx:52-53,80-95` speaks the route's real contract and
 * works, which is why the panel — not the route — is fixed here. Download and delete
 * already match `documents/[id]` (`[id]/route.ts:58-70`) and are pinned as controls so
 * this change cannot silently move them.
 *
 * The fetch stub is the route: it filters the seeded rows by the parameters
 * `route.ts:67-75` reads, and it rejects an upload body the way `route.ts:139-151`
 * does. A canned 200 would let the panel pass while still naming the wrong keys.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import DocumentsPanel from '@/components/documents/documents-panel';

const TENANT = '11111111-1111-4111-8111-111111111111';
const DEAL_ID = '22222222-2222-4222-8222-222222222222';
const PEER_DEAL = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const MINE = '55555555-5555-4555-8555-555555555555';
const PEER = '66666666-6666-4666-8666-666666666666';

/** Rows as `db.select().from(documents)` returns them: Drizzle column properties. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: MINE,
    tenantId: TENANT,
    name: 'quarterly-report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2097152,
    s3Key: `documents/${TENANT}/${MINE}.pdf`,
    s3Bucket: 'user-files',
    folderId: null,
    entityType: 'deal',
    entityId: DEAL_ID,
    uploadedBy: USER,
    metadata: {},
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

let docs: Record<string, unknown>[] = [];
let gets: string[] = [];
let metaPosts: Record<string, unknown>[] = [];
let putKeys: string[] = [];
let downloadGets: string[] = [];
let deleteUrls: string[] = [];
let verifyPaths: string[] = [];
let id = 0;

/** Exactly the validation `route.ts:139-151` applies, in the same order. */
function validateMeta(body: Record<string, unknown>): { error: string; status: number } | null {
  const { name, mimeType, sizeBytes } = body;
  if (!name || !mimeType || !sizeBytes) {
    return { error: 'name, mimeType, and sizeBytes are required', status: 400 };
  }
  if (typeof sizeBytes !== 'number' || sizeBytes <= 0) {
    return { error: 'sizeBytes must be a positive number', status: 400 };
  }
  return null;
}

function fakeFetch(input: string, init?: RequestInit) {
  const method = init?.method ?? 'GET';
  const url = new URL(input, 'http://localhost:3000');

  if (method === 'GET' && url.pathname === '/api/tenant/documents') {
    gets.push(input);
    // route.ts:67-75 — the filter list is built from entityType / entityId / folderId
    // and nothing else, so an unknown parameter is silently ignored.
    const entityType = url.searchParams.get('entityType');
    const entityId = url.searchParams.get('entityId');
    const folderId = url.searchParams.get('folderId');
    let out = docs.filter((d) => d.tenantId === TENANT);
    if (entityType) out = out.filter((d) => d.entityType === entityType);
    if (entityId) out = out.filter((d) => d.entityId === entityId);
    if (folderId) out = out.filter((d) => d.folderId === folderId);
    else if (!entityType) out = out.filter((d) => d.folderId === null);
    return json({ data: { documents: out, folders: [] }, page: 1, limit: 50, total: out.length });
  }

  if (method === 'POST' && url.pathname === '/api/tenant/documents') {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    metaPosts.push(body);
    const bad = validateMeta(body);
    if (bad) return json({ error: bad.error }, bad.status);
    const created = row({
      id: `new-${(id += 1)}`,
      name: body['name'],
      mimeType: body['mimeType'],
      sizeBytes: body['sizeBytes'],
      entityType: body['entityType'] ?? null,
      entityId: body['entityId'] ?? null,
      s3Key: `documents/${TENANT}/new-${id}.pdf`,
    });
    docs = [created, ...docs];
    return json({ data: { document: created, uploadUrl: `http://s3.test/${created.s3Key}` } }, 201);
  }

  if (method === 'POST' && url.pathname === '/api/tenant/documents/upload-url') {
    const key = `documents/${TENANT}/signed-${(id += 1)}`;
    return json({
      upload_url: `http://s3.test/${key}`,
      storage_key: key,
      expires_in_seconds: 600,
      required_headers: { 'Content-Type': 'application/octet-stream' },
    });
  }

  if (method === 'PUT' && url.hostname === 's3.test') {
    putKeys.push(url.pathname);
    return json({}, 200);
  }

  // #3297 — the panel settles the row after the bytes land. This spec owns the
  // request/response contract of the upload; documents-upload-verify-3297.test.tsx
  // owns what the settle does with the answer, so it is served here as a no-op.
  if (method === 'POST' && /^\/api\/tenant\/documents\/[^/]+\/verify$/.test(url.pathname)) {
    verifyPaths.push(url.pathname);
    const docId = url.pathname.split('/')[4];
    const hit = docs.find((d) => d.id === docId);
    return json({
      data: {
        id: docId, name: hit?.name ?? 'unknown',
        declaredBytes: hit?.sizeBytes ?? 0, measuredBytes: hit?.sizeBytes ?? 0, adjusted: false,
      },
    });
  }

  if (method === 'DELETE' && /^\/api\/tenant\/documents(\/|$)/.test(url.pathname)) {
    deleteUrls.push(url.pathname);
    const docId = url.searchParams.get('id') ?? url.pathname.split('/').pop();
    const hit = docs.find((d) => d.id === docId);
    if (!hit) return json({ error: 'Document not found' }, 404);
    docs = docs.filter((d) => d.id !== docId);
    return json({ ok: true });
  }

  if (method === 'GET' && /^\/api\/tenant\/documents\/./.test(url.pathname)) {
    downloadGets.push(url.pathname);
    const docId = url.pathname.split('/').pop();
    const hit = docs.find((d) => d.id === docId);
    if (!hit) return json({ error: 'Not found' }, 404);
    return json({
      data: {
        id: hit.id, name: hit.name, storage_key: hit.s3Key, mime_type: hit.mimeType,
        size_bytes: hit.sizeBytes, uploaded_by: hit.uploadedBy, created_at: hit.createdAt,
        download_url: `http://s3.test/download/${hit.s3Key}`,
        download_url_expires_in_seconds: 600,
      },
    });
  }

  throw new Error(`unhandled fetch: ${method} ${input}`);
}

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, onConfirm: () => void) => onConfirm(),
}));

async function mount() {
  render(<DocumentsPanel entityType="deal" entityId={DEAL_ID} />);
  await settle();
}

/** Wait for whichever list branch settled: rows rendered, or the empty state. */
async function settle() {
  await waitFor(() => {
    const nodes = screen.queryAllByRole('button', { name: /download/i });
    if (nodes.length > 0 || screen.queryByText(/no documents attached/i)) return;
    throw new Error('panel still loading');
  });
}

const file = () => new File(['x'.repeat(4096)], 'contract-scan.pdf', { type: 'application/pdf' });

async function uploadOne() {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file()], configurable: true });
  fireEvent.change(input);
  await waitFor(() => expect(metaPosts.length).toBeGreaterThan(0));
}

beforeEach(() => {
  id = 0;
  gets = [];
  metaPosts = [];
  putKeys = [];
  downloadGets = [];
  deleteUrls = [];
  verifyPaths = [];
  docs = [
    row(),
    row({ id: PEER, name: 'peer-deal-doc.pdf', entityId: PEER_DEAL, s3Key: `documents/${TENANT}/${PEER}.pdf` }),
  ];
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.stubGlobal('open', vi.fn());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the panel asks the list route for this record (#2782)', () => {
  it('sends the parameters the route reads', async () => {
    await mount();
    expect(gets[0], gets[0]).toContain('entityType=deal');
    expect(gets[0], gets[0]).toContain(`entityId=${DEAL_ID}`);
    expect(gets[0]).not.toContain('linked_entity');
  });

  it('lists this deal\'s document', async () => {
    await mount();
    expect(screen.getByText('quarterly-report.pdf')).toBeTruthy();
  });

  it('does not list another deal\'s folder-less document', async () => {
    await mount();
    expect(screen.queryByText('peer-deal-doc.pdf'), 'the whole tenant\'s loose files appeared on one deal')
      .toBeNull();
  });

  it('renders the size and the date the row actually carries', async () => {
    await mount();
    const line = screen.getByText(/2\.0 MB/);
    expect(line.textContent).toContain('application/pdf');
    expect(line.textContent).toContain(new Date('2026-10-01T10:00:00.000Z').toLocaleDateString());
    expect(line.textContent).not.toMatch(/Invalid Date|undefined/);
  });
});

describe('an upload from the panel completes (#2782)', () => {
  it('posts the body the metadata route accepts', async () => {
    await mount();
    await uploadOne();
    expect(metaPosts[0]).toMatchObject({
      name: 'contract-scan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 4096,
      entityType: 'deal',
      entityId: DEAL_ID,
    });
    expect(metaPosts[0]).not.toHaveProperty('mime_type');
    expect(metaPosts[0]).not.toHaveProperty('size_bytes');
    expect(metaPosts[0]).not.toHaveProperty('storage_key');
  });

  it('is not rejected by the required-fields check', async () => {
    await mount();
    await uploadOne();
    expect(metaPosts[0] && validateMeta(metaPosts[0]), 'the route still 400s this body').toBeNull();
  });

  it('puts the bytes where the route says to put them', async () => {
    await mount();
    await uploadOne();
    expect(putKeys).toEqual([`/documents/${TENANT}/new-1.pdf`]);
  });

  it('settles the declared size against the store once the bytes land (#3297)', async () => {
    await mount();
    await uploadOne();
    await waitFor(() => expect(verifyPaths).toEqual([`/api/tenant/documents/new-1/verify`]));
    // The settle is for the row THIS upload created, and only after the PUT.
    expect(putKeys).toHaveLength(1);
  });

  it('shows the uploaded document once the list reloads', async () => {
    await mount();
    await uploadOne();
    await waitFor(() => expect(screen.getByText('contract-scan.pdf')).toBeTruthy());
  });
});

describe('the half of the panel that already worked does not move (#2782)', () => {
  it('download still reads the signed url off /documents/[id]', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    await waitFor(() => expect(downloadGets).toHaveLength(1));
    expect(downloadGets[0]).toBe(`/api/tenant/documents/${MINE}`);
    expect(vi.mocked(open)).toHaveBeenCalledWith(
      `http://s3.test/download/documents/${TENANT}/${MINE}.pdf`, '_blank',
    );
  });

  it('delete still targets /documents/[id]', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(deleteUrls).toHaveLength(1));
    expect(deleteUrls[0]).toBe(`/api/tenant/documents/${MINE}`);
  });
});
