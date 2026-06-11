-- Migration: Remaining tables from schema registry not in any prior migration
-- Tables: ai_provider_secrets, chat_sessions, chat_messages, dashboard_layouts,
--         exchange_rates, kb_categories, kb_articles, milestones, project_tasks,
--         projects, tax_rates

-- 1. ai_provider_secrets (ai.ts)
CREATE TABLE IF NOT EXISTS ai_provider_secrets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    provider text NOT NULL,
    encrypted_key text NOT NULL,
    key_prefix text,
    base_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    rotated_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_secrets_tenant ON ai_provider_secrets(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_provider_secrets_unique ON ai_provider_secrets(tenant_id, provider) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_provider_secrets_active ON ai_provider_secrets(id) WHERE deleted_at IS NULL;

-- 2. chat_sessions (chat.ts)
CREATE TABLE IF NOT EXISTS chat_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    visitor_id text NOT NULL,
    visitor_name text,
    visitor_email text,
    assigned_to uuid,
    status text NOT NULL DEFAULT 'waiting',
    channel text DEFAULT 'web',
    converted_lead_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_tenant ON chat_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_visitor ON chat_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_assigned ON chat_sessions(assigned_to);

-- 3. chat_messages (chat.ts)
CREATE TABLE IF NOT EXISTS chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    sender_type text NOT NULL,
    sender_id text,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_tenant ON chat_messages(tenant_id);

-- 4. dashboard_layouts (dashboard.ts)
CREATE TABLE IF NOT EXISTS dashboard_layouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    user_id uuid,
    name text NOT NULL DEFAULT 'Default',
    layout jsonb NOT NULL DEFAULT '[]',
    is_default boolean DEFAULT false,
    source text NOT NULL DEFAULT 'user',
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_dashboard_layouts_tenant ON dashboard_layouts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_layouts_user_default ON dashboard_layouts(user_id, is_default);

-- 5. exchange_rates (financial.ts)
CREATE TABLE IF NOT EXISTS exchange_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    base_currency text NOT NULL,
    target_currency text NOT NULL,
    rate numeric(16, 8) NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL DEFAULT 'exchangerate-api',
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair ON exchange_rates(base_currency, target_currency);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_fetched ON exchange_rates(fetched_at);

-- 6. kb_categories (knowledge.ts)
CREATE TABLE IF NOT EXISTS kb_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    icon text DEFAULT 'Book',
    "order" integer DEFAULT 0,
    parent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_kb_categories_tenant ON kb_categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_categories_active ON kb_categories(id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_kb_categories_slug ON kb_categories(tenant_id, slug);

-- 7. kb_articles (knowledge.ts)
CREATE TABLE IF NOT EXISTS kb_articles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    category_id uuid,
    title text NOT NULL,
    slug text NOT NULL,
    content text NOT NULL,
    excerpt text,
    status text NOT NULL DEFAULT 'draft',
    views integer DEFAULT 0,
    helpful integer DEFAULT 0,
    not_helpful integer DEFAULT 0,
    tags text[] DEFAULT '{}',
    metadata jsonb DEFAULT '{}',
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid,
    published_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_kb_articles_tenant ON kb_articles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON kb_articles(category_id);
CREATE INDEX IF NOT EXISTS idx_kb_articles_status ON kb_articles(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_kb_articles_slug ON kb_articles(tenant_id, slug);
CREATE INDEX IF NOT EXISTS idx_kb_articles_metadata_g ON kb_articles USING gin (metadata);
CREATE INDEX IF NOT EXISTS idx_kb_articles_active ON kb_articles(id) WHERE deleted_at IS NULL;

-- 8. projects (projects.ts)
CREATE TABLE IF NOT EXISTS projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'active',
    start_date date,
    end_date date,
    owner_id uuid,
    metadata jsonb DEFAULT '{}',
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(id) WHERE deleted_at IS NULL;

-- 9. milestones (projects.ts)
CREATE TABLE IF NOT EXISTS milestones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL,
    due_date date,
    completed boolean DEFAULT false,
    completed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}',
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_milestones_tenant ON milestones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);

-- 10. project_tasks (projects.ts)
CREATE TABLE IF NOT EXISTS project_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now(),
    added_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_tasks_unique ON project_tasks(project_id, task_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_tenant ON project_tasks(tenant_id);

-- 11. tax_rates (financial.ts)
CREATE TABLE IF NOT EXISTS tax_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    rate numeric(8, 4) NOT NULL,
    type text NOT NULL DEFAULT 'percentage',
    country text,
    state text,
    is_default boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_tax_rates_tenant ON tax_rates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tax_rates_region ON tax_rates(country, state);
CREATE INDEX IF NOT EXISTS idx_tax_rates_active ON tax_rates(tenant_id, is_active);

-- FK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_provider_secrets_created_by_users_id_fk') THEN
    ALTER TABLE ai_provider_secrets ADD CONSTRAINT ai_provider_secrets_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_sessions_assigned_to_users_id_fk') THEN
    ALTER TABLE chat_sessions ADD CONSTRAINT chat_sessions_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_session_id_chat_sessions_id_fk') THEN
    ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_session_id_chat_sessions_id_fk FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_layouts_user_id_users_id_fk') THEN
    ALTER TABLE dashboard_layouts ADD CONSTRAINT dashboard_layouts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_articles_category_id_kb_categories_id_fk') THEN
    ALTER TABLE kb_articles ADD CONSTRAINT kb_articles_category_id_kb_categories_id_fk FOREIGN KEY (category_id) REFERENCES kb_categories(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_owner_id_users_id_fk') THEN
    ALTER TABLE projects ADD CONSTRAINT projects_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestones_project_id_projects_id_fk') THEN
    ALTER TABLE milestones ADD CONSTRAINT milestones_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_tasks_project_id_projects_id_fk') THEN
    ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_tasks_task_id_tasks_id_fk') THEN
    ALTER TABLE project_tasks ADD CONSTRAINT project_tasks_task_id_tasks_id_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
  END IF;
END $$;
