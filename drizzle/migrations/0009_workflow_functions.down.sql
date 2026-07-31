-- Rollback 0038_workflow_functions: Drop workflow execution functions
DROP FUNCTION IF EXISTS execute_workflow(uuid, text, uuid);
DROP FUNCTION IF EXISTS get_workflow_execution(uuid);
DROP FUNCTION IF EXISTS update_workflow_execution(uuid, text, jsonb, text);
