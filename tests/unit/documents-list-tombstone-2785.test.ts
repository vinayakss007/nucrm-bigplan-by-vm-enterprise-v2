/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2785 — `GET /api/tenant/documents` never asks whether a document is
 * soft-deleted, while the `DELETE` in the same file is one.
 *
 * The filter list was `[eq(documents.tenantId, ctx.tenantId)]` and the
 * `entityType` / `entityId` / `folderId` terms the query params add were the
 * only other ones, so the `count(*)` and the page both read tombstones. Then
 * `app/api/tenant/documents/route.ts` DELETE soft-deletes the row instead of
 * removing it, and the reader that serves the click —
 * `app/api/tenant/documents/[id]/route.ts:40` — does filter, so the file the
 * list is still showing 404s when opened. `lib/esignature-internal.ts:98`
 * filters too, and says why in its comment.
 * `drizzle/schema/documents.ts:54` ships `idx_documents_active`, a partial
 * index on `deleted_at IS NULL`: the schema already knows this is the read.
 *
 * Why the reader and not the writer: `app/api/tenant/documents/[id]/route.ts:97`
 * keeps the tombstoned row precisely so an S3 orphan sweep can find the key from
 * it, and `drizzle/schema/esignature.ts:14` points signing requests at
 * `documents.id` — a hard delete in `GET`'s counterpart would take that history
 * with it. Worse, `purge_trash()` (the STEP 4 sweep in
 * `app/api/cron/cleanup/route.ts`) only deletes from contacts, deals, companies,
 * tasks and leads: nothing ever removes a document tombstone, so the list would
 * show the deleted file permanently, not until the next sweep.
 *
 * Why not `documentFolders` as well: the table does have `deleted_at` (via
 * `drizzle/schema/utils.ts:68`), but no writer anywhere in `app/` or `lib/`
 * tombstones a folder — `grep -rn "delete(documentFolders)
 * \|update(documentFolders)"` is empty — so filtering there would be
 * speculative. That is what the last assertion pins.
 *
 * The fake reader renders the route's predicate through drizzle's own dialect
 * and applies it to seeded rows, so "the deleted file is still listed" is
 * observed rather than asserted against a canned return — a stub that hands
 * back whatever it is told would pass this with no filter at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import { documents, documentFolders } from '@/drizzle/schema/documents';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const DEAL = '33333333-3333-4333-8333-333333333333';
const dialect = new PgDialect({} as never);

const LIVE = {
  id: '44444444-4444-4444-8444-444444444444',
  tenantId: TENANT, name: 'proposal.pdf', mimeType: 'application/pdf',
  sizeBytes: 4096, folderId: null, entityType: 'deal', entityId: DEAL,
  deletedAt: null, createdAt: '2026-10-01T10:00:00.000Z',
};
const GONE = {
  id: '55555555-5555-4555-8555-555555555555',
  tenantId: TENANT, name: 'superseded-draft.pdf', mimeType: 'application/pdf',
  sizeBytes: 8192, folderId: null, entityType: 'deal', entityId: DEAL,
  deletedAt: '2026-10-05T10:00:00.000Z', createdAt: '2026-10-04T10:00:00.000Z',
};
const ELSEWHERE = {
  id: '66666666-6666-4666-8666-666666666666',
  tenantId: OTHER_TENANT, name: 'other-tenant.pdf', mimeType: 'application/pdf',
  sizeBytes: 1, folderId: null, entityType: 'deal', entityId: DEAL,
  deletedAt: null, createdAt: '2026-10-02T10:00:00.000Z',
};
const FOLDER = {
  id: '99999999-9999-4999-8999-999999999999',
  tenantId: TENANT, name: 'Contracts', parentId: null,
  createdAt: '2026-10-01T10:00:00.000Z',
};

let rows: Record<string, unknown>[] = [];
let folders: Record<string, unknown>[] = [];
let queries: { table: string; sql: string; params: unknown[] }[] = [];

/** `"documents"."deleted_at"` -> `deletedAt`, the key a drizzle row carries. */
const keyOf = (col: string) => col.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Split on the operator only where it sits outside every parenthesis. */
function splitTop(s: string, op: string): string[] | null {
  const parts: string[] = [];
  let depth = 0, cur = '', i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    if (ch === '(') { depth++; cur += ch; i += 1; continue; }
    if (ch === ')') { depth--; cur += ch; i += 1; continue; }
    // PgDialect renders the connectives in lower case (`… = $1 and … is null`),
    // so the split has to be case-insensitive.
    if (depth === 0 && s.slice(i, i + op.length).toLowerCase() === op.toLowerCase()) {
      parts.push(cur); cur = ''; i += op.length; continue;
    }
    cur += ch; i += 1;
  }
  parts.push(cur);
  return parts.length > 1 ? parts : null;
}

/**
 * Answer the rendered predicate the way Postgres would: split the top-level
 * `AND` / `OR` list and apply each leaf to the candidate rows.
 */
function compile(expr: string, params: unknown[]): (row: Record<string, unknown>) => boolean {
  let s = expr.trim();
  while (s.startsWith('(') && s.endsWith(')')) {
    let depth = 0, balanced = true;
    for (const ch of s.slice(1, -1)) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth < 0) { balanced = false; break; }
    }
    if (balanced && depth === 0) s = s.slice(1, -1).trim();
    else break;
  }
  for (const op of [' AND ', ' OR '] as const) {
    const parts = splitTop(s, op);
    if (parts) {
      const kids = parts.map((p) => compile(p, params));
      return op === ' AND ' ? (row) => kids.every((k) => k(row)) : (row) => kids.some((k) => k(row));
    }
  }
  const leaf = s.trim();
  let m = /^"[a-z_ ]+"\."([a-z_]+)" = \$(\d+)$/i.exec(leaf);
  if (m) { const want = params[Number(m[2]) - 1]; return (row) => row[keyOf(m![1])] === want; }
  m = /^"[a-z_ ]+"\."([a-z_]+)" is null$/i.exec(leaf);
  if (m) return (row) => row[keyOf(m![1])] === null || row[keyOf(m![1])] === undefined;
  m = /^"[a-z_ ]+"\."([a-z_]+)" is not null$/i.exec(leaf);
  if (m) return (row) => row[keyOf(m![1])] !== null && row[keyOf(m![1])] !== undefined;
  throw new Error(`unhandled predicate leaf: ${leaf}`);
}

function relationOf(table: unknown): string {
  // Drizzle gives the table object its SQL name; a column's `.id` is
  // `"documents"."deleted_at"`-shaped, so the relation is matched by identity
  // against the schema objects the route itself imports.
  if (table === documents) return 'documents';
  if (table === documentFolders) return 'document_folders';
  return String((table as { [key: string]: unknown })?.name ?? 'unknown');
}

function makeBuilder(table: string, columns: unknown) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'groupBy', 'offset', 'limit']) builder[m] = chain;
  let predicate: { sql: string; params: unknown[] } | undefined;
  builder['where'] = (expr: unknown) => {
    const q = dialect.sqlToQuery(expr as never);
    predicate = { sql: q.sql, params: q.params };
    queries.push({ table, ...predicate });
    return builder;
  };
  const answer = () => {
    const source = table === 'document_folders' ? folders : rows;
    const hits = predicate ? source.filter(compile(predicate.sql, predicate.params)) : source;
    // `route.ts:77-80` awaits the count straight off the where-builder.
    if (columns && 'total' in (columns as object)) return [{ total: hits.length }];
    return hits;
  };
  builder['then'] = (resolve: (v: unknown) => unknown) => resolve(answer());
  return builder;
}

const mockDb: Record<string, unknown> = {
  select: vi.fn((columns?: unknown) => {
    // The relation is read off `.from()`; the builder is created lazily so the
    // count branch can be told apart by its projection.
    return {
      from: (table: unknown) => {
        const builder = makeBuilder(relationOf(table), columns);
        builder.from = () => builder;
        return builder;
      },
    };
  }),
};

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/modules/gate', () => ({ requireModule: async () => null }));
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/with-api-route', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/with-api-route')>('@/lib/api/with-api-route');
  return { ...actual, withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn };
});

const { requireAuth } = await import('@/lib/auth/middleware');
const route = await import('@/app/api/tenant/documents/route');

function getReq(search: string) {
  return new NextRequest(new URL(`/api/tenant/documents${search}`, 'http://localhost:3000'), {
    headers: { 'x-forwarded-for': '127.0.0.1' },
  });
}

async function list(search = '') {
  queries = [];
  const res = await route.GET(getReq(search));
  return { status: res.status, body: await res.json() };
}

const docQueries = () => queries.filter((q) => q.table === 'documents');
const folderQueries = () => queries.filter((q) => q.table === 'document_folders');
const TOMBSTONE = /"documents"\."deleted_at" is null/i;

beforeEach(() => {
  rows = [LIVE, GONE, ELSEWHERE];
  folders = [FOLDER];
  queries = [];
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
    userId: '77777777-7777-4777-8777-777777777777',
    tenantId: TENANT, roleSlug: 'admin', permissions: { all: true },
    isAdmin: true, isSuperAdmin: false,
  });
});

describe('a soft-deleted document leaves the list (#2785)', () => {
  it('is not returned at the tenant root', async () => {
    const { body } = await list();
    expect(body.data.documents.map((d: { name: string }) => d.name)).toEqual(['proposal.pdf']);
  });

  it('is not returned through the entity filter the deal panel uses', async () => {
    const { body } = await list(`?entityType=deal&entityId=${DEAL}`);
    expect(body.data.documents.map((d: { name: string }) => d.name)).toEqual(['proposal.pdf']);
  });

  it('is not counted in total', async () => {
    const { body } = await list();
    expect(body.total, 'the count(*) still includes tombstones').toBe(1);
  });

  it('the count query carries the tombstone term, not only the page query', async () => {
    await list();
    expect(docQueries()).toHaveLength(2);
    for (const q of docQueries()) expect(q.sql, q.sql).toMatch(TOMBSTONE);
  });

  it('still refuses another tenant\'s rows', async () => {
    const { body } = await list();
    const names = body.data.documents.map((d: { name: string }) => d.name);
    expect(names).not.toContain('other-tenant.pdf');
    expect(docQueries()[0].params).toContain(TENANT);
    expect(docQueries()[0].params).not.toContain(OTHER_TENANT);
  });

  it('leaves the live rows alone', async () => {
    const { status, body } = await list();
    expect(status).toBe(200);
    expect(body.data.documents).toHaveLength(1);
    expect(body.data.documents[0].sizeBytes).toBe(4096);
  });

  it('does not mint a tombstone term on folders, which nothing ever deletes', async () => {
    const { body } = await list();
    expect(body.data.folders).toHaveLength(1);
    const [q] = folderQueries();
    expect(q, JSON.stringify(queries)).toBeTruthy();
    expect(q.sql).not.toMatch(/"document_folders"\."deleted_at" is null/i);
  });
});
