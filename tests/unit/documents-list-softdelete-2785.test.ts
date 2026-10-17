/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All rights reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2785 — `GET /api/tenant/documents` never asked whether a document was deleted, while
 * the `DELETE` in the very same file is a soft delete.
 *
 * `app/api/tenant/documents/route.ts:247-248` (base) tombstones: `db.update(documents)
 * .set({ deletedAt: new Date() })`. The list built its filter at `:67` from the tenant
 * alone, and **both** the `count(*)` at `:77-80` and the page at `:82-88` read that one
 * array — so a deleted document stayed listed, stayed in `total`, and kept its place in
 * `order by created_at desc`. Clicking it then 404s, because the route that serves the
 * click *does* filter: `app/api/tenant/documents/[id]/route.ts:40` (metadata + signed URL)
 * and `:88`, plus `lib/esignature-internal.ts:98`, whose comment names the reason out loud.
 * The schema says which read shape is intended: `idx_documents_active` is a partial index
 * `on (id) where (deleted_at IS NULL)` (`drizzle/schema/documents.ts:54`).
 *
 * The reader is not canned. `withApiRoute`/`db` are replaced by a fake that captures the
 * predicate each query actually renders, compiles it with the real Postgres dialect, and
 * evaluates it against seeded rows. So a filter that drops a term **admits more rows**
 * rather than passing a string comparison, and the count and the page are each computed
 * from the rows their own predicate admits — which is what makes the two divergences this
 * issue is about (`total` vs page contents) measurable instead of assumed.
 *
 * Four things are pinned, because the fix is one term in a shared array:
 *   1. tombstones leave the page, the `total`, and the top of the sort order;
 *   2. the same happens for the two scoped shapes (`entityType`/`entityId`, which is what
 *      PR #2784 will make the deal Documents tab send, and `folderId`);
 *   3. the tenant term is still there — a tombstone filter that replaced it would be worse;
 *   4. `documentFolders` deliberately does **not** gain the term. Nothing in the repo deletes
 *      a folder (`grep -rn "delete(documentFolders)\\|update(documentFolders)" app/ lib/` →
 *      no match), so there is no tombstone to exclude and adding it would be speculative.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NextResponse } from 'next/server';
import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const DEAL = '33333333-3333-4333-8333-333333333333';
const FOLDER = '44444444-4444-4444-8444-444444444444';

const dialect = new PgDialect({} as never);

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  docs: [] as Record<string, unknown>[],
  folders: [] as Record<string, unknown>[],
  queries: [] as { table: string; sql: string; params: unknown[]; order: string | null; limit: number | null; offset: number | null; count: boolean }[],
}));

/** Render a Drizzle predicate the way Postgres will see it. */
function renderWhere(where: unknown) {
  const q = dialect.sqlToQuery(where as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/** Strip one layer of balanced parentheses. */
function unwrap(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return trimmed;
  const inner = trimmed.slice(1, -1);
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') { depth--; if (depth < 0) return trimmed; }
  }
  return depth === 0 ? inner : trimmed;
}

type ColumnRef = { table: string; column: string };

function matchTerm(term: string, re: RegExp): (RegExpMatchArray & ColumnRef[]) | null {
  const m = term.match(re);
  if (!m) return null;
  Object.defineProperty(m, 'table', { value: m[1] });
  Object.defineProperty(m, 'column', { value: m[2] });
  return m as RegExpMatchArray & ColumnRef[];
}

/**
 * Compile the rendered `("documents"."tenant_id" = $1 and "documents"."deleted_at" is null …)`
 * into a row predicate. Each term is read from the SQL the route actually emitted, so a
 * dropped term admits rows instead of failing a string comparison; a term this fake does not
 * implement throws rather than silently passing.
 */
function compile(whereSql: string, params: unknown[]): (row: Row) => boolean {
  const terms = splitTopLevel(unwrap(whereSql), /\s+and\s+/i);
  let paramIndex = 0;
  const checks = terms.map((rawTerm) => {
    const term = rawTerm.trim();
    const nullTerm = matchTerm(term, /^"([a-z_]+)"\."([a-z_]+)" is null$/i);
    if (nullTerm) return (row: Row) => row[nullTerm.column] === null || row[nullTerm.column] === undefined;
    const eqTerm = matchTerm(term, /^"([a-z_]+)"\."([a-z_]+)" = \$\d+$/i);
    if (eqTerm) {
      const value = params[paramIndex++];
      return (row: Row) => row[eqTerm.column] === value;
    }
    const inTerm = term.match(/^"([a-z_]+)"\."([a-z_]+)" in \(([^)]*)\)$/i);
    if (inTerm) {
      const values = params.slice(paramIndex, paramIndex + inTerm[3].split(',').length);
      paramIndex += inTerm[3].split(',').length;
      return (row: Row) => values.includes(row[inTerm[2]] ?? null);
    }
    throw new Error(`the fake cannot evaluate this term: ${term}`);
  });
  return (row: Row) => checks.every((check) => check(row));
}

function splitTopLevel(text: string, sep: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0; let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0) {
      const m = sep.exec(text.slice(i));
      // The separator has to start exactly here, not somewhere further ahead.
      if (m && m.index === 0) { parts.push(cur); cur = ''; i += m[0].length - 1; continue; }
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.filter((p) => p.trim().length > 0);
}

function fakeTable(table: unknown): string {
  return getTableName(table as never);
}

/** Awaitable query builder: resolves by evaluating the captured predicate. */
function makeQuery(count: boolean) {
  const record: typeof h.queries[number] = {
    table: '', sql: '', params: [], order: null, limit: null, offset: null, count,
  };
  h.queries.push(record);
  const builder: Record<string, unknown> = {
    from(table: unknown) { record.table = fakeTable(table); return builder; },
    where(predicate: unknown) {
      const r = renderWhere(predicate);
      record.sql = r.sql;
      record.params = r.params;
      return builder;
    },
    orderBy(...terms: unknown[]) {
      record.order = terms.map((t) => dialect.sqlToQuery(t as never).sql).join(', ');
      return builder;
    },
    limit(n: number) { record.limit = n; return builder; },
    offset(n: number) { record.offset = n; return builder; },
    async then(resolve: (rows: unknown[]) => void) {
      const source = record.table === 'documents' ? h.docs : h.folders;
      const predicate = compile(record.sql, record.params);
      let rows = source.filter(predicate);
      if (record.order) rows = sortRows(rows, record.order);
      if (record.offset !== null) rows = rows.slice(record.offset);
      if (record.limit !== null) rows = rows.slice(0, record.limit);
      resolve(record.count ? [{ total: rows.length }] : rows.map((row) => ({ ...row })));
    },
  };
  return builder;
}

/** The only order this route uses: `"documents"."created_at" desc`. */
function sortRows(rows: Row[], order: string): Row[] {
  const dir = order.match(/\b(desc|asc)\b/i)?.[1];
  const column = order.match(/"[a-z_]+"\.("?)([a-z_]+)\1/i)?.[2];
  if (!dir || !column) throw new Error(`the fake cannot evaluate this order: ${order}`);
  const sorted = [...rows].sort((a, b) => {
    const av = a[column] as number; const bv = b[column] as number;
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  return dir.toLowerCase() === 'desc' ? sorted.reverse() : sorted;
}

vi.mock('@/lib/api/with-api-route', () => ({ withApiRoute: (fn: unknown) => fn }));
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'u1', tenantId: TENANT, role: 'admin', isSuperAdmin: false })),
  requirePerm: vi.fn(() => null),
  can: vi.fn(() => true),
}));
vi.mock('@/lib/modules/gate', () => ({ requireModule: vi.fn(async () => null) }));
vi.mock('@/lib/usage/middleware', () => ({ checkLimit: vi.fn(async () => null) }));
vi.mock('@/lib/api/mutating-rate-limit', () => ({ rateLimitMutating: vi.fn(async () => null) }));
vi.mock('@/lib/api/validate', () => ({ readJsonBody: vi.fn(async () => ({})), validateBody: (_s: unknown, b: unknown) => ({ data: b }) }));
vi.mock('@/lib/storage/s3', () => ({ getSignedPutUrl: vi.fn(async () => 'https://example.invalid/put') }));
vi.mock('@/lib/storage/s3-config', () => ({ getS3Config: vi.fn(() => null) }));
vi.mock('@/lib/api-error', () => ({ apiError: (err: unknown) => NextResponse.json({ error: String(err) }, { status: 500 }) }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(async () => undefined) }));
vi.mock('@/drizzle/db', () => ({
  db: {
    select: (proj?: Record<string, unknown>) => makeQuery(Boolean(proj && 'total' in proj)),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async () => [] }),
  },
}));

import { GET } from '@/app/api/tenant/documents/route';

const ROUTE = fileURLToPath(new URL('../../app/api/tenant/documents/route.ts', import.meta.url));
const BY_ID_ROUTE = fileURLToPath(new URL('../../app/api/tenant/documents/[id]/route.ts', import.meta.url));
const ESIGN = fileURLToPath(new URL('../../lib/esignature-internal.ts', import.meta.url));

function doc(id: string, over: Partial<Row> = {}): Row {
  return {
    id, tenant_id: TENANT, name: `${id}.pdf`, entity_type: null, entity_id: null,
    folder_id: null, deleted_at: null, created_at: 1, ...over,
  };
}

async function list(search = ''): Promise<{ body: Record<string, unknown>; status: number }> {
  const res = await GET({ url: `http://localhost/api/tenant/documents${search}` } as never);
  return { body: await res.json() as Record<string, unknown>, status: res.status };
}

beforeEach(() => {
  h.queries.length = 0;
  h.docs = [
    doc('live-1', { created_at: 2 }),
    // The tombstone is the newest row, so pre-fix it also sat at the top of the page.
    doc('gone-1', { deleted_at: new Date('2026-10-01T00:00:00Z'), created_at: 9 }),
    doc('live-2', { created_at: 5, entity_type: 'deal', entity_id: DEAL }),
    doc('gone-2', { created_at: 8, entity_type: 'deal', entity_id: DEAL, deleted_at: new Date('2026-10-02T00:00:00Z') }),
    doc('live-3', { created_at: 6, folder_id: FOLDER }),
    doc('gone-3', { created_at: 7, folder_id: FOLDER, deleted_at: new Date('2026-10-03T00:00:00Z') }),
    doc('other-live', { tenant_id: OTHER_TENANT, created_at: 4 }),
    doc('other-gone', { tenant_id: OTHER_TENANT, created_at: 10, deleted_at: new Date('2026-10-04T00:00:00Z') }),
  ];
  h.folders = [
    { id: FOLDER, tenant_id: TENANT, parent_id: null, name: 'Deals', created_at: 3 },
    { id: 'folder-other', tenant_id: OTHER_TENANT, parent_id: null, name: 'Not mine', created_at: 3 },
  ];
});

describe('GET /api/tenant/documents — soft-deleted documents are not documents (#2785)', () => {
  // The unscoped list is also the shape the deal Documents tab hits **today**: the panel
  // sends `linked_entity_type`/`linked_entity_id` (`components/documents/documents-panel.tsx:56-57`),
  // which this route never reads, so every panel row falls through to the no-filter branch —
  // and that branch still excludes folder contents (`route.ts:76-80`: `folder_id IS NULL` when
  // no `entityType` was given). #2782 / PR #2784 switch the panel to `entityType`/`entityId`;
  // either way the rows come from this list, which is why the tombstone belongs here.
  it('leaves tombstones out of the page', async () => {
    const { body } = await list();
    const ids = (body.data as { documents: Row[] }).documents.map((d) => d.id);
    expect(ids).toEqual(['live-2', 'live-1']);
    expect(ids).not.toContain('gone-1');
    expect(ids).not.toContain('gone-2');
    expect(ids).not.toContain('gone-3');
  });

  it('leaves them out of `total` too, because the count shares the filter', async () => {
    const { body } = await list();
    expect(body.total).toBe(2);
    expect(body.total).toBe((body.data as { documents: Row[] }).documents.length);
  });

  it('does not let a deleted upload keep the top of the sort order', async () => {
    const { body } = await list();
    const docs = (body.data as { documents: Row[] }).documents;
    expect(docs[0].id).toBe('live-2');
    expect(docs.map((d) => d.created_at)).toEqual([5, 2]);
  });

  it('keeps the tenant term — the tombstone is added to it, not swapped for it', async () => {
    const { body } = await list();
    const ids = (body.data as { documents: Row[] }).documents.map((d) => d.id);
    expect(ids).not.toContain('other-live');
    const pageQuery = h.queries.find((q) => q.table === 'documents' && !q.count);
    expect(pageQuery!.params).toContain(TENANT);
    expect(pageQuery!.sql).toMatch(/"documents"\."tenant_id" = \$1/i);
  });

  it('applies to the deal-scoped shape the Documents tab sends', async () => {
    const { body } = await list(`?entityType=deal&entityId=${DEAL}`);
    const ids = (body.data as { documents: Row[] }).documents.map((d) => d.id);
    expect(ids).toEqual(['live-2']);
    expect(body.total).toBe(1);
  });

  it('and to the folder-scoped shape', async () => {
    const { body } = await list(`?folderId=${FOLDER}`);
    const ids = (body.data as { documents: Row[] }).documents.map((d) => d.id);
    expect(ids).toEqual(['live-3']);
    expect(body.total).toBe(1);
  });

  it('still lists folders it has never deleted, without borrowing the term', async () => {
    const { body } = await list();
    const folders = (body.data as { folders: Row[] }).folders;
    expect(folders.map((f) => f.id)).toEqual([FOLDER]);
    const folderQuery = h.queries.find((q) => q.table === 'document_folders');
    expect(folderQuery!.sql).not.toMatch(/deleted_at/i);
  });

  it('renders one predicate for the count and the page, so they cannot drift', async () => {
    await list();
    const countQuery = h.queries.find((q) => q.table === 'documents' && q.count);
    const pageQuery = h.queries.find((q) => q.table === 'documents' && !q.count);
    expect(countQuery).toBeDefined();
    expect(pageQuery).toBeDefined();
    expect(countQuery!.sql).toBe(pageQuery!.sql);
    expect(countQuery!.params).toEqual(pageQuery!.params);
  });
});

describe('the tombstone rule is stated once per reader, not assumed', () => {
  it('this route filters deleted documents in the list it builds', () => {
    const src = readFileSync(ROUTE, 'utf8');
    expect(src).toMatch(/const filters: SQL\[\] = \[[^\n]*isNull\(documents\.deletedAt\)/);
  });

  it('and the three readers that already did are untouched, so nobody “fixes” them by mistake', () => {
    const byId = readFileSync(BY_ID_ROUTE, 'utf8');
    expect(byId.match(/isNull\(documents\.deletedAt\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(readFileSync(ESIGN, 'utf8')).toContain('isNull(documents.deletedAt)');
  });

  it('the DELETE in this file is a tombstone, which is the whole premise', () => {
    const src = readFileSync(ROUTE, 'utf8');
    expect(src).toMatch(/deletedAt: new Date\(\)/);
    expect(src).not.toMatch(/db\.delete\(documents\)/);
  });
});
