/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { or, eq, type Column, type SQL } from 'drizzle-orm';
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
