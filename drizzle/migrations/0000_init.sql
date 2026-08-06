CREATE TABLE "api_key_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"status_code" integer,
	"response_time_ms" integer,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" jsonb DEFAULT '["*"]'::jsonb,
	"is_active" boolean DEFAULT true,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"impersonated_by" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"old_data" jsonb,
	"new_data" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feature_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature_name" text NOT NULL,
	"description" text,
	"version" text DEFAULT '1.0.0',
	"enabled" boolean DEFAULT true,
	"metadata_keys" jsonb DEFAULT '[]'::jsonb,
	"entities" jsonb DEFAULT '[]'::jsonb,
	"requires_tables" jsonb DEFAULT '[]'::jsonb,
	"registered_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "feature_registry_feature_name_unique" UNIQUE("feature_name")
);
--> statement-breakpoint
CREATE TABLE "field_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role_id" uuid,
	"entity_type" text NOT NULL,
	"field_name" text NOT NULL,
	"access_level" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "impersonation_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"impersonator_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" text DEFAULT 'info' NOT NULL,
	"read_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "password_resets_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "record_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"access_level" text DEFAULT 'none' NOT NULL,
	"granted_by" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "refresh_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false,
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tenant_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid,
	"role_slug" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone DEFAULT now(),
	"joined_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"subdomain" text,
	"status" text DEFAULT 'trialing' NOT NULL,
	"plan_id" text DEFAULT 'free' NOT NULL,
	"trial_ends_at" timestamp with time zone DEFAULT (now() + '14 days'::interval),
	"owner_id" uuid,
	"primary_color" text DEFAULT '#7c3aed',
	"billing_email" text,
	"logo_url" text,
	"favicon_url" text,
	"custom_domain" text,
	"subscription_id" text,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"billing_type" text DEFAULT 'trial',
	"manual_paid_until" timestamp with time zone,
	"current_users" integer DEFAULT 0,
	"current_contacts" integer DEFAULT 0,
	"current_deals" integer DEFAULT 0,
	"storage_used_bytes" bigint DEFAULT 0,
	"industry" text,
	"company_size" text,
	"country" text,
	"domain_verified" boolean DEFAULT false,
	"domain_verified_at" timestamp with time zone,
	"admin_notes" text,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_custom_domain_unique" UNIQUE("custom_domain")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"full_name" text,
	"avatar_url" text,
	"phone" text,
	"timezone" text DEFAULT 'UTC',
	"is_super_admin" boolean DEFAULT false,
	"last_tenant_id" uuid,
	"default_tenant_id" uuid,
	"email_verified" boolean DEFAULT false,
	"email_verify_token" text,
	"reset_token" text,
	"reset_token_expires" timestamp with time zone,
	"oauth_provider" text,
	"oauth_id" text,
	"totp_enabled" boolean DEFAULT false,
	"totp_secret" text,
	"totp_backup_codes" jsonb,
	"totp_verified_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "call_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"call_id" text,
	"user_id" uuid,
	"summary" text,
	"notes" text,
	"action_items" text[],
	"sentiment" text,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "call_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recording_id" text,
	"call_sid" text,
	"recording_url" text,
	"transcription" text,
	"duration_seconds" integer,
	"direction" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "churn_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"churn_probability" numeric(5, 2) DEFAULT '0',
	"churn_risk" text,
	"risk_factors" jsonb DEFAULT '[]'::jsonb,
	"recommended_actions" text[],
	"previous_probability" numeric(5, 2),
	"probability_change" numeric(5, 2),
	"is_actioned" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"industry" text,
	"company_size" text,
	"annual_revenue" numeric(15, 2),
	"founded_year" integer,
	"headquarters" text,
	"description" text,
	"website" text,
	"logo_url" text,
	"phone" text,
	"address" text,
	"address_line1" text,
	"city" text,
	"state" text,
	"country" text,
	"postal_code" text,
	"timezone" text,
	"linkedin_url" text,
	"twitter_url" text,
	"facebook_url" text,
	"is_customer" boolean DEFAULT false,
	"last_activity_at" timestamp with time zone,
	"notes" text,
	"tags" text[] DEFAULT '{}',
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "contact_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"is_primary" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_lifecycle_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_merge_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"primary_contact_id" uuid NOT NULL,
	"merged_contact_id" uuid NOT NULL,
	"merged_fields" jsonb DEFAULT '{}'::jsonb,
	"merged_by" uuid,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"overall_score" integer DEFAULT 0,
	"engagement_score" integer DEFAULT 0,
	"fit_score" integer DEFAULT 0,
	"intent_score" integer DEFAULT 0,
	"score_factors" jsonb DEFAULT '[]'::jsonb,
	"last_calculated_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contact_scores_contact_id_unique" UNIQUE("contact_id")
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"contact_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "contact_tags_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"company_id" uuid,
	"assigned_to" uuid,
	"original_owner_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '',
	"email" text,
	"secondary_email" text,
	"phone" text,
	"mobile_phone" text,
	"work_phone" text,
	"job_title" text,
	"department" text,
	"address" text,
	"address_line1" text,
	"address_line2" text,
	"city" text,
	"state" text,
	"country" text,
	"postal_code" text,
	"timezone" text,
	"birthday" date,
	"gender" text,
	"avatar_url" text,
	"linkedin_url" text,
	"twitter_url" text,
	"facebook_url" text,
	"instagram_url" text,
	"website" text,
	"lead_source" text,
	"lead_status" text DEFAULT 'new',
	"lifecycle_stage" text DEFAULT 'subscriber',
	"score" integer DEFAULT 0,
	"last_activity_at" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"times_contacted" integer DEFAULT 0,
	"last_assigned_at" timestamp with time zone,
	"do_not_contact" boolean DEFAULT false,
	"unsubscribed" boolean DEFAULT false,
	"is_archived" boolean DEFAULT false,
	"is_customer" boolean DEFAULT false,
	"lead_access" text DEFAULT 'team',
	"owner_notes" text,
	"notes" text,
	"tags" text[] DEFAULT '{}',
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "conversation_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"category" text,
	"count" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversation_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"total_duration_seconds" integer DEFAULT 0 NOT NULL,
	"avg_duration_seconds" numeric(10, 2) DEFAULT '0' NOT NULL,
	"last_call_at" timestamp with time zone,
	"sentiment_score" numeric(5, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "custom_field_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"field_key" text NOT NULL,
	"field_label" text NOT NULL,
	"field_type" text DEFAULT 'text' NOT NULL,
	"field_options" jsonb,
	"is_required" boolean DEFAULT false,
	"is_searchable" boolean DEFAULT true,
	"default_value" text,
	"display_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deal_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"win_probability" numeric(5, 2) DEFAULT '0',
	"predicted_close_date" date,
	"predicted_value" numeric(12, 2),
	"positive_factors" jsonb DEFAULT '[]'::jsonb,
	"negative_factors" jsonb DEFAULT '[]'::jsonb,
	"original_value" numeric(12, 2),
	"value_change" numeric(12, 2),
	"original_close_date" date,
	"date_change_days" integer,
	"confidence_level" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deal_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_name" text NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1,
	"price" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deal_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"order" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"pipeline_id" uuid,
	"stage_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount" numeric(15, 2) DEFAULT '0',
	"close_date" timestamp with time zone,
	"assigned_to" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "entity_tags" (
	"tenant_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "entity_tags_tag_id_entity_id_pk" PRIMARY KEY("tag_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "file_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" bigint,
	"mime_type" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"contact_id" uuid,
	"submitted_by" text,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"submissions_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid,
	"performed_by" uuid,
	"activity_type" text NOT NULL,
	"description" text,
	"subject" text,
	"body" text,
	"activity_data" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"performed_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_scoring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"field" text NOT NULL,
	"operator" text NOT NULL,
	"value" text,
	"score" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "lead_tags" (
	"lead_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "lead_tags_lead_id_tag_id_pk" PRIMARY KEY("lead_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text DEFAULT '' NOT NULL,
	"full_name" text,
	"email" text,
	"phone" text,
	"company_name" text,
	"lead_source" text,
	"lead_status" text DEFAULT 'new' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"value" numeric(12, 2),
	"budget" numeric(12, 2),
	"assigned_to" uuid,
	"owner_id" uuid,
	"company_id" uuid,
	"title" text,
	"website" text,
	"mobile" text,
	"address" text,
	"address_line1" text,
	"city" text,
	"state" text,
	"country" text,
	"postal_code" text,
	"company_size" text,
	"company_industry" text,
	"lifecycle_stage" text DEFAULT 'lead',
	"budget_currency" text DEFAULT 'USD',
	"authority_level" text DEFAULT 'unknown',
	"need_description" text,
	"timeline" text,
	"timeline_target_date" date,
	"linkedin_url" text,
	"twitter_handle" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"last_activity_at" timestamp with time zone,
	"internal_notes" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"is_converted" boolean DEFAULT false NOT NULL,
	"converted_at" timestamp with time zone,
	"converted_contact_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"deal_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"location" text,
	"meeting_url" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "pipeline_health_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"metric_date" date NOT NULL,
	"total_deals" integer DEFAULT 0 NOT NULL,
	"total_value" numeric(15, 2) DEFAULT '0' NOT NULL,
	"avg_deal_size" numeric(15, 2),
	"win_rate" numeric(5, 4),
	"avg_cycle_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"order_val" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "price_book_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_book_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "price_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"base_price" numeric(12, 2) DEFAULT '0',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "quote_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(15, 4) DEFAULT '1' NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0',
	"tax_percent" numeric(5, 2) DEFAULT '0',
	"total" numeric(15, 2) NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"title" text NOT NULL,
	"quote_number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"subtotal" numeric(15, 2) DEFAULT '0',
	"discount" numeric(15, 2) DEFAULT '0',
	"tax" numeric(15, 2) DEFAULT '0',
	"total_amount" numeric(15, 2) DEFAULT '0',
	"expires_at" timestamp with time zone,
	"notes" text,
	"terms" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "revenue_projections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"projected_amount" numeric(15, 2) NOT NULL,
	"actual_amount" numeric(15, 2) DEFAULT '0',
	"confidence_score" numeric(5, 4),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_email_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"purpose" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"tone" text DEFAULT 'professional',
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"user_id" uuid,
	"direction" text NOT NULL,
	"duration_seconds" integer DEFAULT 0,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"from_email" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text,
	"body" text,
	"template_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text,
	"category" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"message_id" text NOT NULL,
	"subject" text,
	"sent_at" timestamp with time zone DEFAULT now(),
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "email_verifications_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "email_warmup_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"is_active" boolean DEFAULT false,
	"daily_limit_start" integer DEFAULT 5,
	"daily_limit_current" integer DEFAULT 5,
	"daily_limit_max" integer DEFAULT 50,
	"ramp_up_days" integer DEFAULT 21,
	"from_email" text NOT NULL,
	"from_name" text DEFAULT '',
	"started_at" timestamp with time zone DEFAULT now(),
	"last_warmup_at" timestamp with time zone,
	"total_sent" integer DEFAULT 0,
	"total_replied" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_warmup_pool" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"participant_email" text NOT NULL,
	"participant_name" text DEFAULT '',
	"status" text DEFAULT 'active',
	"last_sent_at" timestamp with time zone,
	"last_replied_at" timestamp with time zone,
	"sent_count" integer DEFAULT 0,
	"reply_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "voice_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"call_sid" text,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"duration_seconds" integer DEFAULT 0,
	"recording_url" text,
	"transcript" text,
	"ai_summary" text,
	"ai_sentiment" text,
	"ai_action_items" jsonb DEFAULT '[]'::jsonb,
	"cost_cents" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_inbound_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid,
	"tenant_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"headers" jsonb DEFAULT '{}'::jsonb,
	"response_status" integer,
	"response_body" text,
	"error_message" text,
	"processed" boolean DEFAULT false,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whatsapp_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"whatsapp_from" text NOT NULL,
	"whatsapp_to" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ai_enabled" boolean DEFAULT false,
	"ai_last_response" text,
	"last_message_at" timestamp with time zone DEFAULT now(),
	"message_count" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"content_type" text DEFAULT 'text' NOT NULL,
	"content" text NOT NULL,
	"external_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"ai_generated" boolean DEFAULT false,
	"ai_model_used" text,
	"delivered" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'en',
	"category" text,
	"status" text,
	"content" text,
	"components" jsonb DEFAULT '[]'::jsonb,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"meta_data" jsonb DEFAULT '{}'::jsonb,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"score" numeric(5, 2),
	"confidence" numeric(3, 2),
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_module_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module_name" text NOT NULL,
	"enabled" boolean DEFAULT false,
	"config" jsonb DEFAULT '{}'::jsonb,
	"usage_stats" jsonb DEFAULT '{}'::jsonb,
	"plan_requirement" text DEFAULT 'starter',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"feature" text NOT NULL,
	"model" text,
	"prompt_tokens" integer DEFAULT 0,
	"completion_tokens" integer DEFAULT 0,
	"tokens_used" integer DEFAULT 0,
	"cost_cents" numeric(10, 4),
	"cost_estimate" numeric(10, 5),
	"response_time_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_usage_aggregated" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module_name" text NOT NULL,
	"billing_period" text NOT NULL,
	"count" bigint DEFAULT 0,
	"tokens_used" bigint DEFAULT 0,
	"cost_cents" bigint DEFAULT 0,
	"included_in_plan" bigint DEFAULT 0,
	"overage_count" bigint DEFAULT 0,
	"overage_cost_cents" bigint DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger_event" text,
	"trigger_entity" text,
	"trigger_entity_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_message" text,
	"steps_completed" integer DEFAULT 0,
	"total_steps" integer DEFAULT 0,
	"triggered_by" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"workflow_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"trigger_type" text DEFAULT 'event' NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb,
	"run_count" integer DEFAULT 0,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "content_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"content_type" text NOT NULL,
	"platform" text,
	"input_prompt" text,
	"output_content" text,
	"model_used" text,
	"tokens_used" integer DEFAULT 0,
	"cost_cents" integer DEFAULT 0,
	"status" text DEFAULT 'draft',
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "revenue_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"opportunity_type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"estimated_value" numeric(12, 2),
	"reason" text,
	"suggested_action" text,
	"status" text DEFAULT 'new' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"detected_at" timestamp with time zone DEFAULT now(),
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" integer,
	"payload" jsonb,
	"response" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret" text,
	"is_active" boolean DEFAULT true,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_action_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"action_id" uuid,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"result" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"condition_config" jsonb,
	"order_index" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_execution_id" uuid,
	"tenant_id" uuid NOT NULL,
	"message" text NOT NULL,
	"level" text DEFAULT 'info',
	"step_name" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"lead_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"input_data" jsonb,
	"output_data" jsonb,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"trigger_type" text DEFAULT 'manual' NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"nodes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"contact_id" uuid,
	"deal_id" uuid,
	"company_id" uuid,
	"event_type" text NOT NULL,
	"action" text,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"type" text DEFAULT 'info',
	"target" text DEFAULT 'all',
	"target_tenant_ids" uuid[],
	"is_active" boolean DEFAULT true,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "api_key_usage_infra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"method" text,
	"path" text,
	"status_code" integer,
	"response_time_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "backup_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_type" text NOT NULL,
	"message" text NOT NULL,
	"resolved" boolean DEFAULT false,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "backup_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backup_type" text DEFAULT 'full' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"size_bytes" bigint DEFAULT 0,
	"storage_path" text,
	"storage_type" text DEFAULT 'local',
	"duration_ms" integer,
	"initiated_auto" boolean DEFAULT false,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone DEFAULT now() + INTERVAL '30 days',
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "backup_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"schedule_type" text DEFAULT 'monthly' NOT NULL,
	"backup_type" text DEFAULT 'full' NOT NULL,
	"retention_days" integer DEFAULT 90 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"amount" numeric(10, 2),
	"currency" text DEFAULT 'usd',
	"stripe_event_id" text,
	"stripe_invoice_id" text,
	"stripe_subscription_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "billing_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "critical_data_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"table_name" text NOT NULL,
	"record_id" uuid NOT NULL,
	"backup_data" jsonb NOT NULL,
	"operation" text NOT NULL,
	"backed_up_at" timestamp with time zone DEFAULT now(),
	"retained_until" timestamp with time zone DEFAULT now() + INTERVAL '90 days',
	"can_restore" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "dashboard_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"category" text,
	"layout" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "dashboard_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"layout" jsonb DEFAULT '[]'::jsonb,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "file_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_path" text NOT NULL,
	"file_size" bigint,
	"mime_type" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"latency_ms" integer,
	"message" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "limit_violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"violation_type" text NOT NULL,
	"limit_value" integer,
	"actual_value" integer,
	"exceeded_at" timestamp with time zone DEFAULT now(),
	"notified" boolean DEFAULT false,
	"notified_at" timestamp with time zone,
	"resolved" boolean DEFAULT false,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"step_name" text NOT NULL,
	"is_completed" boolean DEFAULT false,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"price_monthly" numeric(10, 2) DEFAULT '0',
	"price_yearly" numeric(10, 2) DEFAULT '0',
	"price_cents" integer DEFAULT 0,
	"price" numeric(10, 2) DEFAULT '0',
	"max_users" integer DEFAULT 5,
	"max_contacts" integer DEFAULT 1000,
	"max_deals" integer DEFAULT 500,
	"max_storage_gb" numeric(6, 2) DEFAULT '1',
	"max_automations" integer DEFAULT 5,
	"max_forms" integer DEFAULT 3,
	"max_api_calls_day" integer DEFAULT 1000,
	"features" jsonb DEFAULT '[]'::jsonb,
	"is_active" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"key" text NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "report_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"report_id" uuid NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'completed',
	"result_count" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "report_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"report_type" text NOT NULL,
	"query_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chart_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "report_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "revenue_forecast_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"forecast_date" date DEFAULT CURRENT_DATE NOT NULL,
	"total_expected_revenue" numeric(15, 2) DEFAULT '0',
	"total_deals" integer DEFAULT 0,
	"avg_deal_value" numeric(12, 2) DEFAULT '0',
	"win_rate" numeric(5, 2) DEFAULT '0',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"report_type" text NOT NULL,
	"config" jsonb NOT NULL,
	"chart_type" text DEFAULT 'table',
	"is_public" boolean DEFAULT false,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "selective_restore_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action" text NOT NULL,
	"table_name" text,
	"record_id" uuid,
	"old_data" jsonb,
	"new_data" jsonb,
	"performed_by" uuid,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "selective_restore_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"backup_id" uuid NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending',
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sso_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sso_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_id" uuid,
	"session_id" text NOT NULL,
	"id_token" text,
	"saml_assertion" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "super_admin_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backup_name" text NOT NULL,
	"backup_type" text DEFAULT 'full',
	"storage_path" text NOT NULL,
	"backup_size" bigint,
	"status" text DEFAULT 'completed',
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_date" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"contact_id" uuid,
	"deal_id" uuid,
	"assigned_to" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "tenant_backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"storage_path" text NOT NULL,
	"size_bytes" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"backup_type" text DEFAULT 'automated' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenant_restores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"backup_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"initiated_by" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_date" text DEFAULT CURRENT_DATE::text NOT NULL,
	"contacts_count" integer DEFAULT 0,
	"leads_count" integer DEFAULT 0,
	"deals_count" integer DEFAULT 0,
	"users_count" integer DEFAULT 0,
	"storage_used_mb" numeric(10, 2) DEFAULT 0,
	"api_calls_count" integer DEFAULT 0,
	"email_sent_count" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_departures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"departure_date" date NOT NULL,
	"reason" text,
	"notes" text,
	"is_rehirable" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "api_keys_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"key_name" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_prefix" text,
	"is_active" boolean DEFAULT true,
	"is_primary" boolean DEFAULT false,
	"monthly_budget_cents" bigint DEFAULT -1,
	"current_month_cents" bigint DEFAULT 0,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"rate_limit_per_min" integer,
	"rate_limit_per_day" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "cost_anomalies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service" text NOT NULL,
	"expected_daily_cents" bigint,
	"actual_daily_cents" bigint,
	"deviation_pct" numeric(10, 2),
	"suspected_cause" text,
	"action_taken" text,
	"reviewed" boolean DEFAULT false,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_token_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"openai_monthly_limit" bigint DEFAULT -1,
	"whatsapp_monthly_msgs" bigint DEFAULT -1,
	"voice_monthly_mins" bigint DEFAULT -1,
	"content_monthly_gen" bigint DEFAULT -1,
	"proposal_monthly_gen" bigint DEFAULT -1,
	"followup_monthly_cnt" bigint DEFAULT -1,
	"score_monthly_cnt" bigint DEFAULT -1,
	"total_monthly_cost" bigint DEFAULT -1,
	"hard_cap_action" text DEFAULT 'block',
	"override_reason" text,
	"set_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenant_token_limits_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "token_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service" text NOT NULL,
	"monthly_budget_cents" bigint DEFAULT 0 NOT NULL,
	"current_month_cents" bigint DEFAULT 0 NOT NULL,
	"alert_at_50pct" boolean DEFAULT true,
	"alert_at_80pct" boolean DEFAULT true,
	"alert_at_100pct" boolean DEFAULT true,
	"hard_cap_enabled" boolean DEFAULT true,
	"soft_cap_enabled" boolean DEFAULT true,
	"billing_period" text NOT NULL,
	"reset_day" integer DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"service" text,
	"current_value" bigint,
	"threshold_value" bigint,
	"message" text,
	"notification_sent" text,
	"acknowledged" boolean DEFAULT false,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_token_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"module" text NOT NULL,
	"daily_limit" bigint DEFAULT -1,
	"monthly_limit" bigint DEFAULT -1,
	"max_cost_per_call" bigint DEFAULT -1,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"description" text,
	"category" text,
	"icon" text,
	"manifest" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenant_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"enabled_features" jsonb DEFAULT '[]'::jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb,
	"installed_by" uuid,
	"installed_at" timestamp with time zone DEFAULT now(),
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "error_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"level" text DEFAULT 'error' NOT NULL,
	"code" text,
	"message" text NOT NULL,
	"stack" text,
	"context" jsonb DEFAULT '{}'::jsonb,
	"resolved" boolean DEFAULT false,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failed_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"payload" jsonb NOT NULL,
	"error_message" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"category" text DEFAULT 'general',
	"assigned_to" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ticket_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"contact_id" uuid,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sequence_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"next_step_at" timestamp with time zone,
	"enrolled_by" uuid,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sequence_step_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"step_id" uuid,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"step_type" text DEFAULT 'email' NOT NULL,
	"delay_days" integer DEFAULT 0,
	"delay_hours" integer DEFAULT 0,
	"delay_minutes" integer DEFAULT 0,
	"template_id" uuid,
	"content" text,
	"subject" text,
	"body" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"enroll_count" integer DEFAULT 0,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "segment_members" (
	"segment_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"entity_type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"query_logic" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
ALTER TABLE "api_key_usage" ADD CONSTRAINT "api_key_usage_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_usage" ADD CONSTRAINT "api_key_usage_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_permissions" ADD CONSTRAINT "field_permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_permissions" ADD CONSTRAINT "field_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_impersonator_id_users_id_fk" FOREIGN KEY ("impersonator_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_permissions" ADD CONSTRAINT "record_permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_permissions" ADD CONSTRAINT "record_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_permissions" ADD CONSTRAINT "record_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_notes" ADD CONSTRAINT "call_notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_notes" ADD CONSTRAINT "call_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_notes" ADD CONSTRAINT "call_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_predictions" ADD CONSTRAINT "churn_predictions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_predictions" ADD CONSTRAINT "churn_predictions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_emails" ADD CONSTRAINT "contact_emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_lifecycle_history" ADD CONSTRAINT "contact_lifecycle_history_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_lifecycle_history" ADD CONSTRAINT "contact_lifecycle_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_lifecycle_history" ADD CONSTRAINT "contact_lifecycle_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_history" ADD CONSTRAINT "contact_merge_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_history" ADD CONSTRAINT "contact_merge_history_primary_contact_id_contacts_id_fk" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_history" ADD CONSTRAINT "contact_merge_history_merged_contact_id_contacts_id_fk" FOREIGN KEY ("merged_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_merge_history" ADD CONSTRAINT "contact_merge_history_merged_by_users_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_scores" ADD CONSTRAINT "contact_scores_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_scores" ADD CONSTRAINT "contact_scores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_original_owner_id_users_id_fk" FOREIGN KEY ("original_owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_keywords" ADD CONSTRAINT "conversation_keywords_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ADD CONSTRAINT "conversation_metrics_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_metrics" ADD CONSTRAINT "conversation_metrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_defs" ADD CONSTRAINT "custom_field_defs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_forecasts" ADD CONSTRAINT "deal_forecasts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_forecasts" ADD CONSTRAINT "deal_forecasts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_products" ADD CONSTRAINT "deal_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stages" ADD CONSTRAINT "deal_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_stage_id_deal_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."deal_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scoring_rules" ADD CONSTRAINT "lead_scoring_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scoring_rules" ADD CONSTRAINT "lead_scoring_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scoring_rules" ADD CONSTRAINT "lead_scoring_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scoring_rules" ADD CONSTRAINT "lead_scoring_rules_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_contact_id_contacts_id_fk" FOREIGN KEY ("converted_contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_health_metrics" ADD CONSTRAINT "pipeline_health_metrics_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_health_metrics" ADD CONSTRAINT "pipeline_health_metrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_book_entries" ADD CONSTRAINT "price_book_entries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_projections" ADD CONSTRAINT "revenue_projections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_email_drafts" ADD CONSTRAINT "ai_email_drafts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_email_drafts" ADD CONSTRAINT "ai_email_drafts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_email_drafts" ADD CONSTRAINT "ai_email_drafts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_email_drafts" ADD CONSTRAINT "ai_email_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_email_drafts" ADD CONSTRAINT "ai_email_drafts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_email_drafts" ADD CONSTRAINT "ai_email_drafts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tracking" ADD CONSTRAINT "email_tracking_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_tracking" ADD CONSTRAINT "email_tracking_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_warmup_configs" ADD CONSTRAINT "email_warmup_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_warmup_pool" ADD CONSTRAINT "email_warmup_pool_config_id_email_warmup_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."email_warmup_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_inbound_logs" ADD CONSTRAINT "webhook_inbound_logs_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_inbound_logs" ADD CONSTRAINT "webhook_inbound_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_module_configs" ADD CONSTRAINT "ai_module_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_aggregated" ADD CONSTRAINT "ai_usage_aggregated_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_workflows" ADD CONSTRAINT "automation_workflows_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_generations" ADD CONSTRAINT "content_generations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_generations" ADD CONSTRAINT "content_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_opportunities" ADD CONSTRAINT "revenue_opportunities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_logs" ADD CONSTRAINT "workflow_action_logs_execution_id_workflow_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_logs" ADD CONSTRAINT "workflow_action_logs_action_id_workflow_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."workflow_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_action_logs" ADD CONSTRAINT "workflow_action_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_workflow_execution_id_workflow_executions_id_fk" FOREIGN KEY ("workflow_execution_id") REFERENCES "public"."workflow_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_execution_logs" ADD CONSTRAINT "workflow_execution_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_usage_infra" ADD CONSTRAINT "api_key_usage_infra_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_records" ADD CONSTRAINT "backup_records_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critical_data_backups" ADD CONSTRAINT "critical_data_backups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critical_data_backups" ADD CONSTRAINT "critical_data_backups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "critical_data_backups" ADD CONSTRAINT "critical_data_backups_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_violations" ADD CONSTRAINT "limit_violations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_overrides" ADD CONSTRAINT "permission_overrides_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_executions" ADD CONSTRAINT "report_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_executions" ADD CONSTRAINT "report_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_forecast_summary" ADD CONSTRAINT "revenue_forecast_summary_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selective_restore_audit_log" ADD CONSTRAINT "selective_restore_audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selective_restore_audit_log" ADD CONSTRAINT "selective_restore_audit_log_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selective_restore_logs" ADD CONSTRAINT "selective_restore_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_providers" ADD CONSTRAINT "sso_providers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_sessions" ADD CONSTRAINT "sso_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_sessions" ADD CONSTRAINT "sso_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_sessions" ADD CONSTRAINT "sso_sessions_provider_id_sso_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sso_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_backups" ADD CONSTRAINT "tenant_backups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_restores" ADD CONSTRAINT "tenant_restores_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_restores" ADD CONSTRAINT "tenant_restores_backup_id_tenant_backups_id_fk" FOREIGN KEY ("backup_id") REFERENCES "public"."tenant_backups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_restores" ADD CONSTRAINT "tenant_restores_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_snapshots" ADD CONSTRAINT "usage_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departures" ADD CONSTRAINT "user_departures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departures" ADD CONSTRAINT "user_departures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departures" ADD CONSTRAINT "user_departures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departures" ADD CONSTRAINT "user_departures_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_departures" ADD CONSTRAINT "user_departures_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys_registry" ADD CONSTRAINT "api_keys_registry_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_anomalies" ADD CONSTRAINT "cost_anomalies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_anomalies" ADD CONSTRAINT "cost_anomalies_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_token_limits" ADD CONSTRAINT "tenant_token_limits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_token_limits" ADD CONSTRAINT "tenant_token_limits_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_alerts" ADD CONSTRAINT "usage_alerts_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_token_limits" ADD CONSTRAINT "user_token_limits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_token_limits" ADD CONSTRAINT "user_token_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failed_webhooks" ADD CONSTRAINT "failed_webhooks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_enrolled_by_users_id_fk" FOREIGN KEY ("enrolled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_step_logs" ADD CONSTRAINT "sequence_step_logs_enrollment_id_sequence_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."sequence_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_step_logs" ADD CONSTRAINT "sequence_step_logs_step_id_sequence_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_step_logs" ADD CONSTRAINT "sequence_step_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_members" ADD CONSTRAINT "segment_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_keys_tenant" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_metadata_g" ON "api_keys" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_tenant" ON "audit_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_metadata_g" ON "audit_logs" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_feature_registry_enabled" ON "feature_registry" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_field_permissions_unique" ON "field_permissions" USING btree ("tenant_id","role_id","entity_type","field_name");--> statement-breakpoint
CREATE INDEX "idx_impersonation_sessions_active" ON "impersonation_sessions" USING btree ("impersonator_id","started_at") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_invitations_tenant" ON "invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_tenant" ON "notifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_metadata_g" ON "notifications" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_record_permissions_entity" ON "record_permissions" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_record_permissions_role" ON "record_permissions" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE INDEX "idx_roles_tenant" ON "roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_roles_tenant_slug" ON "roles" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "idx_sessions_token" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_tenant_members_tenant" ON "tenant_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_members_user" ON "tenant_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tenant_members_tenant_user" ON "tenant_members" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_tenants_slug" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_tenants_subdomain" ON "tenants" USING btree ("subdomain");--> statement-breakpoint
CREATE INDEX "idx_tenants_metadata_g" ON "tenants" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_metadata_g" ON "users" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_users_active" ON "users" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_call_notes_contact" ON "call_notes" USING btree ("tenant_id","contact_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_call_notes_tenant" ON "call_notes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_call_recordings_tenant" ON "call_recordings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_churn_predictions_tenant" ON "churn_predictions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_churn_predictions_contact" ON "churn_predictions" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_companies_tenant" ON "companies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_companies_name" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_companies_metadata_g" ON "companies" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_companies_active" ON "companies" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contact_emails_contact" ON "contact_emails" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_contact_emails_unique" ON "contact_emails" USING btree ("contact_id","email");--> statement-breakpoint
CREATE INDEX "idx_contact_lifecycle_history_contact" ON "contact_lifecycle_history" USING btree ("contact_id","changed_at");--> statement-breakpoint
CREATE INDEX "idx_contact_lifecycle_history_tenant" ON "contact_lifecycle_history" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_contact_lifecycle_history_metadata_g" ON "contact_lifecycle_history" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_contact_merge_history_tenant" ON "contact_merge_history" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_contact_merge_history_primary" ON "contact_merge_history" USING btree ("primary_contact_id","merged_at");--> statement-breakpoint
CREATE INDEX "idx_contact_merge_history_merged" ON "contact_merge_history" USING btree ("merged_contact_id","merged_at");--> statement-breakpoint
CREATE INDEX "idx_contact_merge_history_metadata_g" ON "contact_merge_history" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_contact_scores_tenant" ON "contact_scores" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_contact_scores_contact" ON "contact_scores" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_tenant" ON "contacts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_company" ON "contacts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_contacts_email" ON "contacts" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "idx_contacts_tenant_status" ON "contacts" USING btree ("tenant_id","lead_status");--> statement-breakpoint
CREATE INDEX "idx_contacts_active" ON "contacts" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_contacts_metadata_g" ON "contacts" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_conv_keywords_tenant" ON "conversation_keywords" USING btree ("tenant_id","count");--> statement-breakpoint
CREATE INDEX "idx_conversation_keywords_tenant" ON "conversation_keywords" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_conv_metrics_contact" ON "conversation_metrics" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_metrics_tenant" ON "conversation_metrics" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_custom_fields_tenant_entity" ON "custom_field_defs" USING btree ("tenant_id","entity_type");--> statement-breakpoint
CREATE INDEX "idx_custom_fields_key" ON "custom_field_defs" USING btree ("field_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_custom_fields_unique_key" ON "custom_field_defs" USING btree ("tenant_id","entity_type","field_key");--> statement-breakpoint
CREATE INDEX "idx_deal_forecasts_deal" ON "deal_forecasts" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "idx_deal_forecasts_tenant" ON "deal_forecasts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_deal_products_deal" ON "deal_products" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "idx_deal_products_tenant" ON "deal_products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_deal_stages_pipeline" ON "deal_stages" USING btree ("pipeline_id");--> statement-breakpoint
CREATE INDEX "idx_deal_stages_metadata_g" ON "deal_stages" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_deals_tenant" ON "deals" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_deals_contact" ON "deals" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_deals_stage" ON "deals" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "idx_deals_active" ON "deals" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_deals_metadata_g" ON "deals" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_entity_tags_lookup" ON "entity_tags" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_entity_tags_tenant" ON "entity_tags" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_file_attachments_entity" ON "file_attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_file_attachments_tenant" ON "file_attachments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_form_submissions_form" ON "form_submissions" USING btree ("form_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_form_submissions_tenant" ON "form_submissions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_form_submissions_contact" ON "form_submissions" USING btree ("contact_id") WHERE contact_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_forms_tenant" ON "forms" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_forms_active" ON "forms" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_lead_activities_tenant" ON "lead_activities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_lead_activities_metadata_g" ON "lead_activities" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_lead_assignments_lead" ON "lead_assignments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_lead_assignments_user" ON "lead_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_lead_assignments_tenant" ON "lead_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_lead_scoring_rules_tenant" ON "lead_scoring_rules" USING btree ("tenant_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_lead_scoring_rules_active" ON "lead_scoring_rules" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_leads_tenant" ON "leads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_leads_email" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_leads_tenant_status" ON "leads" USING btree ("tenant_id","lead_status");--> statement-breakpoint
CREATE INDEX "idx_leads_metadata_g" ON "leads" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_leads_active" ON "leads" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_meetings_tenant" ON "meetings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_meetings_user" ON "meetings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_meetings_contact" ON "meetings" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_meetings_deal" ON "meetings" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "idx_meetings_status" ON "meetings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_meetings_start_time" ON "meetings" USING btree ("start_time");--> statement-breakpoint
CREATE INDEX "idx_meetings_active" ON "meetings" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_notes_entity" ON "notes" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_notes_tenant" ON "notes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_notes_active" ON "notes" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pipeline_health_unique" ON "pipeline_health_metrics" USING btree ("pipeline_id","metric_date");--> statement-breakpoint
CREATE INDEX "idx_pipeline_health_metrics_tenant" ON "pipeline_health_metrics" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_pipeline_stages_pipeline" ON "pipeline_stages" USING btree ("pipeline_id","order_val");--> statement-breakpoint
CREATE INDEX "idx_pipeline_stages_metadata_g" ON "pipeline_stages" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_pipelines_tenant" ON "pipelines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_pipelines_metadata_g" ON "pipelines" USING gin ("metadata");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_price_book_entries_unique" ON "price_book_entries" USING btree ("price_book_id","product_id");--> statement-breakpoint
CREATE INDEX "idx_price_books_tenant" ON "price_books" USING btree ("tenant_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_products_tenant" ON "products" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_products_metadata_g" ON "products" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_products_active" ON "products" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_quote_line_items_quote" ON "quote_line_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "idx_quotes_tenant" ON "quotes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_quotes_deal" ON "quotes" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "idx_quotes_metadata_g" ON "quotes" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_quotes_active" ON "quotes" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_rev_projections_tenant" ON "revenue_projections" USING btree ("tenant_id","period_start");--> statement-breakpoint
CREATE INDEX "idx_revenue_projections_tenant" ON "revenue_projections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_revenue_projections_metadata_g" ON "revenue_projections" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_tags_tenant" ON "tags" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tags_metadata_g" ON "tags" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_ai_email_drafts_tenant" ON "ai_email_drafts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_ai_email_drafts_metadata_g" ON "ai_email_drafts" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_call_logs_tenant" ON "call_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_call_logs_metadata_g" ON "call_logs" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_email_log_tenant" ON "email_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_email_log_contact" ON "email_log" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_email_log_status" ON "email_log" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_email_templates_tenant" ON "email_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_email_templates_metadata_g" ON "email_templates" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_email_templates_active" ON "email_templates" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_email_tracking_tenant" ON "email_tracking" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_email_tracking_metadata_g" ON "email_tracking" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_email_warmup_configs_tenant" ON "email_warmup_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_email_warmup_pool_config" ON "email_warmup_pool" USING btree ("config_id","status");--> statement-breakpoint
CREATE INDEX "idx_integrations_tenant_type" ON "integrations" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "idx_integrations_metadata_g" ON "integrations" USING btree ("config");--> statement-breakpoint
CREATE INDEX "idx_integrations_tenant" ON "integrations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_voice_calls_tenant" ON "voice_calls" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_voice_calls_metadata_g" ON "voice_calls" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_webhook_inbound_logs_webhook" ON "webhook_inbound_logs" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_inbound_logs_processed" ON "webhook_inbound_logs" USING btree ("processed") WHERE processed = false;--> statement-breakpoint
CREATE INDEX "idx_webhook_inbound_logs_tenant" ON "webhook_inbound_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_conversations_tenant" ON "whatsapp_conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_conv_contact" ON "whatsapp_conversations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_conversations_metadata_g" ON "whatsapp_conversations" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_conversations_active" ON "whatsapp_conversations" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_whatsapp_msg_conv" ON "whatsapp_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_messages_tenant" ON "whatsapp_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_messages_metadata_g" ON "whatsapp_messages" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_templates_tenant" ON "whatsapp_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_templates_unique" ON "whatsapp_templates" USING btree ("tenant_id","name","language");--> statement-breakpoint
CREATE INDEX "idx_ai_insights_tenant" ON "ai_insights" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_ai_insights_metadata_g" ON "ai_insights" USING gin ("metadata");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ai_module_config_unique" ON "ai_module_configs" USING btree ("tenant_id","module_name");--> statement-breakpoint
CREATE INDEX "idx_ai_module_configs_tenant" ON "ai_module_configs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_ai_module_config_gin" ON "ai_module_configs" USING btree ("config");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_tenant" ON "ai_usage_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_feature" ON "ai_usage_logs" USING btree ("tenant_id","feature","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_logs_metadata_g" ON "ai_usage_logs" USING gin ("metadata");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ai_usage_agg_unique" ON "ai_usage_aggregated" USING btree ("tenant_id","module_name","billing_period");--> statement-breakpoint
CREATE INDEX "idx_ai_usage_aggregated_tenant" ON "ai_usage_aggregated" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_automation_runs_automation" ON "automation_runs" USING btree ("automation_id");--> statement-breakpoint
CREATE INDEX "idx_automation_runs_tenant" ON "automation_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_automation_runs_status" ON "automation_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "idx_automation_runs_metadata_g" ON "automation_runs" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_automation_workflows_tenant" ON "automation_workflows" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_automation_workflows_active" ON "automation_workflows" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_automations_tenant" ON "automations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_automations_active" ON "automations" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_content_generations_tenant" ON "content_generations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_content_generations_metadata_g" ON "content_generations" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_revenue_opportunities_tenant" ON "revenue_opportunities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_revenue_opportunities_metadata_g" ON "revenue_opportunities" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_tenant" ON "webhook_deliveries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliv_payload_g" ON "webhook_deliveries" USING btree ("payload");--> statement-breakpoint
CREATE INDEX "idx_webhooks_tenant" ON "webhooks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_webhooks_metadata_g" ON "webhooks" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_workflow_action_logs_execution" ON "workflow_action_logs" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_action_logs_tenant" ON "workflow_action_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_actions_workflow" ON "workflow_actions" USING btree ("workflow_id","order_index");--> statement-breakpoint
CREATE INDEX "idx_workflow_actions_tenant" ON "workflow_actions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_execution_logs_execution" ON "workflow_execution_logs" USING btree ("workflow_execution_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_execution_logs_tenant" ON "workflow_execution_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_execution_logs_level" ON "workflow_execution_logs" USING btree ("level","created_at");--> statement-breakpoint
CREATE INDEX "idx_workflow_execution_logs_metadata_g" ON "workflow_execution_logs" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_workflow_executions_tenant" ON "workflow_executions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_executions_workflow" ON "workflow_executions" USING btree ("workflow_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_workflow_executions_metadata_g" ON "workflow_executions" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_workflows_tenant" ON "workflows" USING btree ("tenant_id") WHERE deleted_at IS NULL AND is_active = true;--> statement-breakpoint
CREATE INDEX "idx_workflows_metadata_g" ON "workflows" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_workflows_active" ON "workflows" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_activities_tenant" ON "activities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_activities_entity" ON "activities" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_activities_contact" ON "activities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_activities_deal" ON "activities" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "idx_activities_metadata_g" ON "activities" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_announcements_active_time" ON "announcements" USING btree ("is_active","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "idx_announcements_active" ON "announcements" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_api_key_usage_key" ON "api_key_usage_infra" USING btree ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_api_key_usage_infra_tenant" ON "api_key_usage_infra" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_backup_alerts_unresolved" ON "backup_alerts" USING btree ("resolved","created_at") WHERE resolved = false;--> statement-breakpoint
CREATE INDEX "idx_backup_records_status" ON "backup_records" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_backup_records_created" ON "backup_records" USING btree ("created_at") WHERE initiated_auto = true;--> statement-breakpoint
CREATE INDEX "idx_backup_records_expires" ON "backup_records" USING btree ("expires_at") WHERE status = 'completed';--> statement-breakpoint
CREATE INDEX "idx_backup_records_metadata_g" ON "backup_records" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_backup_schedules_tenant" ON "backup_schedules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_billing_events_tenant" ON "billing_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_billing_events_type" ON "billing_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_billing_events_stripe_event" ON "billing_events" USING btree ("stripe_event_id") WHERE stripe_event_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_billing_events_metadata_g" ON "billing_events" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_critical_backups_tenant" ON "critical_data_backups" USING btree ("tenant_id","table_name");--> statement-breakpoint
CREATE INDEX "idx_critical_backups_retain" ON "critical_data_backups" USING btree ("retained_until");--> statement-breakpoint
CREATE INDEX "idx_critical_backups_record" ON "critical_data_backups" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "idx_critical_backups_can_restore" ON "critical_data_backups" USING btree ("can_restore","backed_up_at");--> statement-breakpoint
CREATE INDEX "idx_dashboard_templates_active" ON "dashboard_templates" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_dashboards_tenant" ON "dashboards" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_dashboards_active" ON "dashboards" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_file_uploads_entity" ON "file_uploads" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_file_uploads_tenant" ON "file_uploads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_file_uploads_active" ON "file_uploads" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_health_checks_service" ON "health_checks" USING btree ("service","checked_at");--> statement-breakpoint
CREATE INDEX "idx_limit_violations_tenant" ON "limit_violations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_limit_violations_unresolved" ON "limit_violations" USING btree ("resolved","exceeded_at") WHERE resolved = false;--> statement-breakpoint
CREATE INDEX "idx_onboarding_tenant_user" ON "onboarding_progress" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_onboarding_step" ON "onboarding_progress" USING btree ("step_name","is_completed");--> statement-breakpoint
CREATE INDEX "idx_onboarding_progress_tenant" ON "onboarding_progress" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_permission_overrides_tenant" ON "permission_overrides" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_permission_overrides_role" ON "permission_overrides" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "idx_permission_overrides_entity" ON "permission_overrides" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_plans_name" ON "plans" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_plans_slug" ON "plans" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_plans_active" ON "plans" USING btree ("is_active","sort_order");--> statement-breakpoint
CREATE INDEX "idx_platform_settings_key" ON "platform_settings" USING btree ("key") WHERE key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_platform_settings_tenant" ON "platform_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_report_executions_tenant" ON "report_executions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_report_executions_metadata_g" ON "report_executions" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_report_templates_active" ON "report_templates" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_revenue_forecast_tenant_date" ON "revenue_forecast_summary" USING btree ("tenant_id","forecast_date");--> statement-breakpoint
CREATE INDEX "idx_revenue_forecast_summary_tenant" ON "revenue_forecast_summary" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_saved_reports_tenant" ON "saved_reports" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_selective_restore_audit_log_tenant" ON "selective_restore_audit_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_selective_restore_logs_tenant" ON "selective_restore_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sso_providers_tenant" ON "sso_providers" USING btree ("tenant_id") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "idx_sso_providers_active" ON "sso_providers" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_sso_sessions_user" ON "sso_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sso_sessions_id" ON "sso_sessions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "idx_sso_sessions_tenant" ON "sso_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_tenant" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_metadata_g" ON "subscriptions" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_super_admin_backups_name" ON "super_admin_backups" USING btree ("backup_name");--> statement-breakpoint
CREATE INDEX "idx_super_admin_backups_status" ON "super_admin_backups" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_tenant" ON "tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tasks_assigned" ON "tasks" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "idx_tasks_due" ON "tasks" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "idx_tasks_metadata_g" ON "tasks" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_tasks_active" ON "tasks" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_tenant_backups_tenant" ON "tenant_backups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_backups_metadata_g" ON "tenant_backups" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_tenant_restores_tenant" ON "tenant_restores" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_restores_metadata_g" ON "tenant_restores" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_usage_snapshots_tenant_date" ON "usage_snapshots" USING btree ("tenant_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_usage_snapshots_date" ON "usage_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "idx_usage_snapshots_tenant" ON "usage_snapshots" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_usage_snapshots_metadata_g" ON "usage_snapshots" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_user_departures_tenant" ON "user_departures" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_user_departures_user" ON "user_departures" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_departures_date" ON "user_departures" USING btree ("departure_date");--> statement-breakpoint
CREATE INDEX "idx_api_keys_reg_service" ON "api_keys_registry" USING btree ("service","is_active");--> statement-breakpoint
CREATE INDEX "idx_cost_anomalies_tenant" ON "cost_anomalies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_cost_anomalies_unreviewed" ON "cost_anomalies" USING btree ("reviewed");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_token_budgets_service_period" ON "token_budgets" USING btree ("service","billing_period");--> statement-breakpoint
CREATE INDEX "idx_token_budgets_service" ON "token_budgets" USING btree ("service","billing_period");--> statement-breakpoint
CREATE INDEX "idx_usage_alerts_target" ON "usage_alerts" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_usage_alerts_unacked" ON "usage_alerts" USING btree ("acknowledged");--> statement-breakpoint
CREATE INDEX "idx_user_token_limits_tenant" ON "user_token_limits" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_user_token_limits_unique" ON "user_token_limits" USING btree ("tenant_id","user_id","module");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_tenant_modules_unique" ON "tenant_modules" USING btree ("tenant_id","module_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_modules_tenant" ON "tenant_modules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_error_logs_tenant" ON "error_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_error_logs_user" ON "error_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_error_logs_level" ON "error_logs" USING btree ("level");--> statement-breakpoint
CREATE INDEX "idx_error_logs_resolved" ON "error_logs" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX "idx_error_logs_created" ON "error_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_failed_webhooks_tenant" ON "failed_webhooks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_failed_webhooks_webhook" ON "failed_webhooks" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_support_tickets_tenant" ON "support_tickets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_contact" ON "support_tickets" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_status" ON "support_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_support_tickets_metadata_g" ON "support_tickets" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_support_tickets_active" ON "support_tickets" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_ticket_replies_tenant" ON "ticket_replies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_replies_ticket" ON "ticket_replies" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "idx_sequence_enrollments_tenant" ON "sequence_enrollments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_seq_enroll_contact" ON "sequence_enrollments" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_seq_enroll_seq" ON "sequence_enrollments" USING btree ("sequence_id");--> statement-breakpoint
CREATE INDEX "idx_seq_enroll_status" ON "sequence_enrollments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sequence_enrollments_metadata_g" ON "sequence_enrollments" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_sequence_step_logs_enrollment" ON "sequence_step_logs" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "idx_sequence_step_logs_scheduled" ON "sequence_step_logs" USING btree ("scheduled_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "idx_sequence_step_logs_tenant" ON "sequence_step_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sequence_steps_seq" ON "sequence_steps" USING btree ("sequence_id","step_number");--> statement-breakpoint
CREATE INDEX "idx_sequence_steps_tenant" ON "sequence_steps" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sequences_tenant" ON "sequences" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sequences_metadata_g" ON "sequences" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "idx_sequences_active" ON "sequences" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_segment_members_pk" ON "segment_members" USING btree ("segment_id","entity_id");--> statement-breakpoint
CREATE INDEX "idx_segment_members_tenant" ON "segment_members" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_segments_tenant" ON "segments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_segments_metadata_g" ON "segments" USING gin ("metadata");