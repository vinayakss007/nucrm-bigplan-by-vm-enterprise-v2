-- Rollback 0035_missing_db_functions: Drop utility functions
DROP FUNCTION IF EXISTS public.calculate_churn_risk(uuid);
DROP FUNCTION IF EXISTS public.calculate_deal_win_probability(uuid);
DROP FUNCTION IF EXISTS public.calculate_lead_score(uuid);
DROP FUNCTION IF EXISTS public.get_tenant_usage_stats(uuid);
