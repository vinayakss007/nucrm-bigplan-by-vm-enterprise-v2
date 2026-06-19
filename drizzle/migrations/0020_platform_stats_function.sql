CREATE OR REPLACE FUNCTION public.platform_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'mrr', COALESCE((
      SELECT SUM(p.price_monthly::numeric)
      FROM tenants t
      JOIN plans p ON p.id = t.plan_id
      WHERE t.status = 'active' AND t.deleted_at IS NULL
    ), 0),
    'active_tenants', COALESCE((
      SELECT COUNT(*)::int
      FROM tenants
      WHERE status = 'active' AND deleted_at IS NULL
    ), 0),
    'trialing', COALESCE((
      SELECT COUNT(*)::int
      FROM tenants
      WHERE status = 'trialing' AND deleted_at IS NULL
    ), 0),
    'total_users', COALESCE((
      SELECT COUNT(*)::int
      FROM users
      WHERE deleted_at IS NULL
    ), 0),
    'unresolved_errors', COALESCE((
      SELECT COUNT(*)::int
      FROM error_logs
      WHERE resolved = false
    ), 0)
  ) INTO result;
  RETURN result;
END;
$$;
