-- Revert 0071.
DROP TABLE IF EXISTS custom_entity_data;
DROP TABLE IF EXISTS custom_entities;

ALTER TABLE segment_members DROP COLUMN IF EXISTS id;

ALTER TABLE tenant_modules DROP COLUMN IF EXISTS force_enabled;
ALTER TABLE modules DROP COLUMN IF EXISTS is_available;

DROP INDEX IF EXISTS idx_meetings_external_id;
ALTER TABLE meetings DROP COLUMN IF EXISTS synced_at;
ALTER TABLE meetings DROP COLUMN IF EXISTS sync_direction;
ALTER TABLE meetings DROP COLUMN IF EXISTS sync_provider;
ALTER TABLE meetings DROP COLUMN IF EXISTS external_id;

ALTER TABLE lead_scoring_rules DROP COLUMN IF EXISTS sort_order;
ALTER TABLE lead_scoring_rules DROP COLUMN IF EXISTS active;
ALTER TABLE lead_scoring_rules DROP COLUMN IF EXISTS weight;
ALTER TABLE lead_scoring_rules DROP COLUMN IF EXISTS condition;
ALTER TABLE lead_scoring_rules DROP COLUMN IF EXISTS factor;

ALTER TABLE invitations DROP COLUMN IF EXISTS invited_by;

ALTER TABLE failed_webhooks DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE failed_webhooks DROP COLUMN IF EXISTS updated_at;

ALTER TABLE email_opens DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE email_opens DROP COLUMN IF EXISTS updated_at;
ALTER TABLE email_opens DROP COLUMN IF EXISTS created_at;
ALTER TABLE email_clicks DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE email_clicks DROP COLUMN IF EXISTS updated_at;
ALTER TABLE email_clicks DROP COLUMN IF EXISTS created_at;

ALTER TABLE ai_email_drafts DROP COLUMN IF EXISTS tokens_used;
ALTER TABLE ai_email_drafts DROP COLUMN IF EXISTS sent_at;
ALTER TABLE ai_email_drafts DROP COLUMN IF EXISTS model_used;
ALTER TABLE ai_email_drafts DROP COLUMN IF EXISTS length;
ALTER TABLE ai_email_drafts DROP COLUMN IF EXISTS is_sent;
