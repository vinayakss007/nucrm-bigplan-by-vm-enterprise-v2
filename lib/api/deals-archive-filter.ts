/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { sql, type SQL } from 'drizzle-orm';
import { deals } from '@/drizzle/schema';

/**
 * Archive visibility for deal queries.
 *
 * Deals have no `is_archived` column (contacts do). Archiving a deal instead
 * sets `metadata.archived = true` — see the `archive` action in
 * app/api/tenant/deals/bulk/route.ts. That write existed with no corresponding
 * read, so archiving a deal had no observable effect: it stayed in every list,
 * and `unarchive` was equally invisible.
 *
 * COALESCE matters: `metadata->>'archived'` is NULL for every deal created
 * before archiving existed, and `NULL <> 'true'` is NULL, not true — so a plain
 * comparison would filter out every historical deal.
 */
export type ArchivedVisibility = 'true' | 'false' | 'all' | undefined;

/** Only archived deals. */
export function archivedOnly(): SQL {
  return sql`COALESCE(${deals.metadata}->>'archived', 'false') = 'true'`;
}

/** Only live (non-archived) deals. */
export function notArchived(): SQL {
  return sql`COALESCE(${deals.metadata}->>'archived', 'false') <> 'true'`;
}

/**
 * The predicate for a given `archived` query param, or null for 'all' (no
 * predicate — caller adds nothing).
 */
export function archiveFilter(visibility: ArchivedVisibility): SQL | null {
  if (visibility === 'all') return null;
  if (visibility === 'true') return archivedOnly();
  return notArchived();
}
