/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- #2343 — make (tenant_id, lead_oid) a UNIQUE index.
--
-- lib/leads/oid.ts claimed the unique index would catch collisions at insert
-- time, but idx_leads_tenant_oid was created with index(), not uniqueIndex():
-- duplicate human-facing lead labels (LD-2026-003 ×2) were written silently,
-- and the COUNT(*)+1 allocation (live rows only) deterministically reissued a
-- trashed lead's label on the very next create. Allocation is now MAX-based
-- over ALL rows under a tenant-row FOR UPDATE lock; this migration removes
-- the silent-duplicate hole so a residual race fails loudly (23505) and the
-- caller retries.
--
-- Order of operations (same transaction):
--   1. Dedupe: for each colliding (tenant_id, lead_oid) group keep the
--      earliest-created row and re-assign the losers to fresh numbers above
--      the tenant-year's current MAX — i.e. exactly what the new allocator
--      would have handed out, one per loser. Expected to be a no-op on live
--      data (measured 2026-10-04: lead_oid_dup_groups = 0) but written, not
--      assumed — CREATE UNIQUE INDEX would otherwise abort the whole run.
--   2. Drop the plain index and recreate it as UNIQUE. NULL lead_oid (legacy
--      leads without an OID) stays distinct under Postgres unique semantics.
WITH "ranked" AS (
  SELECT "id", "tenant_id", "lead_oid",
         row_number() OVER (PARTITION BY "tenant_id", "lead_oid" ORDER BY "created_at", "id") AS "rn",
         count(*)     OVER (PARTITION BY "tenant_id", "lead_oid") AS "cnt"
  FROM "leads"
  WHERE "lead_oid" IS NOT NULL
),
"losers" AS (
  SELECT "id", "tenant_id",
         substring("lead_oid" FROM 4 FOR 4) AS "yr",
         row_number() OVER (
           PARTITION BY "tenant_id", substring("lead_oid" FROM 4 FOR 4)
           ORDER BY "id"
         ) AS "seq"
  FROM "ranked"
  WHERE "cnt" > 1 AND "rn" > 1
),
"reassigned" AS (
  SELECT l."id",
         'LD-' || l."yr" || '-' ||
           lpad((COALESCE(mx."maxn", 0) + l."seq")::text, 3, '0') AS "new_oid"
  FROM "losers" l
  LEFT JOIN LATERAL (
    SELECT max(CASE WHEN m."lead_oid" ~ ('^LD-' || l."yr" || '-[0-9]+$')
                    THEN CAST(substring(m."lead_oid" FROM 9) AS integer)
                    ELSE 0 END) AS "maxn"
    FROM "leads" m
    WHERE m."tenant_id" = l."tenant_id"
  ) mx ON TRUE
)
UPDATE "leads" t
SET "lead_oid" = r."new_oid"
FROM "reassigned" r
WHERE t."id" = r."id" AND t."lead_oid" IS DISTINCT FROM r."new_oid";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_leads_tenant_oid";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_leads_tenant_oid" ON "leads" ("tenant_id", "lead_oid");
