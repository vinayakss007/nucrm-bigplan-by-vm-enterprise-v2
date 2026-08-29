-- 0081: fix snapshot_tenant_usage() so daily usage snapshots actually work
--
-- The original definition (migration 0032) INSERTed into columns that do not
-- exist on usage_snapshots — user_count, contact_count, deal_count,
-- storage_bytes, period_start, period_end — and used
-- ON CONFLICT (tenant_id, period_start), a constraint that does not exist
-- either. The real table (0000_init) has:
--   tenant_id, snapshot_date (text), contacts_count, leads_count, deals_count,
--   users_count, storage_used_mb (numeric), api_calls_count, email_sent_count.
--
-- Consequences of the mismatch:
--   * The hourly usage-snapshot cron threw on every run (error swallowed by the
--     route's catch), so usage_snapshots was NEVER populated.
--   * getCount('apiCallsDay') and getCount('storageGb') in lib/usage/tracker.ts
--     read today's snapshot row, found none, and always returned 0 — so the
--     plan's API-call and storage limits could never be reported or enforced.
--
-- This redefinition writes the correct columns and sources every value from
-- real data:
--   * contacts_count / leads_count / deals_count / users_count — live COUNTs
--     over the tenant's own non-deleted rows (same tables lib/usage/tracker.ts
--     trusts for the other limits).
--   * storage_used_mb — SUM(user_usage.storage_bytes) for the tenant, in MB.
--   * api_calls_count — SUM(user_usage.api_calls_today) for the tenant, counting
--     only rows whose api_calls_date is today so stale days don't leak in.
--   * email_sent_count — 0 for now (no per-tenant daily source column yet;
--     left explicit and documented rather than writing to a phantom column).
--
-- Idempotent per day: usage_snapshots has only a NON-UNIQUE (tenant_id,
-- snapshot_date) index, so we cannot use ON CONFLICT. Instead we insert one row
-- per tenant per day guarded by NOT EXISTS, which is safe under the cron's
-- hourly re-runs and the distributed lock in app/api/cron/usage-snapshot.

CREATE OR REPLACE FUNCTION public.snapshot_tenant_usage()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_today text := CURRENT_DATE::text;
  v_count integer := 0;
BEGIN
  INSERT INTO usage_snapshots (
    tenant_id, snapshot_date,
    contacts_count, leads_count, deals_count, users_count,
    storage_used_mb, api_calls_count, email_sent_count
  )
  SELECT
    t.id,
    v_today,
    (SELECT COUNT(*) FROM contacts c WHERE c.tenant_id = t.id AND c.deleted_at IS NULL),
    (SELECT COUNT(*) FROM leads l WHERE l.tenant_id = t.id AND l.deleted_at IS NULL),
    (SELECT COUNT(*) FROM deals d WHERE d.tenant_id = t.id AND d.deleted_at IS NULL),
    (SELECT COUNT(*) FROM tenant_members tm WHERE tm.tenant_id = t.id AND tm.status = 'active'),
    -- storage in MB from the per-user usage rows
    COALESCE((
      SELECT SUM(uu.storage_bytes)::numeric / (1024 * 1024)
      FROM user_usage uu
      WHERE uu.tenant_id = t.id AND uu.deleted_at IS NULL
    ), 0),
    -- API calls made today across the tenant's users
    COALESCE((
      SELECT SUM(uu.api_calls_today)
      FROM user_usage uu
      WHERE uu.tenant_id = t.id
        AND uu.deleted_at IS NULL
        AND uu.api_calls_date = CURRENT_DATE
    ), 0),
    0  -- email_sent_count: no per-tenant daily source column yet
  FROM tenants t
  WHERE t.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM usage_snapshots us
      WHERE us.tenant_id = t.id AND us.snapshot_date = v_today
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
