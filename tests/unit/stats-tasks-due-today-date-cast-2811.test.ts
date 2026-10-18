/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2811 — the tasks stats widget asked Postgres to compare an instant with a day.
 *
 * `tasks.due_date` is a `timestamp with time zone` (`drizzle/schema/tasks.ts:22`,
 * `drizzle/migrations/0000_init.sql:1846`), and the widget wrote
 * `due_date = ${today}::date` with `today` a `YYYY-MM-DD` string cut out of
 * `new Date().toISOString()`. Postgres does not demote the column to a date for that
 * comparison — it promotes the `date` UP to a `timestamptz`, i.e. to midnight of that
 * day, so the predicate is true only for rows stored at exactly local midnight. A task
 * due at 09:00 or 23:30 today satisfies neither `due_today` (`= midnight`) nor
 * `overdue` (`< midnight`): it vanishes from both tiles while sitting in `total_open`.
 * Measured on a throwaway cluster over five seeded open tasks: `due_today` returned 1
 * as written and 3 with the column cast, the missing rows being the 09:00 and 23:30
 * ones — `'2026-10-18 09:00+00'::timestamptz = '2026-10-18'::date` is false where the
 * midnight row's is true, so this is Postgres' operator resolution, not a quirk. The
 * same file's `<` predicate has the same shape, and it is the one that decides whether
 * a task is overdue.
 *
 * The remedy is the house idiom, already used two routes over
 * (`app/api/tenant/dashboard/widgets/follow-ups/route.ts:35-36`, and the same column
 * cast in `app/api/cron/task-reminders/route.ts:72`): cast the COLUMN and let the
 * database name the day — `due_date::date = CURRENT_DATE`. That also leaves the query
 * one clock instead of two. The old form measured the day twice over: `toISOString()`
 * names UTC's date, while the `::date` it was bound into is promoted to midnight in
 * the database session's own zone — and the cast on the column now reads both sides in
 * that same zone. Which zone that is stays a deployment choice, exactly as it already
 * is for the follow-ups widget; what the tiles no longer do is disagree with the row
 * they are counting.
 *
 * What is pinned, in the order the fix could break each of them:
 *   1. both day predicates cast the column and compare to `CURRENT_DATE`, and no
 *      date-shaped value is bound as a parameter — the failure mode is a JS string
 *      creeping back in, which is what made the comparison wrong in the first place;
 *   2. `due_today` and `overdue` partition the calendar rather than overlap it, and
 *      neither one degenerates back to a bare `due_date` comparison;
 *   3. a task with no due date is still counted nowhere but `total_open` — the fix is
 *      a cast, not a default, so it must not coalesce the column into today;
 *   4. the three terms the widget is NOT changing still hold the read — the tenant
 *      bound, the tombstone, `status != 'completed'` — plus, for a rep without
 *      `tasks.view_all`, the owner scope of #2688, spliced as text because a raw
 *      template has nothing that can skip an `undefined` argument;
 *   5. the counts still reach the response as numbers, and the same shape the
 *      follow-ups widget uses is what this file now uses, so the next editor of one
 *      sees the other.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthContext } from '@/lib/auth/middleware';

const TENANT = '11111111-1111-4111-8111-111111111111';
const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const ROUTE = fileURLToPath(new URL(
  '../../app/api/tenant/dashboard/widgets/stats/tasks/route.ts', import.meta.url));
const SIBLING = fileURLToPath(new URL(
  '../../app/api/tenant/dashboard/widgets/follow-ups/route.ts', import.meta.url));

const dialect = new PgDialect({} as never);

const h = vi.hoisted(() => ({ raw: [] as { sql: string; params: unknown[] }[] }));
const mockDb = { execute: vi.fn() };

vi.mock('@/drizzle/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  // `can()` is the scoping rule, not the day math, so only `requireAuth` is faked.
  return { ...actual, requireAuth: vi.fn() };
});
vi.mock('@/lib/errors-server', () => ({ logError: vi.fn(), tenantMeta: () => ({}) }));
vi.mock('@/lib/api/with-api-route', () => ({
  withApiRoute: <C>(fn: (request: NextRequest, context: C) => unknown) => fn,
}));
vi.mock('@/lib/dashboard/widget-cache', () => ({
  withCache: (_t: string, _k: string, _ttl: number, fetcher: () => Promise<Response>) => fetcher(),
}));

const { requireAuth } = await import('@/lib/auth/middleware');
const { GET } = await import('@/app/api/tenant/dashboard/widgets/stats/tasks/route');

const REP = { 'tasks.view': true };
const MANAGER = { 'tasks.view': true, 'tasks.view_all': true };

function ctxWith(permissions: Record<string, boolean>): AuthContext {
  return {
    userId: MINE, tenantId: TENANT, roleSlug: 'rep', permissions,
    isAdmin: false, isSuperAdmin: false,
  } as unknown as AuthContext;
}

async function get(permissions: Record<string, boolean>) {
  (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(ctxWith(permissions));
  return GET(new NextRequest(new URL('/api/tenant/dashboard/widgets/stats/tasks', 'http://localhost:3000'), {
    method: 'GET',
    headers: { 'x-forwarded-for': '127.0.0.1' },
  }));
}

/** The one `db.execute` this route makes, as Postgres would receive it. */
function query(): { sql: string; params: unknown[] } {
  expect(h.raw).toHaveLength(1);
  return h.raw[0];
}

/** A tile's predicate as Postgres receives it: the column, its cast, and the day. */
function predicateFor(alias: string): string {
  // No `s` flag on purpose: each tile's predicate lives on its own line, so the
  // non-greedy span cannot run from `due_today`'s column into `overdue`'s.
  const m = query().sql.match(new RegExp(`(due_date.*?)\\) AS ${alias}\\b`));
  expect(m, `no due_date predicate rendered for ${alias}: ${query().sql}`).toBeTruthy();
  return m![1];
}

beforeEach(() => {
  vi.resetModules();
  h.raw = [];
  mockDb.execute.mockImplementation((fragment: unknown) => {
    h.raw.push(dialect.sqlToQuery(fragment as never));
    return Promise.resolve({ rows: [{ due_today: 3, overdue: 2, total_open: 10 }] });
  });
});

describe('the tasks stats widget compares the due date as the day it is (#2811)', () => {
  it('casts the column for due_today instead of promoting a bound date to midnight', async () => {
    await get(MANAGER);
    expect(predicateFor('due_today')).toBe('due_date::date = CURRENT_DATE');
  });

  it('casts the column for overdue too, which is the predicate that says a task is late', async () => {
    await get(MANAGER);
    expect(predicateFor('overdue')).toBe('due_date::date < CURRENT_DATE');
  });

  it('binds no calendar value at all, so the query has one clock left', async () => {
    const res = await get(MANAGER);
    const params = query().params;
    expect(params.filter(p => typeof p === 'string' && DATE_SHAPE.test(p))).toEqual([]);
    // Only the tenant and (below) the owner: a day string is not among them.
    expect(new Set(params.filter(p => p !== TENANT && p !== MINE))).toEqual(new Set());
    expect(res.status).toBe(200);
  });

  it('names no JS date in the file any more, in this route or in the day math', () => {
    // The defect was `const today = new Date().toISOString().split('T')[0]` spliced in
    // as a parameter; the predicate is the only place a day can now come from.
    const src = readFileSync(ROUTE, 'utf8');
    expect(src).not.toMatch(/toISOString|new Date\(/);
    expect(src).toMatch(/due_date::date = CURRENT_DATE/);
    expect(src).toMatch(/due_date::date < CURRENT_DATE/);
  });

  it('keeps the two tiles a partition rather than an overlap', async () => {
    await get(MANAGER);
    const due = predicateFor('due_today');
    const over = predicateFor('overdue');
    // `=` vs `<` on the same cast day: nothing can match both, nothing on the day
    // matches neither.
    expect(due).toMatch(/^due_date::date = /);
    expect(over).toMatch(/^due_date::date < /);
    // Neither one slipped back to the bare column, whose type is the whole problem.
    for (const p of [due, over]) {
      expect(p).not.toMatch(/^due_date (=|<) /);
    }
  });

  it('leaves an undated task out of both day tiles, as it already was', async () => {
    // `due_date` is nullable (`drizzle/schema/tasks.ts:22`), so this is not
    // hypothetical: `NULL::date = CURRENT_DATE` is NULL, and the row stays in
    // `total_open` only. Measured on the throwaway cluster over a NULL row and a
    // 09:00 row — due_today 1, overdue 0, total_open 2, neither tile claiming the
    // undated task. The fix is the cast, not a default, so nothing here COALESCEs
    // the column into today and no tile gains a row the list cannot show.
    await get(MANAGER);
    const { sql } = query();
    expect(predicateFor('due_today')).not.toMatch(/coalesce/i);
    expect(predicateFor('overdue')).not.toMatch(/coalesce/i);
    expect(sql.match(/due_date/g)).toHaveLength(2);
    expect(sql).toMatch(/status != 'completed'\) AS total_open/);
  });

  it('leaves the terms the fix is not about doing their job', async () => {
    await get(MANAGER);
    const { sql, params } = query();
    // One tenant bound per tile — three subselects, one statement.
    expect(params.filter(p => p === TENANT)).toHaveLength(3);
    expect(sql).toContain('tenant_id = $1');
    expect(sql.match(/deleted_at IS NULL/g)).toHaveLength(3);
    expect(sql.match(/status != 'completed'/g)).toHaveLength(3);
    expect(sql).toContain('(SELECT COUNT(*)::int FROM "tasks"');
  });

  it("still narrows to the caller's own tasks when there is no tasks.view_all (#2688)", async () => {
    // The scope is spliced as text into a raw template, so a day-math edit that
    // re-ordered the fragment would silently widen the tile back to the tenant.
    await get(REP);
    const { sql, params } = query();
    expect(sql).toContain('"tasks"."assigned_to"');
    expect(sql).toContain('"tasks"."created_by"');
    // assigned_to OR created_by, in each of the three tiles.
    expect(params.filter(p => p === MINE)).toHaveLength(6);
    expect(params.filter(p => p === TENANT)).toHaveLength(3);
    expect(predicateFor('due_today')).toBe('due_date::date = CURRENT_DATE');
  });

  it('stays tenant-wide for a view_all holder, day math included', async () => {
    await get(MANAGER);
    expect(query().sql).not.toMatch(/"created_by"/);
    expect(predicateFor('due_today')).toBe('due_date::date = CURRENT_DATE');
  });

  it('still answers the three tiles as numbers', async () => {
    const res = await get(MANAGER);
    expect(await res.json()).toEqual({
      data: { dueToday: 3, overdue: 2, totalOpen: 10 },
    });
  });

  it('matches the sibling widget that already got this right', () => {
    // follow-ups has counted `due_date::date = CURRENT_DATE` all along; the two tiles
    // that disagree about a day are the bug a user sees, so the shapes stay together.
    const sibling = readFileSync(SIBLING, 'utf8');
    expect(sibling).toMatch(/due_date::date = CURRENT_DATE/);
    expect(sibling).toMatch(/due_date::date < CURRENT_DATE/);
  });
});
