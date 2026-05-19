DROP FUNCTION IF EXISTS execute_workflow(uuid, text, uuid);

CREATE FUNCTION execute_workflow(
  p_workflow_id uuid,
  p_trigger_type text,
  p_trigger_entity_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_execution_id uuid;
  v_workflow_id uuid;
  v_tenant_id uuid;
BEGIN
  SELECT id, tenant_id INTO v_workflow_id, v_tenant_id FROM workflows WHERE id = p_workflow_id AND deleted_at IS NULL;
  
  IF v_workflow_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_trigger_type = 'contact' THEN
    INSERT INTO workflow_executions (id, workflow_id, tenant_id, status, contact_id, input_data, started_at)
    VALUES (gen_random_uuid(), p_workflow_id, v_tenant_id, 'running', p_trigger_entity_id, jsonb_build_object('trigger_type', p_trigger_type), NOW())
    RETURNING id INTO v_execution_id;
  ELSIF p_trigger_type = 'lead' THEN
    INSERT INTO workflow_executions (id, workflow_id, tenant_id, status, lead_id, input_data, started_at)
    VALUES (gen_random_uuid(), p_workflow_id, v_tenant_id, 'running', p_trigger_entity_id, jsonb_build_object('trigger_type', p_trigger_type), NOW())
    RETURNING id INTO v_execution_id;
  ELSE
    INSERT INTO workflow_executions (id, workflow_id, tenant_id, status, input_data, started_at)
    VALUES (gen_random_uuid(), p_workflow_id, v_tenant_id, 'running', jsonb_build_object('trigger_type', p_trigger_type, 'entity_id', p_trigger_entity_id), NOW())
    RETURNING id INTO v_execution_id;
  END IF;

  RETURN v_execution_id;
END;
$$;
