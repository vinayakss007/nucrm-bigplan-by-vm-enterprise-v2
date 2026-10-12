-- 0101: notifications.type must accept every type the app can emit.
--
-- chk_notifications_type was added in 0050 with four values, when
-- 'info'/'mention'/'deal_stage'/'deal_won' were the only kinds written. The
-- NotificationType union in lib/notifications.ts has since grown to nineteen.
-- Every write of a type outside those four fails with check_violation, and
-- createNotification() signals that by RETURNING FALSE rather than throwing, so
-- callers that ignore the boolean counted the write as delivered:
--   - cron/task-reminders reported `notified:4` for a run that inserted zero rows
--     (both attempts, retried and exhausted, are in the app log);
--   - the automation `send_notification` action (engine.ts:177,
--     workflow-executor.ts:347) and POST /api/forms/submit notify-owner
--     (route.ts:275) all ask for type='system', which the constraint rejects;
--   - sla_breach/sla_escalation, contract_renewal, subscription_renewal,
--     task_assigned, contact_assigned, deal_assigned and lead_warming are
--     likewise unwritable.
-- `notifications` currently holds zero rows across pre-prod: in-app
-- notifications have never worked.
--
-- This widens the CHECK to exactly the current union, so no existing row can
-- violate it (there are none) and the two vocabularies cannot silently diverge
-- again — tests/unit/notification-type-vocabulary.test.ts pins them together.
--
-- APPLIED to pre-prod on 2026-10-01 (approved). On any other target, run with
-- `npm run db:migrate`.
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "chk_notifications_type";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "chk_notifications_type" CHECK (
  "type" IN (
    'info',
    'task_assigned', 'task_due', 'task_overdue',
    'deal_stage', 'deal_assigned', 'deal_won',
    'contact_assigned', 'mention',
    'invite_accepted', 'team_joined',
    'limit_warning', 'trial_expiring',
    'lead_warming',
    'sla_breach', 'sla_escalation',
    'contract_renewal', 'subscription_renewal',
    'ai_followup_sent',
    'system'
  )
);
