-- 0103: scheduled_reports.type must accept the report types the delivery job
-- can actually build.
--
-- chk_scheduled_reports_type was added in 0050 with 'pipeline', 'revenue',
-- 'contacts', 'performance'. The delivery cron reads scheduled_reports and maps
-- each row's type onto an export entity
-- (app/api/cron/scheduled-report-delivery/route.ts:38 exportEntityFor), which
-- handles four entities — contacts, deals, tasks, companies — via
-- lib/export/index.ts generateExportData. Three of those four entities have a
-- report type that the constraint rejects, so a report configured for deals,
-- tasks or companies cannot even be created: the INSERT fails with
-- check_violation and the settings route surfaces it as a 500.
--
-- 'leads' and 'summary' are deliberately NOT added, even though the create route
-- accepts them (its zod schema validates type as z.string().trim().min(1)
-- .max(50), i.e. free text). exportEntityFor() maps both onto the *contacts*
-- export through its `default` branch, so a "leads" report would have emailed a
-- contacts CSV and looked like it worked. Blessing them in the constraint would
-- enshrine that lie. The paired code change turns that `default` into a throw,
-- so an unsupported type now fails at delivery time where it can be seen and
-- decided on, instead of shipping a wrong file.
--
-- Widening is safe against existing data: it only adds values, so no current row
-- can violate the new constraint.
--
-- APPLIED to pre-prod on 2026-10-02 (approved: "Apply it + batch others"), after verification on nucrm_test.
ALTER TABLE "scheduled_reports" DROP CONSTRAINT IF EXISTS "chk_scheduled_reports_type";
--> statement-breakpoint
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "chk_scheduled_reports_type" CHECK (
  "type" IN (
    'pipeline', 'revenue', 'contacts', 'performance',
    'deals',
    'tasks',
    'companies'
  )
);
