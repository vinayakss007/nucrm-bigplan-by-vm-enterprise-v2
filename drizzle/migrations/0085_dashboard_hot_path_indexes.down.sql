-- Down migration for 0085: drop the dashboard hot-path composite indexes.
DROP INDEX IF EXISTS "idx_email_log_tenant_created";
DROP INDEX IF EXISTS "idx_follow_ups_tenant_status_due";
DROP INDEX IF EXISTS "idx_notifications_tenant_user_created";
DROP INDEX IF EXISTS "idx_activities_tenant_created";
