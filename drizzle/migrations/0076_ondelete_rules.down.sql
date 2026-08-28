-- Rollback 0076: revert the ON DELETE rules added for #1053.
-- Case A: recreate the FKs without an explicit ON DELETE rule (NO ACTION default).
-- Case B: drop the FKs that this migration added.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='tenant_restores') THEN
    ALTER TABLE "tenant_restores" DROP CONSTRAINT IF EXISTS "tenant_restores_backup_id_tenant_backups_id_fk";
    ALTER TABLE "tenant_restores" ADD CONSTRAINT "tenant_restores_backup_id_tenant_backups_id_fk"
      FOREIGN KEY ("backup_id") REFERENCES "tenant_backups"("id");
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='dunning_attempts') THEN
    ALTER TABLE "dunning_attempts" DROP CONSTRAINT IF EXISTS "dunning_attempts_subscription_id_subscriptions_id_fk";
    ALTER TABLE "dunning_attempts" ADD CONSTRAINT "dunning_attempts_subscription_id_subscriptions_id_fk"
      FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id");
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='comm_email_drafts') THEN
    ALTER TABLE "comm_email_drafts" DROP CONSTRAINT IF EXISTS "comm_email_drafts_deal_id_deals_id_fk";
    ALTER TABLE "comm_email_drafts" ADD CONSTRAINT "comm_email_drafts_deal_id_deals_id_fk"
      FOREIGN KEY ("deal_id") REFERENCES "deals"("id");
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='email_log') THEN
    ALTER TABLE "email_log" DROP CONSTRAINT IF EXISTS "email_log_contact_id_contacts_id_fk";
    ALTER TABLE "email_log" ADD CONSTRAINT "email_log_contact_id_contacts_id_fk"
      FOREIGN KEY ("contact_id") REFERENCES "contacts"("id");
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='form_submissions') THEN
    ALTER TABLE "form_submissions" DROP CONSTRAINT IF EXISTS "form_submissions_contact_id_contacts_id_fk";
    ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_contact_id_contacts_id_fk"
      FOREIGN KEY ("contact_id") REFERENCES "contacts"("id");
  END IF;
END;
$$;

ALTER TABLE "invoice_payments"     DROP CONSTRAINT IF EXISTS "invoice_payments_recorded_by_users_id_fk";
ALTER TABLE "support_tickets"      DROP CONSTRAINT IF EXISTS "support_tickets_sla_policy_id_sla_policies_id_fk";
ALTER TABLE "automation_workflows" DROP CONSTRAINT IF EXISTS "automation_workflows_workflow_id_workflows_id_fk";
