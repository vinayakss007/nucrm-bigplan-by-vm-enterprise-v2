-- Migration: Add missing AI gateway tables
-- Tables: ai_activity, ai_draft_templates, at_risk_rules, comm_email_drafts

-- 1. ai_activity — per-gateway-call audit log
CREATE TABLE IF NOT EXISTS ai_activity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action text NOT NULL,
    provider text NOT NULL,
    model text,
    status text NOT NULL DEFAULT 'success',
    tokens_in integer DEFAULT 0,
    tokens_out integer DEFAULT 0,
    tokens_used integer DEFAULT 0,
    cost_cents bigint DEFAULT 0,
    latency_ms integer,
    entity_type text,
    entity_id uuid,
    error_message text,
    accepted boolean,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_ai_activity_tenant_time ON ai_activity(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_activity_action ON ai_activity(tenant_id, action, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_activity_user ON ai_activity(tenant_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_activity_status ON ai_activity(tenant_id, status);

-- 2. ai_draft_templates — per-tenant auto-draft prompt templates
CREATE TABLE IF NOT EXISTS ai_draft_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    kind text NOT NULL DEFAULT 'email',
    entity_types text NOT NULL DEFAULT 'contact,deal',
    system_prompt text NOT NULL,
    user_prompt text NOT NULL,
    tone text DEFAULT 'professional',
    default_subject text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_draft_templates_tenant ON ai_draft_templates(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_draft_templates_slug ON ai_draft_templates(tenant_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_draft_templates_kind ON ai_draft_templates(tenant_id, kind, active);

-- 3. at_risk_rules — per-tenant deal risk detection rules
CREATE TABLE IF NOT EXISTS at_risk_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    stage_id uuid REFERENCES deal_stages(id) ON DELETE CASCADE,
    max_days_idle integer NOT NULL DEFAULT 14,
    max_days_in_stage integer,
    sentiment_threshold integer DEFAULT 30,
    description text,
    active boolean NOT NULL DEFAULT true,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    created_by uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_at_risk_rules_tenant ON at_risk_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_at_risk_rules_stage ON at_risk_rules(tenant_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_at_risk_rules_active ON at_risk_rules(tenant_id, active) WHERE deleted_at IS NULL;

-- 4. comm_email_drafts — communication email drafts table
CREATE TABLE IF NOT EXISTS comm_email_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
    deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
    subject text,
    body text NOT NULL,
    tone text DEFAULT 'professional',
    template_id uuid,
    status text NOT NULL DEFAULT 'draft',
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_comm_email_drafts_tenant ON comm_email_drafts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_comm_email_drafts_user ON comm_email_drafts(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_comm_email_drafts_status ON comm_email_drafts(tenant_id, status);
