/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { or, eq, sql, type Column, type SQL } from 'drizzle-orm';
import { can, type AuthContext } from '@/lib/auth/middleware';

/**
 * The owner narrowing that `deals`, `contacts` and `tasks` already apply
 * everywhere else, in one place.
 *
 * Each of those three entities answers 404 — and the list hides the row — when the
 * caller lacks `<entity>.view_all` and is neither `assigned_to` nor `created_by`
 * (`deals/[id]/route.ts:66-71,159-164,310-317`, `contacts/[id]/route.ts:82-87,
 * 195-200,304-311`, `tasks/[id]/route.ts:55-59,100-105,197+`, and the
 * `or(assigned_to, created_by)` in each list route). Their bulk routes scoped the id
 * set they write by tenant and tombstone only, so a request naming several ids —
 * "select all matching", or `deal_ids` the validation cannot tell apart from one —
 * reached rows the single-record rules refuse: #2671, #2673, #2674.
 *
 * `undefined` for a caller who holds `view_all`, because drizzle's `and()` skips
 * undefined arguments and rejects `null`: the caller's predicate list then reads the
 * same whether or not the scope is there, and cannot accidentally become
 * `and(<nothing>)`, which drizzle renders as no WHERE clause at all.
 */
export function ownerScope(
  ctx: AuthContext,
  permission: string,
  columns: { assignedTo: Column; createdBy: Column },
): SQL | undefined {
  if (can(ctx, permission)) return undefined;
  return or(eq(columns.assignedTo, ctx.userId), eq(columns.createdBy, ctx.userId))!;
}

/**
 * `ownerScope` for the routes that build their own SQL against an aliased
 * relation — `data-explorer` (#2704), on all three verbs.
 *
 * `ownerScope` renders the columns through drizzle, which qualifies them with the
 * table's own name (`"contacts"."assigned_to"`). Postgres rejects that in
 * `FROM contacts c`, so the alias has to come from the caller. Every caller passes
 * a literal: the columns are the same `assigned_to` / `created_by` pair on all five
 * CRM entities, so only the alias varies, and `sql.identifier` quotes it rather
 * than splicing caller text.
 */
export function ownerScopeAlias(
  ctx: AuthContext,
  permission: string,
  alias: string,
): SQL | undefined {
  if (can(ctx, permission)) return undefined;
  const a = sql.identifier(alias);
  return or(sql`${a}.assigned_to = ${ctx.userId}`, sql`${a}.created_by = ${ctx.userId}`)!;
}

/**
 * The cache key half of the same rule (#2688).
 *
 * `lib/dashboard/widget-cache.ts` keyed its entries by tenant and widget only,
 * so whatever the first caller of a TTL window computed was served to every
 * other caller of that tenant for up to 300s. A per-caller predicate cannot go
 * into those queries until the key carries the caller: `ownerCacheKey` returns
 * 'tenant' for a `view_all` holder — whose read is genuinely tenant-wide, so
 * managers keep sharing one entry — and the user id for everyone else, whose
 * read is their own rows.
 */
export function ownerCacheKey(ctx: AuthContext, permission: string): string {
  return can(ctx, permission) ? 'tenant' : ctx.userId;
}

/**
 * `ownerScope` as raw SQL, for the dashboard widgets that read through
 * `db.execute(sql`...`)` instead of a query builder. `and()` skips an undefined
 * argument; a template has nothing to skip, so this returns the empty fragment
 * for a `view_all` holder and the predicate prefixed with AND otherwise — the
 * caller splices it in after its own WHERE terms.
 */
export function ownerScopeSql(scope: SQL | undefined): SQL {
  // The leading space is load-bearing: the templates splice this straight after
  // their last term, and `falseAND (` is not SQL.
  return scope ? sql` AND ${scope}` : sql``;
}
