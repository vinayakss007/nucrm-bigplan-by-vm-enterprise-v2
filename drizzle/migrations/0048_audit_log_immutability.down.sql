-- Rollback for 0048_audit_log_immutability
BEGIN;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
DROP TRIGGER IF EXISTS super_admin_audit_logs_no_update ON super_admin_audit_logs;
DROP TRIGGER IF EXISTS super_admin_audit_logs_no_delete ON super_admin_audit_logs;

DROP FUNCTION IF EXISTS audit_log_prevent_mutation();

COMMIT;
