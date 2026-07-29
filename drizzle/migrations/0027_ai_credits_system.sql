-- AI Credits System: centralized tenant credit pools + ledger
-- Adds is_centralized flag to ai_provider_secrets, creates
-- tenant_ai_credits and ai_credits_ledger tables.

-- 1. Add is_centralized flag to ai_provider_secrets
ALTER TABLE ai_provider_secrets ADD COLUMN is_centralized boolean NOT NULL DEFAULT false;

-- 2. Tenant AI credit balances (one row per tenant per billing period)
CREATE TABLE tenant_ai_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  allocated_tokens bigint NOT NULL DEFAULT 0,
  used_tokens bigint NOT NULL DEFAULT 0,
  allocated_cost_cents bigint NOT NULL DEFAULT 0,
  used_cost_cents bigint NOT NULL DEFAULT 0,
  billing_period text NOT NULL,
  hard_cap_enabled boolean NOT NULL DEFAULT true,
  soft_cap_pct integer DEFAULT 80,
  status text NOT NULL DEFAULT 'active',
  allocation_notes text,
  set_by uuid REFERENCES users(id) ON DELETE SET NULL,
  allocated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (tenant_id, billing_period)
);

CREATE INDEX idx_tenant_ai_credits_tenant ON tenant_ai_credits (tenant_id);
CREATE INDEX idx_tenant_ai_credits_period ON tenant_ai_credits (tenant_id, billing_period);
CREATE INDEX idx_tenant_ai_credits_status ON tenant_ai_credits (status);

-- 3. AI credits ledger (per-call deduction log)
CREATE TABLE ai_credits_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  provider text NOT NULL,
  model text,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  tokens_used integer NOT NULL DEFAULT 0,
  cost_cents bigint NOT NULL DEFAULT 0,
  balance_after_tokens bigint,
  balance_after_cost_cents bigint,
  activity_id uuid,
  billing_period text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_credits_ledger_tenant ON ai_credits_ledger (tenant_id, created_at);
CREATE INDEX idx_ai_credits_ledger_user ON ai_credits_ledger (tenant_id, user_id, created_at);
CREATE INDEX idx_ai_credits_ledger_period ON ai_credits_ledger (tenant_id, billing_period);
CREATE INDEX idx_ai_credits_ledger_activity ON ai_credits_ledger (activity_id);
