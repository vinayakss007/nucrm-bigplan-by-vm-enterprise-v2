/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
-- 0149: replace the churn placeholder with a deterministic activity-recency score (#2774).
--
-- 0032 defined public.calculate_churn_risk as `RETURN 0.1;`: it ignored its
-- argument and read no table, so every contact in every tenant scored the same
-- constant. #2815 fixed the numeric-as-string read and #3203 made the response
-- name that placeholder; neither supplied the scoring rule the issue reserves
-- to the owner. This migration supplies it.
--
-- Model (deterministic — no AI, no random, no wall-clock drift beyond "now"):
--
--   recency band, from COALESCE(GREATEST(last_activity_at, last_contacted_at),
--   created_at). The idle threshold is the tenant's global (stage_id IS NULL)
--   active at_risk_rules.max_days_idle, default 14 when none is configured:
--     >= 2x threshold -> 0.80     >= threshold     -> 0.55
--     >= threshold/2 -> 0.30      otherwise        -> 0.05
--   engagement: times_contacted 0 -> +0.10, 1-2 -> +0.05, 3+ -> +0
--   disengagement: unsubscribed OR do_not_contact -> +0.05
--   clamped to [0,1] and rounded to 2 dp (churn_probability is numeric(5,2)).
--
-- SECURITY INVOKER (the default): the function runs under the caller's RLS
-- context, so it can only score a contact the request itself can see. It reads
-- no cross-tenant rows. Deleted contacts yield NULL, which the handler's
-- Number.isFinite fallback turns into 0 — the handler already 404s them first.
--
-- Idempotent: CREATE OR REPLACE. Rollback restores 0032's exact placeholder.

CREATE OR REPLACE FUNCTION public.calculate_churn_risk(p_contact_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  WITH contact_state AS (
    SELECT
      COALESCE(
        EXTRACT(EPOCH FROM (
          now() - COALESCE(GREATEST(c.last_activity_at, c.last_contacted_at), c.created_at)
        )) / 86400.0,
        999999
      ) AS idle_days,
      COALESCE(c.times_contacted, 0) AS times_contacted,
      (COALESCE(c.unsubscribed, false) OR COALESCE(c.do_not_contact, false)) AS disengaged,
      COALESCE((
        SELECT r.max_days_idle
        FROM at_risk_rules r
        WHERE r.tenant_id = c.tenant_id
          AND r.active = true
          AND r.stage_id IS NULL
          AND r.deleted_at IS NULL
        ORDER BY r.created_at DESC
        LIMIT 1
      ), 14) AS idle_threshold_days
    FROM contacts c
    WHERE c.id = p_contact_id
      AND c.deleted_at IS NULL
  )
  SELECT LEAST(1.0::numeric, GREATEST(0::numeric, ROUND((
      CASE
        WHEN cs.idle_days >= cs.idle_threshold_days * 2 THEN 0.80
        WHEN cs.idle_days >= cs.idle_threshold_days THEN 0.55
        WHEN cs.idle_days >= cs.idle_threshold_days / 2.0 THEN 0.30
        ELSE 0.05
      END
      + CASE
          WHEN cs.times_contacted = 0 THEN 0.10
          WHEN cs.times_contacted <= 2 THEN 0.05
          ELSE 0
        END
      + CASE WHEN cs.disengaged THEN 0.05 ELSE 0 END
    )::numeric, 2)))
  FROM contact_state cs
$function$;
