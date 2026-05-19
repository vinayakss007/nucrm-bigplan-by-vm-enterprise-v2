CREATE TABLE "email_warmup_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"participant_id" uuid,
	"direction" text DEFAULT 'outbound' NOT NULL,
	"subject" text,
	"body" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "restore_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_data" jsonb NOT NULL,
	"table_count" integer,
	"record_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenant_backup_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"backup_type" text DEFAULT 'full',
	"data_size" bigint DEFAULT 0,
	"table_count" integer DEFAULT 0,
	"record_count" bigint DEFAULT 0,
	"backup_data" jsonb,
	"backup_note" text,
	"include_tables" jsonb,
	"initiated_by" uuid,
	"initiated_auto" boolean DEFAULT false,
	"duration_ms" integer,
	"error_message" text,
	"retention_days" integer DEFAULT 90,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenant_restore_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backup_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"restore_options" jsonb,
	"tables_restored" integer DEFAULT 0,
	"records_restored" bigint DEFAULT 0,
	"initiated_by" uuid,
	"duration_ms" integer,
	"error_message" text,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "idx_webhook_deliv_payload_g";--> statement-breakpoint
DROP INDEX "idx_backup_records_created";--> statement-breakpoint
DROP INDEX "idx_backup_records_expires";--> statement-breakpoint
DROP INDEX "idx_backup_records_metadata_g";--> statement-breakpoint
DROP INDEX "idx_whatsapp_templates_unique";--> statement-breakpoint
DROP INDEX "idx_backup_records_status";--> statement-breakpoint
ALTER TABLE "lead_assignments" ALTER COLUMN "lead_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "call_logs" ALTER COLUMN "direction" SET DEFAULT 'outbound';--> statement-breakpoint
ALTER TABLE "email_tracking" ALTER COLUMN "message_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_inbound_logs" ALTER COLUMN "payload" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "webhook_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "status" SET DEFAULT 'success';--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_records" ALTER COLUMN "expires_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user_departures" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_departures" ALTER COLUMN "departure_date" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "call_count" bigint DEFAULT 0;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "last_used_ip" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "body" text NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" text DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" text DEFAULT 'light';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_bot_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_notify_login" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_notify_signup" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_notify_password_change" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_notify_2fa_change" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_notify_security_alerts" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "custom_field_defs" ADD COLUMN "is_calculated" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "custom_field_defs" ADD COLUMN "formula" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "success_message" text;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "redirect_url" text;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "submit_label" text DEFAULT 'Submit';--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "theme" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "form_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "form_submissions_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "is_default" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "duration" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "recorded_url" text;--> statement-breakpoint
ALTER TABLE "call_logs" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "email_tracking" ADD COLUMN "recipient" text;--> statement-breakpoint
ALTER TABLE "email_tracking" ADD COLUMN "sequence_enrollment_id" uuid;--> statement-breakpoint
ALTER TABLE "email_tracking" ADD COLUMN "open_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "email_tracking" ADD COLUMN "click_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "webhook_inbound_logs" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_inbound_logs" ADD COLUMN "action" text;--> statement-breakpoint
ALTER TABLE "webhook_inbound_logs" ADD COLUMN "entity" text;--> statement-breakpoint
ALTER TABLE "webhook_inbound_logs" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "webhook_inbound_logs" ADD COLUMN "status_code" integer;--> statement-breakpoint
ALTER TABLE "webhook_inbound_logs" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_inbound_logs" ADD COLUMN "payload_size" integer;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD COLUMN "priority" text DEFAULT 'medium';--> statement-breakpoint
ALTER TABLE "ai_insights" ADD COLUMN "is_read" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "event_type" text DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "response_status" integer;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "response_body" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user_departures" ADD COLUMN "user_email" text;--> statement-breakpoint
ALTER TABLE "user_departures" ADD COLUMN "user_name" text;--> statement-breakpoint
ALTER TABLE "user_departures" ADD COLUMN "departed_by" uuid;--> statement-breakpoint
ALTER TABLE "user_departures" ADD COLUMN "contacts_reassigned_to" uuid;--> statement-breakpoint
ALTER TABLE "user_departures" ADD COLUMN "contacts_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "user_departures" ADD COLUMN "deals_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "user_departures" ADD COLUMN "tasks_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "email_warmup_logs" ADD CONSTRAINT "email_warmup_logs_config_id_email_warmup_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."email_warmup_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_warmup_logs" ADD CONSTRAINT "email_warmup_logs_participant_id_email_warmup_pool_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."email_warmup_pool"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_snapshots" ADD CONSTRAINT "restore_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_backup_records" ADD CONSTRAINT "tenant_backup_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_backup_records" ADD CONSTRAINT "tenant_backup_records_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_restore_records" ADD CONSTRAINT "tenant_restore_records_backup_id_tenant_backup_records_id_fk" FOREIGN KEY ("backup_id") REFERENCES "public"."tenant_backup_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_restore_records" ADD CONSTRAINT "tenant_restore_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_restore_records" ADD CONSTRAINT "tenant_restore_records_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_email_warmup_logs_config" ON "email_warmup_logs" USING btree ("config_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_restore_snapshots_tenant" ON "restore_snapshots" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_backup_tenant" ON "tenant_backup_records" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_tenant_backup_status" ON "tenant_backup_records" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_tenant_backup_expires" ON "tenant_backup_records" USING btree ("expires_at") WHERE status = 'completed';--> statement-breakpoint
CREATE INDEX "idx_tenant_restore_tenant" ON "tenant_restore_records" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_tenant_restore_backup" ON "tenant_restore_records" USING btree ("backup_id");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tracking" ADD CONSTRAINT "email_tracking_sequence_enrollment_id_sequence_enrollments_id_fk" FOREIGN KEY ("sequence_enrollment_id") REFERENCES "public"."sequence_enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_inbound_logs" ADD CONSTRAINT "webhook_inbound_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departures" ADD CONSTRAINT "user_departures_departed_by_users_id_fk" FOREIGN KEY ("departed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departures" ADD CONSTRAINT "user_departures_contacts_reassigned_to_users_id_fk" FOREIGN KEY ("contacts_reassigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_forms_slug" ON "forms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_lead_assignments_contact" ON "lead_assignments" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_email_warmup_unique" ON "email_warmup_configs" USING btree ("tenant_id","from_email");--> statement-breakpoint
CREATE INDEX "idx_webhook_inbound_logs_api_key" ON "webhook_inbound_logs" USING btree ("api_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_automation_workflows_tenant_workflow" ON "automation_workflows" USING btree ("tenant_id","workflow_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliv_webhook" ON "webhook_deliveries" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliv_status" ON "webhook_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_metadata_g" ON "webhook_deliveries" USING gin ("metadata");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_onboarding_progress_unique" ON "onboarding_progress" USING btree ("tenant_id","user_id","step_name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_platform_settings_global_unique" ON "platform_settings" USING btree ("key") WHERE "platform_settings"."tenant_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_platform_settings_tenant_unique" ON "platform_settings" USING btree ("key","tenant_id") WHERE "platform_settings"."tenant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_whatsapp_templates_unique" ON "whatsapp_templates" USING btree ("tenant_id","name","language");--> statement-breakpoint
CREATE INDEX "idx_backup_records_status" ON "backup_records" USING btree ("status","completed_at");--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "message";--> statement-breakpoint
ALTER TABLE "call_logs" DROP COLUMN "duration_seconds";--> statement-breakpoint
ALTER TABLE "call_logs" DROP COLUMN "summary";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP COLUMN "response";--> statement-breakpoint
ALTER TABLE "webhook_deliveries" DROP COLUMN "error";--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_slug_unique" UNIQUE("slug");