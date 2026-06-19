CREATE TABLE IF NOT EXISTS "system_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL UNIQUE,
  "value" jsonb NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plans" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "description" text,
  "price_monthly" numeric(10,2) DEFAULT '0',
  "price_yearly" numeric(10,2) DEFAULT '0',
  "price_cents" integer DEFAULT 0,
  "price" numeric(10,2) DEFAULT '0',
  "max_users" integer DEFAULT 5,
  "max_contacts" integer DEFAULT 1000,
  "max_deals" integer DEFAULT 500,
  "max_storage_gb" numeric(6,2) DEFAULT '1',
  "max_automations" integer DEFAULT 5,
  "max_forms" integer DEFAULT 3,
  "max_api_calls_day" integer DEFAULT 1000,
  "features" jsonb DEFAULT '[]'::jsonb,
  "is_active" boolean DEFAULT true,
  "sort_order" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plans_name" ON "plans" ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plans_slug" ON "plans" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_plans_active" ON "plans" ("is_active", "sort_order");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "plan_id" text REFERENCES "plans"("id"),
  "status" text NOT NULL DEFAULT 'active',
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptions_tenant" ON "subscriptions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptions_metadata_g" ON "subscriptions" USING gin ("metadata");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE CASCADE,
  "deal_id" uuid REFERENCES "deals"("id") ON DELETE CASCADE,
  "company_id" uuid REFERENCES "companies"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "action" text,
  "description" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activities_tenant" ON "activities" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activities_entity" ON "activities" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activities_contact" ON "activities" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activities_deal" ON "activities" ("deal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activities_metadata_g" ON "activities" USING gin ("metadata");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "priority" text NOT NULL DEFAULT 'medium',
  "status" text NOT NULL DEFAULT 'pending',
  "due_date" timestamp with time zone,
  "completed" boolean DEFAULT false,
  "completed_at" timestamp with time zone,
  "contact_id" uuid REFERENCES "contacts"("id") ON DELETE SET NULL,
  "deal_id" uuid REFERENCES "deals"("id") ON DELETE SET NULL,
  "assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_tenant" ON "tasks" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_tenant_status" ON "tasks" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_assigned" ON "tasks" ("assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_created_by" ON "tasks" ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_due" ON "tasks" ("due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_contact" ON "tasks" ("contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_deal" ON "tasks" ("deal_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_tenant_due_active" ON "tasks" ("tenant_id", "due_date", "created_at") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_metadata_g" ON "tasks" USING gin ("metadata");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tasks_active" ON "tasks" ("id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_backups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "filename" text NOT NULL,
  "storage_path" text NOT NULL,
  "size_bytes" integer,
  "status" text NOT NULL DEFAULT 'pending',
  "backup_type" text NOT NULL DEFAULT 'automated',
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_backups_tenant" ON "tenant_backups" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_backups_metadata_g" ON "tenant_backups" USING gin ("metadata");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_restores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "backup_id" uuid REFERENCES "tenant_backups"("id"),
  "status" text NOT NULL DEFAULT 'pending',
  "initiated_by" uuid REFERENCES "users"("id"),
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_restores_tenant" ON "tenant_restores" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tenant_restores_metadata_g" ON "tenant_restores" USING gin ("metadata");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "layout" jsonb DEFAULT '[]'::jsonb,
  "is_default" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dashboards_tenant" ON "dashboards" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dashboards_active" ON "dashboards" ("id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "report_type" text NOT NULL,
  "config" jsonb NOT NULL,
  "chart_type" text DEFAULT 'table',
  "is_public" boolean DEFAULT false,
  "last_run_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_saved_reports_tenant" ON "saved_reports" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "amount" numeric(10,2),
  "currency" text DEFAULT 'usd',
  "stripe_event_id" text UNIQUE,
  "stripe_invoice_id" text,
  "stripe_subscription_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_events_tenant" ON "billing_events" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_events_type" ON "billing_events" ("event_type", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_events_stripe_event" ON "billing_events" ("stripe_event_id") WHERE "stripe_event_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_events_metadata_g" ON "billing_events" USING gin ("metadata");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "snapshot_date" text NOT NULL DEFAULT CURRENT_DATE::text,
  "contacts_count" integer DEFAULT 0,
  "leads_count" integer DEFAULT 0,
  "deals_count" integer DEFAULT 0,
  "users_count" integer DEFAULT 0,
  "storage_used_mb" numeric(10,2) DEFAULT '0',
  "api_calls_count" integer DEFAULT 0,
  "email_sent_count" integer DEFAULT 0,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_snapshots_tenant_date" ON "usage_snapshots" ("tenant_id", "snapshot_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_snapshots_date" ON "usage_snapshots" ("snapshot_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_snapshots_tenant" ON "usage_snapshots" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_snapshots_metadata_g" ON "usage_snapshots" USING gin ("metadata");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "limit_violations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "violation_type" text NOT NULL,
  "limit_value" integer,
  "actual_value" integer,
  "exceeded_at" timestamp with time zone DEFAULT now(),
  "notified" boolean DEFAULT false,
  "notified_at" timestamp with time zone,
  "resolved" boolean DEFAULT false,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_limit_violations_tenant" ON "limit_violations" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_limit_violations_unresolved" ON "limit_violations" ("resolved", "exceeded_at") WHERE "resolved" = false;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "file_uploads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "file_size" bigint,
  "mime_type" text,
  "uploaded_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_file_uploads_entity" ON "file_uploads" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_file_uploads_tenant" ON "file_uploads" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_file_uploads_active" ON "file_uploads" ("id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "body" text NOT NULL,
  "type" text DEFAULT 'info',
  "target" text DEFAULT 'all',
  "target_tenant_ids" uuid[],
  "is_active" boolean DEFAULT true,
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_announcements_active_time" ON "announcements" ("is_active", "starts_at", "ends_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_announcements_active" ON "announcements" ("id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "critical_data_backups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "table_name" text NOT NULL,
  "record_id" uuid NOT NULL,
  "backup_data" jsonb NOT NULL,
  "operation" text NOT NULL,
  "backed_up_at" timestamp with time zone DEFAULT now(),
  "retained_until" timestamp with time zone DEFAULT now() + INTERVAL '90 days',
  "can_restore" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_critical_backups_tenant" ON "critical_data_backups" ("tenant_id", "table_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_critical_backups_retain" ON "critical_data_backups" ("retained_until");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_critical_backups_record" ON "critical_data_backups" ("table_name", "record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_critical_backups_can_restore" ON "critical_data_backups" ("can_restore", "backed_up_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permission_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "role_id" uuid NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "permissions" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_permission_overrides_tenant" ON "permission_overrides" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_permission_overrides_role" ON "permission_overrides" ("role_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_permission_overrides_entity" ON "permission_overrides" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "health_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "service" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ok',
  "latency_ms" integer,
  "message" text,
  "checked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_health_checks_service" ON "health_checks" ("service", "checked_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_progress" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "step_name" text NOT NULL,
  "is_completed" boolean DEFAULT false,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_onboarding_progress_unique" ON "onboarding_progress" ("tenant_id", "user_id", "step_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onboarding_tenant_user" ON "onboarding_progress" ("tenant_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onboarding_step" ON "onboarding_progress" ("step_name", "is_completed");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onboarding_progress_tenant" ON "onboarding_progress" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE CASCADE,
  "key" text NOT NULL,
  "value" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platform_settings_key" ON "platform_settings" ("key") WHERE "key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_platform_settings_tenant" ON "platform_settings" ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_platform_settings_global_unique" ON "platform_settings" ("key") WHERE "tenant_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_platform_settings_tenant_unique" ON "platform_settings" ("key", "tenant_id") WHERE "tenant_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id"),
  "report_id" uuid NOT NULL,
  "executed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" text DEFAULT 'completed',
  "result_count" integer DEFAULT 0,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_report_executions_tenant" ON "report_executions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_report_executions_metadata_g" ON "report_executions" USING gin ("metadata");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revenue_forecast_summary" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "forecast_date" date NOT NULL DEFAULT CURRENT_DATE,
  "total_expected_revenue" numeric(15,2) DEFAULT '0',
  "total_deals" integer DEFAULT 0,
  "avg_deal_value" numeric(12,2) DEFAULT '0',
  "win_rate" numeric(5,2) DEFAULT '0',
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_revenue_forecast_tenant_date" ON "revenue_forecast_summary" ("tenant_id", "forecast_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_revenue_forecast_summary_tenant" ON "revenue_forecast_summary" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "selective_restore_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "action" text NOT NULL,
  "table_name" text,
  "record_id" uuid,
  "old_data" jsonb,
  "new_data" jsonb,
  "performed_by" uuid REFERENCES "users"("id"),
  "performed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_selective_restore_audit_log_tenant" ON "selective_restore_audit_log" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "selective_restore_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "backup_id" uuid NOT NULL,
  "action" text NOT NULL,
  "status" text DEFAULT 'pending',
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_selective_restore_logs_tenant" ON "selective_restore_logs" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "super_admin_backups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "backup_name" text NOT NULL,
  "backup_type" text DEFAULT 'full',
  "storage_path" text NOT NULL,
  "backup_size" bigint,
  "status" text DEFAULT 'completed',
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_super_admin_backups_name" ON "super_admin_backups" ("backup_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_super_admin_backups_status" ON "super_admin_backups" ("status", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_departures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE,
  "user_email" text,
  "user_name" text,
  "departure_date" date,
  "departed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" text,
  "notes" text,
  "is_rehirable" boolean DEFAULT false,
  "contacts_reassigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "contacts_count" integer DEFAULT 0,
  "deals_count" integer DEFAULT 0,
  "tasks_count" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_by" uuid,
  "deleted_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_departures_tenant" ON "user_departures" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_departures_user" ON "user_departures" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_departures_date" ON "user_departures" ("departure_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_key_usage_infra" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "api_key_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "ip_address" text,
  "user_agent" text,
  "method" text,
  "path" text,
  "status_code" integer,
  "response_time_ms" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_key_usage_key" ON "api_key_usage_infra" ("api_key_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_key_usage_infra_tenant" ON "api_key_usage_infra" ("tenant_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dashboard_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "category" text,
  "layout" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "filters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dashboard_templates_active" ON "dashboard_templates" ("id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "report_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "report_type" text NOT NULL,
  "query_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "chart_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "description" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_report_templates_active" ON "report_templates" ("id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sso_providers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "provider_type" text NOT NULL,
  "name" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sso_providers_tenant" ON "sso_providers" ("tenant_id") WHERE "is_active" = true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sso_providers_active" ON "sso_providers" ("id") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sso_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "provider_id" uuid REFERENCES "sso_providers"("id") ON DELETE SET NULL,
  "session_id" text NOT NULL,
  "id_token" text,
  "saml_assertion" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sso_sessions_user" ON "sso_sessions" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sso_sessions_id" ON "sso_sessions" ("session_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sso_sessions_tenant" ON "sso_sessions" ("tenant_id");
