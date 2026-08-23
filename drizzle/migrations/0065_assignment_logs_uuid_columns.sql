-- Alter assignment_logs: change rule_id, entity_id, assigned_to from text to uuid
-- First drop dependent indexes, alter columns, then recreate indexes

-- Drop indexes that reference the columns being altered
DROP INDEX IF EXISTS idx_assignment_logs_rule;
DROP INDEX IF EXISTS idx_assignment_logs_entity;
DROP INDEX IF EXISTS idx_assignment_logs_assignee;

-- Cast text values to uuid (safe if all existing values are valid UUIDs)
ALTER TABLE assignment_logs
  ALTER COLUMN rule_id TYPE uuid USING rule_id::uuid,
  ALTER COLUMN entity_id TYPE uuid USING entity_id::uuid,
  ALTER COLUMN assigned_to TYPE uuid USING assigned_to::uuid;

-- Recreate indexes
CREATE INDEX idx_assignment_logs_rule ON assignment_logs (tenant_id, rule_id);
CREATE INDEX idx_assignment_logs_entity ON assignment_logs (tenant_id, entity_type, entity_id);
CREATE INDEX idx_assignment_logs_assignee ON assignment_logs (tenant_id, assigned_to);
