/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * The SQL half of the won-stage vocabulary (#3120).
 *
 * `lib/deals/won-stage.ts` has held the app's single definition of "which stage
 * is a win" since #658, but it is a plain JS predicate over a NAME, so the three
 * server routes that answer the question in SQL each wrote their own comparison
 * instead — `lower(name) = 'won'`, `lower(name) IN ('won','lost')` and
 * `name ILIKE '%won%'` — and all three disagree with #658 in a different
 * direction (renamed `Closed Won` tenants report 0; `Not Won` / `Unwon` report
 * as wins). Translating the qualifier + negation regexes into Postgres would
 * recreate the drift the next time someone edits the JS, so instead the routes
 * read a tenant's stage list here, classify it with `isWonStageName` /
 * `isLostStageName`, and compare the resulting IDS in SQL. One definition, one
 * round-trip per route. (#3120)
 *
 * Deliberately a sibling module and not more code in `won-stage.ts`: that file
 * is imported by client components (`app/tenant/deals/kanban/kanban-client.tsx`,
 * `app/tenant/analytics/analytics-client.tsx`), and nothing under the client
 * graph may pull in drizzle. Takes an executor like `resolveDealStage`
 * (`lib/deals/resolve-stage.ts:38,82`) so the route's pinned `db` — or a `tx` —
 * is what runs the query, and so the classification is unit-testable with no DB.
 */
import { and, eq } from 'drizzle-orm';
import { dealStages, pipelines } from '@/drizzle/schema';
import type { DbClient } from '@/drizzle/db';
import { isLostStageName, isWonStageName } from './won-stage';

/** Minimal executor shape shared by the pool `db` and a `tx` inside a transaction. */
export type StageIdResolver = Pick<DbClient, 'select'>;

export type DealStageIdSets = {
  /** Stages #658 calls a win — `Won`, `Closed Won`, `Deal Won`, … */
  won: string[];
  /** The mirror side: `Lost`, `Closed Lost`, … */
  lost: string[];
  /** `won ∪ lost` — the stages a deal may not still be sitting in. */
  terminal: string[];
};

/**
 * Classify one tenant's deal stages through the #658 matcher.
 *
 * The scoping is the one the dashboard sites already used — `deal_stages`
 * joined to `pipelines` on the tenant — because that is what the routes agreed
 * on; nothing here narrows or widens which rows a tenant owns, only which of
 * them count as won/lost. No `deleted_at` filter either, for the same reason:
 * #3120 is a vocabulary fix, and adding a tombstone predicate to a route that
 * never had one is a separate claim to make.
 */
export async function resolveDealStageIds(
  exec: StageIdResolver,
  tenantId: string,
): Promise<DealStageIdSets> {
  const rows = await exec
    .select({ id: dealStages.id, name: dealStages.name })
    .from(dealStages)
    .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
    .where(and(eq(pipelines.tenantId, tenantId)));

  const won: string[] = [];
  const lost: string[] = [];
  for (const row of rows) {
    if (isWonStageName(row.name)) won.push(row.id);
    else if (isLostStageName(row.name)) lost.push(row.id);
  }
  return { won, lost, terminal: [...won, ...lost] };
}

/**
 * The ids of the stages this tenant's pipeline treats as a win.
 *
 * Empty means the tenant has no winning stage at all — and the callers must
 * compare the ids with `inArray`, which drizzle renders as the literal `false`
 * for an empty list (verified against `PgDialect.sqlToQuery` on 0.45.4), so "no
 * won stage" answers "no won deals" instead of silently dropping the filter and
 * answering "every deal".
 */
export async function resolveWonStageIds(
  exec: StageIdResolver,
  tenantId: string,
): Promise<string[]> {
  return (await resolveDealStageIds(exec, tenantId)).won;
}

/** The ids of the stages that end a deal — won or lost. See the note above. */
export async function resolveTerminalStageIds(
  exec: StageIdResolver,
  tenantId: string,
): Promise<string[]> {
  return (await resolveDealStageIds(exec, tenantId)).terminal;
}
