-- ═══════════════════════════════════════════════════════════════════════════
-- 0007_documents.sql
-- Adds the `documents` table for workspace file attachments.
-- See drizzle/schema/files.ts for the source-of-truth definition.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name                TEXT NOT NULL,
  storage_key         TEXT NOT NULL UNIQUE,
  mime_type           TEXT NOT NULL,
  size_bytes          BIGINT NOT NULL,
  description         TEXT,
  tags                TEXT[] DEFAULT '{}',

  linked_entity_type  TEXT,
  linked_entity_id    UUID,

  uploaded_by         UUID REFERENCES users(id) ON DELETE SET NULL,

  metadata            JSONB DEFAULT '{}'::jsonb,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_documents_tenant
  ON documents (tenant_id);

CREATE INDEX IF NOT EXISTS idx_documents_active
  ON documents (id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_metadata_g
  ON documents USING gin (metadata);

CREATE INDEX IF NOT EXISTS idx_documents_link
  ON documents (linked_entity_type, linked_entity_id);

CREATE INDEX IF NOT EXISTS idx_documents_uploader
  ON documents (uploaded_by);

COMMENT ON TABLE documents IS
  'Workspace file attachments. Bytes live in S3/R2 at storage_key.';
