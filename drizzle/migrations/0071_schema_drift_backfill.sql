-- 0071: backfill columns/tables declared in the Drizzle schema but never
--       created by any migration (schema drift).
--
-- A full column-level audit (getTableColumns() from drizzle/schema vs
-- information_schema.columns on a freshly migrated DB) found 26 missing
-- columns across 10 tables plus 2 entirely missing tables. Every query the
-- app issues is built from the Drizzle schema, so each of these drifts is a
-- latent runtime failure (42703 undefined_column / 42P01 undefined_table) for
-- the feature that touches it — e.g. seed-dev and the modules/SLA/lead-scoring/
-- calendar-sync/custom-entities features. All statements are IF NOT EXISTS so
-- this is a no-op on databases already provisioned to the live schema
-- (db:push/db:sync) and safe to re-run.

-- ── ai_email_drafts (automation.ts) ──────────────────────────────────────────
ALTER TABLE ai_email_drafts ADD COLUMN IF NOT EXISTS is_sent boolean NOT NULL DEFAULT false;
ALTER TABLE ai_email_drafts ADD COLUMN IF NOT EXISTS length text DEFAULT 'medium';
ALTER TABLE ai_email_drafts ADD COLUMN IF NOT EXISTS model_used text;
ALTER TABLE ai_email_drafts ADD COLUMN IF NOT EXISTS sent_at timestamp with time zone;
ALTER TABLE ai_email_drafts ADD COLUMN IF NOT EXISTS tokens_used integer;

-- ── email_clicks / email_opens (email-tracking.ts, ...utils.lifecycle()) ──────
ALTER TABLE email_clicks ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE email_clicks ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE email_clicks ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;
ALTER TABLE email_opens ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT now();
ALTER TABLE email_opens ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE email_opens ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

-- ── failed_webhooks (support.ts) ─────────────────────────────────────────────
ALTER TABLE failed_webhooks ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE failed_webhooks ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

-- ── invitations (core.ts) ────────────────────────────────────────────────────
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- ── lead_scoring_rules (ai.ts) ───────────────────────────────────────────────
-- factor is NOT NULL in the schema; add with a default so the ALTER succeeds on
-- tables that already contain rows, matching how the app always supplies it.
ALTER TABLE lead_scoring_rules ADD COLUMN IF NOT EXISTS factor text NOT NULL DEFAULT '';
ALTER TABLE lead_scoring_rules ADD COLUMN IF NOT EXISTS condition text;
ALTER TABLE lead_scoring_rules ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 10;
ALTER TABLE lead_scoring_rules ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE lead_scoring_rules ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- ── meetings (crm.ts) — calendar sync ────────────────────────────────────────
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS sync_provider text;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS sync_direction text;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS synced_at timestamp with time zone;
CREATE INDEX IF NOT EXISTS idx_meetings_external_id ON meetings (external_id);

-- ── modules / tenant_modules (modules.ts) ────────────────────────────────────
ALTER TABLE modules ADD COLUMN IF NOT EXISTS is_available boolean DEFAULT false;
ALTER TABLE tenant_modules ADD COLUMN IF NOT EXISTS force_enabled boolean DEFAULT false;

-- ── segment_members (segments.ts) — missing surrogate PK ─────────────────────
ALTER TABLE segment_members ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

-- ── custom_entities / custom_entity_data (custom-entities.ts) — missing tables ─
CREATE TABLE IF NOT EXISTS custom_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  icon text,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_custom_entities_tenant ON custom_entities (tenant_id);
CREATE INDEX IF NOT EXISTS idx_custom_entities_slug ON custom_entities (tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_custom_entities_active ON custom_entities (id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS custom_entity_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES custom_entities(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  deleted_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_custom_entity_data_tenant ON custom_entity_data (tenant_id);
CREATE INDEX IF NOT EXISTS idx_custom_entity_data_entity ON custom_entity_data (tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_custom_entity_data_gin ON custom_entity_data USING gin (data);
