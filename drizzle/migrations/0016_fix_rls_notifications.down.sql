-- Rollback 0016_fix_rls_notifications: Revert RLS policy fixes
-- RLS policies are additive; rolling back means dropping the fixed policies.
-- The previous (broken) state will be restored on next migration replay.
DROP POLICY IF EXISTS "notifications_tenant_isolation" ON notifications;
DROP POLICY IF EXISTS "notifications_rls_select" ON notifications;
DROP POLICY IF EXISTS "notifications_rls_insert" ON notifications;
DROP POLICY IF EXISTS "notifications_rls_update" ON notifications;
DROP POLICY IF EXISTS "notifications_rls_delete" ON notifications;
