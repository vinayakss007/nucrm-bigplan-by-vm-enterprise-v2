-- Migration 0010: Workflow foundation
-- Purpose:
--   1. Add leads.contact_id (one contact, many leads model), leads.lead_oid, leads.product_id
--   2. Backfill leads.contact_id from leads.converted_contact_id where present
--   3. Create lead_offers (track what the client was offered per lead)
--   4. Create ai_providers (super-admin allow-list) + tenant_ai_credentials (per-tenant BYO key)
-- Safe properties: additive only, idempotent (IF NOT EXISTS), no destructive ops.

-- ── 1. LEADS additions ────────────────────────────────────────────────────────
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_oid TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT;

-- Backfill contact_id from the legacy converted_contact_id wherever a lead is already
-- linked to a contact via the old conversion path. Idempotent: only updates rows
-- where contact_id is still null AND converted_contact_id is set.
UPDATE leads
   SET contact_id = converted_contact_id
 WHERE contact_id IS NULL
   AND converted_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_contact         ON leads (contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_oid      ON leads (tenant_id, lead_oid);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_product  ON leads (tenant_id, product_id);

COMMENT ON COLUMN leads.contact_id IS
  'The person this lead is linked to. One contact can have many leads. Set at intake; convert no longer creates the contact.';
COMMENT ON COLUMN leads.lead_oid IS
  'Human-readable per-tenant lead identifier, e.g. LD-2025-001.';
COMMENT ON COLUMN leads.product_id IS
  'Product entry the lead came in through (matches a key in lib/products/registry.ts).';

-- ── 2. LEAD_OFFERS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_offers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id       UUID NOT NULL REFERENCES leads(id)   ON DELETE CASCADE,
  service_id    UUID,                                       -- soft FK; services live in billing.ts
  product_id    TEXT,                                       -- pointer to lib/products/registry.ts key
  description   TEXT,
  quantity      NUMERIC(12, 2) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency      TEXT           NOT NULL DEFAULT 'USD',
  status        TEXT           NOT NULL DEFAULT 'proposed', -- proposed | accepted | rejected | withdrawn
  notes         TEXT,
  metadata      JSONB          NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_by    UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_offers_tenant         ON lead_offers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_lead_offers_lead           ON lead_offers (lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_offers_tenant_status  ON lead_offers (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_lead_offers_metadata_g     ON lead_offers USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_lead_offers_active         ON lead_offers (id) WHERE deleted_at IS NULL;

COMMENT ON TABLE lead_offers IS
  'What was offered to the client per lead. Carried into deals as line items on convert.';

-- ── 3. AI PROVIDERS (super-admin allow-list) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_providers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key        TEXT NOT NULL,
  display_name        TEXT NOT NULL,
  default_base_url    TEXT,
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  supports_streaming  BOOLEAN NOT NULL DEFAULT TRUE,
  allow_platform_key  BOOLEAN NOT NULL DEFAULT FALSE,
  rate_limits         JSONB   NOT NULL DEFAULT '{}'::jsonb,
  metadata            JSONB   NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_by          UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ai_providers_provider_key ON ai_providers (provider_key);
CREATE INDEX        IF NOT EXISTS idx_ai_providers_enabled       ON ai_providers (enabled);
CREATE INDEX        IF NOT EXISTS idx_ai_providers_metadata_g    ON ai_providers USING GIN (metadata);
CREATE INDEX        IF NOT EXISTS idx_ai_providers_active        ON ai_providers (id) WHERE deleted_at IS NULL;

COMMENT ON TABLE  ai_providers IS
  'Catalog of AI providers the platform supports. Super-admin maintains the enabled flag and rate caps.';
COMMENT ON COLUMN ai_providers.allow_platform_key IS
  'If FALSE, every tenant must BYO key and go through approval. If TRUE, the platform default key may be used.';

-- Seed the canonical 5 providers so the gateway has rows to look up out of the box.
-- Use ON CONFLICT to make this idempotent across re-runs.
INSERT INTO ai_providers (provider_key, display_name, default_base_url, supports_streaming, allow_platform_key)
VALUES
  ('openai',              'OpenAI',              'https://api.openai.com/v1',     TRUE,  FALSE),
  ('anthropic',           'Anthropic Claude',    'https://api.anthropic.com/v1',  TRUE,  FALSE),
  ('groq',                'Groq',                'https://api.groq.com/openai/v1',TRUE,  FALSE),
  ('mistral',             'Mistral',             'https://api.mistral.ai/v1',    TRUE,  FALSE),
  ('ollama',              'Ollama (self-host)',  'http://localhost:11434/v1',     TRUE,  FALSE),
  ('openai-compatible',   'OpenAI-compatible',   NULL,                             TRUE,  FALSE)
ON CONFLICT (provider_key) DO NOTHING;

-- ── 4. TENANT AI CREDENTIALS (per-tenant BYO key + approval) ──────────────────
CREATE TABLE IF NOT EXISTS tenant_ai_credentials (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  provider_id         UUID NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  model               TEXT NOT NULL,
  encrypted_api_key   TEXT NOT NULL,
  base_url_override   TEXT,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | revoked
  decision_reason     TEXT,
  approved_by         UUID,
  approved_at         TIMESTAMPTZ,
  fallback_chain      JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_used_at        TIMESTAMPTZ,
  call_count          INTEGER NOT NULL DEFAULT 0,
  error_count         INTEGER NOT NULL DEFAULT 0,
  metadata            JSONB   NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_by          UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tenant_ai_credentials_tenant            ON tenant_ai_credentials (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_ai_credentials_provider          ON tenant_ai_credentials (provider_id);
CREATE INDEX IF NOT EXISTS idx_tenant_ai_credentials_tenant_status     ON tenant_ai_credentials (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tenant_ai_credentials_metadata_g        ON tenant_ai_credentials USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_tenant_ai_credentials_active            ON tenant_ai_credentials (id) WHERE deleted_at IS NULL;

-- One row per (tenant, provider, status) — keeps approval history while preventing
-- duplicate live credentials. Tenants rotating keys should set the old row to 'revoked'.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_tenant_ai_credential_active
  ON tenant_ai_credentials (tenant_id, provider_id, status);

COMMENT ON TABLE  tenant_ai_credentials IS
  'Per-tenant BYO API key + chosen model. Must be approved by super-admin before the gateway will call it.';
COMMENT ON COLUMN tenant_ai_credentials.encrypted_api_key IS
  'AES-GCM encrypted key. Never store plaintext. Decrypted by lib/crypto/secrets.ts inside the gateway only.';
COMMENT ON COLUMN tenant_ai_credentials.fallback_chain IS
  'JSON array of provider_keys in priority order. Used by the gateway on transient failures.';
