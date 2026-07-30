-- Rollback 0001_perpetual_the_stranger: Drop email warmup tables
DROP TABLE IF EXISTS "email_warmup_participants" CASCADE;
DROP TABLE IF EXISTS "email_warmup_logs" CASCADE;
DROP TABLE IF EXISTS "email_warmup_configs" CASCADE;
