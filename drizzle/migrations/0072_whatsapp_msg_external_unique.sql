-- 0072: dedup + unique index on whatsapp_messages (tenant_id, external_id)
--
-- audit H-A: inbound WhatsApp webhooks are retried (BullMQ) and redelivered by
-- Meta on a 500, and external_id had no unique constraint, so the same provider
-- message id could be inserted multiple times (duplicate rows + inflated
-- conversation.message_count). The processor now checks for an existing row
-- before inserting; this index is the DB-level backstop.
--
-- First collapse any pre-existing duplicates (keep the earliest row per
-- tenant+external_id), then create a PARTIAL unique index so outbound rows that
-- have no external_id yet are not blocked.

DELETE FROM whatsapp_messages a
USING whatsapp_messages b
WHERE a.external_id IS NOT NULL
  AND a.external_id = b.external_id
  AND a.tenant_id = b.tenant_id
  AND a.created_at > b.created_at;

-- Tie-break on identical created_at: keep the smallest id.
DELETE FROM whatsapp_messages a
USING whatsapp_messages b
WHERE a.external_id IS NOT NULL
  AND a.external_id = b.external_id
  AND a.tenant_id = b.tenant_id
  AND a.created_at = b.created_at
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_msg_tenant_external
  ON whatsapp_messages (tenant_id, external_id)
  WHERE external_id IS NOT NULL;
