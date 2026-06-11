-- Schema drift fixes: columns defined in Drizzle schema but missing from database tables
-- Generated from comparison of drizzle/schema/*.ts vs actual PostgreSQL columns

-- crm.ts: deals → stage_entered_at
ALTER TABLE "deals" ADD COLUMN IF NOT EXISTS "stage_entered_at" timestamp with time zone DEFAULT now();

-- modules.ts: modules → is_available
ALTER TABLE "modules" ADD COLUMN IF NOT EXISTS "is_available" text DEFAULT 'false';

-- modules.ts: tenant_modules → force_enabled
ALTER TABLE "tenant_modules" ADD COLUMN IF NOT EXISTS "force_enabled" boolean DEFAULT false;

-- core.ts: invitations → invited_by
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
