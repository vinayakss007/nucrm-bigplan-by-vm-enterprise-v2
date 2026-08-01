-- Rollback 0040_missing_ai_tables: Drop AI tables added in this migration
DROP TABLE IF EXISTS "ai_conversations" CASCADE;
DROP TABLE IF EXISTS "ai_messages" CASCADE;
DROP TABLE IF EXISTS "ai_embeddings" CASCADE;
