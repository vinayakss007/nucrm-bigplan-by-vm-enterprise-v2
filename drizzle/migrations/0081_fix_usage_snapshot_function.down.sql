-- Revert 0081: restore the previous (broken) definition from migration 0032.
-- Note: this definition references columns that do not exist on usage_snapshots
-- and will throw at runtime — it is preserved only for exact rollback parity.
CREATE OR REPLACE FUNCTION public.snapshot_tenant_usage()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO usage_snapshots (tenant_id, user_count, contact_count, deal_count, storage_bytes, period_start, period_end)
  SELECT t.id,
    (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND deleted_at IS NULL),
    (SELECT COUNT(*) FROM contacts WHERE tenant_id = t.id AND deleted_at IS NULL),
    (SELECT COUNT(*) FROM deals WHERE tenant_id = t.id AND deleted_at IS NULL),
    0::bigint,
    date_trunc('month', NOW()),
    date_trunc('month', NOW()) + interval '1 month'
  FROM tenants t WHERE t.deleted_at IS NULL
  ON CONFLICT (tenant_id, period_start) DO NOTHING;
  RETURN 1;
END;
$function$;
