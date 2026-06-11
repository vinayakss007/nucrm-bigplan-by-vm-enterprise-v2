-- Migration: Tokens group tables (oauth_clients, oauth_codes, oauth_tokens, portal_clients)

CREATE TABLE IF NOT EXISTS "oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);

CREATE TABLE IF NOT EXISTS "oauth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"user_id" uuid,
	"code" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "oauth_codes_code_unique" UNIQUE("code")
);

CREATE TABLE IF NOT EXISTS "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"user_id" uuid,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"scope" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "oauth_tokens_access_token_unique" UNIQUE("access_token"),
	CONSTRAINT "oauth_tokens_refresh_token_unique" UNIQUE("refresh_token")
);

CREATE TABLE IF NOT EXISTS "portal_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"access_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true,
	"last_login_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "portal_clients_access_token_unique" UNIQUE("access_token")
);

-- FK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_clients_tenant_id_tenants_id_fk') THEN
    ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_clients_created_by_users_id_fk') THEN
    ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_codes_client_id_oauth_clients_id_fk') THEN
    ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_codes_user_id_users_id_fk') THEN
    ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_tokens_client_id_oauth_clients_id_fk') THEN
    ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'oauth_tokens_user_id_users_id_fk') THEN
    ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_clients_created_by_users_id_fk') THEN
    ALTER TABLE "portal_clients" ADD CONSTRAINT "portal_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "idx_oauth_clients_client_id" ON "oauth_clients" USING btree ("client_id");
CREATE INDEX IF NOT EXISTS "idx_oauth_clients_tenant" ON "oauth_clients" USING btree ("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_oauth_codes_code" ON "oauth_codes" USING btree ("code");
CREATE INDEX IF NOT EXISTS "idx_oauth_codes_client" ON "oauth_codes" USING btree ("client_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_oauth_tokens_access" ON "oauth_tokens" USING btree ("access_token");
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_refresh" ON "oauth_tokens" USING btree ("refresh_token");
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_client" ON "oauth_tokens" USING btree ("client_id");
CREATE INDEX IF NOT EXISTS "idx_oauth_tokens_user" ON "oauth_tokens" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "idx_portal_clients_tenant" ON "portal_clients" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_portal_clients_email" ON "portal_clients" USING btree ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_portal_clients_token" ON "portal_clients" USING btree ("access_token");
