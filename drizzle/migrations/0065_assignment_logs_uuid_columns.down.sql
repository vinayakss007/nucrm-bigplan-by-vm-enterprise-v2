-- Revert assignment_logs: change rule_id, entity_id, assigned_to from uuid to text

DROP INDEX IF EXISTS idx_assignment_logs_rule;
DROP INDEX IF EXISTS idx_assignment_logs_entity;
DROP INDEX IF EXISTS idx_assignment_logs_assignee;

ALTER TABLE assignment_logs
  ALTER COLUMN rule_id TYPE text USING rule_id::text,
  ALTER COLUMN entity_id TYPE text USING entity_id::text,
  ALTER COLUMN assigned_to TYPE text USING assigned_to::text;

CREATE INDEX idx_assignment_logs_rule ON assignment_logs (tenant_id, rule_id);
CREATE INDEX idx_assignment_logs_entity ON assignment_logs (tenant_id, entity_type, entity_id);
CREATE INDEX idx_assignment_logs_assignee ON assignment_logs (tenant_id, assigned_to);
