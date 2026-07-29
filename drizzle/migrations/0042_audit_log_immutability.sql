-- Migration ID: 0042_audit_log_immutability
-- Name: Make the audit hash chain actually immutable (triggers)
-- Dependencies: 0041_teams

-- WHY THIS EXISTS
-- ---------------
-- 0009 added `previous_hash`/`hash` to audit_logs and its own column comment
-- claims they form "an immutable chain". Nothing enforced that. The hash chain
-- makes tampering *detectable after the fact*; it does not make it *impossible*.
-- Any UPDATE or DELETE — a stray migration, a mistaken psql session, a
-- compromised app credential — could rewrite or remove history, and re-link the
-- chain afterwards so verification still passed.
--
-- #676 principle 2 requires the audit chain to be tamper-proof. These triggers
-- are the enforcement: the database refuses the write.
--
-- THE ESCAPE HATCH, AND WHY IT EXISTS
-- Blocking DELETE unconditionally would make lawful data retention impossible —
-- GDPR erasure requests and finite retention windows both require eventually
-- removing old audit rows. So DELETE is refused *unless* the caller has
-- explicitly opted in for that transaction:
--
--   SET LOCAL app.allow_audit_purge = 'on';
--
-- That is deliberately transaction-scoped (SET LOCAL) so it cannot leak to
-- another request through a pooled connection. It converts silent, accidental
-- deletion into a deliberate, greppable act. UPDATE has no escape hatch at all:
-- there is no legitimate reason to alter a written audit entry.

-- UP Migration
BEGIN;

CREATE OR REPLACE FUNCTION audit_log_prevent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'audit log entries are immutable: UPDATE on % is not permitted', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- current_setting(..., true) returns NULL rather than erroring when unset.
    IF coalesce(current_setting('app.allow_audit_purge', true), 'off') <> 'on' THEN
      RAISE EXCEPTION
        'audit log entries are append-only: DELETE on % requires SET LOCAL app.allow_audit_purge = ''on''', TG_TABLE_NAME
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION audit_log_prevent_mutation() IS
  'Enforces append-only audit logs. UPDATE always refused; DELETE refused unless the transaction sets app.allow_audit_purge = ''on''.';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_logs', 'super_admin_audit_logs']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_update', t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation()',
        t || '_no_update', t);

      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_delete', t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE DELETE ON %I
           FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation()',
        t || '_no_delete', t);

      RAISE NOTICE 'audit immutability triggers installed on %', t;
    ELSE
      RAISE NOTICE 'table % not present, skipping', t;
    END IF;
  END LOOP;
END $$;

COMMIT;
