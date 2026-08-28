-- 0076: add missing ON DELETE rules on 8 foreign keys (issue #1053).
--
-- Two cases:
--   A) FK already exists with NO ACTION  -> DROP + re-ADD with the new rule.
--   B) No FK exists (plain uuid column)  -> clean orphans, then ADD the FK.
--
-- Constraint names match Drizzle's default (<table>_<col>_<reftable>_id_fk).
-- All blocks are guarded/idempotent. Rules:
--   tenant_restores.backup_id        -> tenant_backups(id)  SET NULL  (A, audit record)
--   dunning_attempts.subscription_id -> subscriptions(id)   CASCADE   (A, meaningless w/o sub)
--   invoice_payments.recorded_by     -> users(id)           SET NULL  (B, audit record)
--   comm_email_drafts.deal_id        -> deals(id)           SET NULL  (A, draft survives)
--   email_log.contact_id             -> contacts(id)        SET NULL  (A, log record)
--   form_submissions.contact_id      -> contacts(id)        SET NULL  (A, submission record)
--   support_tickets.sla_policy_id    -> sla_policies(id)    SET NULL  (B, ticket survives)
--   automation_workflows.workflow_id -> workflows(id)       CASCADE   (B, link row)

-- ── Case A: recreate existing FKs with the desired ON DELETE rule ─────────────
DO $$
BEGIN
  -- tenant_restores.backup_id -> SET NULL
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='tenant_restores') THEN
    ALTER TABLE "tenant_restores" DROP CONSTRAINT IF EXISTS "tenant_restores_backup_id_tenant_backups_id_fk";
    ALTER TABLE "tenant_restores" ADD CONSTRAINT "tenant_restores_backup_id_tenant_backups_id_fk"
      FOREIGN KEY ("backup_id") REFERENCES "tenant_backups"("id") ON DELETE SET NULL;
  END IF;

  -- dunning_attempts.subscription_id -> CASCADE
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='dunning_attempts') THEN
    ALTER TABLE "dunning_attempts" DROP CONSTRAINT IF EXISTS "dunning_attempts_subscription_id_subscriptions_id_fk";
    ALTER TABLE "dunning_attempts" ADD CONSTRAINT "dunning_attempts_subscription_id_subscriptions_id_fk"
      FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE;
  END IF;

  -- comm_email_drafts.deal_id -> SET NULL
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='comm_email_drafts') THEN
    ALTER TABLE "comm_email_drafts" DROP CONSTRAINT IF EXISTS "comm_email_drafts_deal_id_deals_id_fk";
    ALTER TABLE "comm_email_drafts" ADD CONSTRAINT "comm_email_drafts_deal_id_deals_id_fk"
      FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL;
  END IF;

  -- email_log.contact_id -> SET NULL
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='email_log') THEN
    ALTER TABLE "email_log" DROP CONSTRAINT IF EXISTS "email_log_contact_id_contacts_id_fk";
    ALTER TABLE "email_log" ADD CONSTRAINT "email_log_contact_id_contacts_id_fk"
      FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL;
  END IF;

  -- form_submissions.contact_id -> SET NULL
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='form_submissions') THEN
    ALTER TABLE "form_submissions" DROP CONSTRAINT IF EXISTS "form_submissions_contact_id_contacts_id_fk";
    ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_contact_id_contacts_id_fk"
      FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL;
  END IF;
END;
$$;

-- ── Case B: add FKs that never existed (clean orphans first) ──────────────────

-- invoice_payments.recorded_by -> users(id) SET NULL
UPDATE invoice_payments SET recorded_by = NULL
  WHERE recorded_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = invoice_payments.recorded_by);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='invoice_payments')
     AND EXISTS (SELECT 1 FROM pg_class WHERE relname='users') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoice_payments_recorded_by_users_id_fk') THEN
      ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_recorded_by_users_id_fk"
        FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE SET NULL;
    END IF;
  END IF;
END;
$$;

-- support_tickets.sla_policy_id -> sla_policies(id) SET NULL
UPDATE support_tickets SET sla_policy_id = NULL
  WHERE sla_policy_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM sla_policies s WHERE s.id = support_tickets.sla_policy_id);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='support_tickets')
     AND EXISTS (SELECT 1 FROM pg_class WHERE relname='sla_policies') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='support_tickets_sla_policy_id_sla_policies_id_fk') THEN
      ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_sla_policy_id_sla_policies_id_fk"
        FOREIGN KEY ("sla_policy_id") REFERENCES "sla_policies"("id") ON DELETE SET NULL;
    END IF;
  END IF;
END;
$$;

-- automation_workflows.workflow_id -> workflows(id) CASCADE
DELETE FROM automation_workflows
  WHERE workflow_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM workflows w WHERE w.id = automation_workflows.workflow_id);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='automation_workflows')
     AND EXISTS (SELECT 1 FROM pg_class WHERE relname='workflows') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='automation_workflows_workflow_id_workflows_id_fk') THEN
      ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_workflow_id_workflows_id_fk"
        FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE;
    END IF;
  END IF;
END;
$$;
