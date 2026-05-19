-- Workflow Execution Functions
-- Provides database-side workflow execution capability

DROP FUNCTION IF EXISTS execute_workflow(uuid, text, uuid);
DROP FUNCTION IF EXISTS get_workflow_execution(uuid);
DROP FUNCTION IF EXISTS update_workflow_execution(uuid, text, jsonb, text);

-- Function to execute a workflow and return execution ID
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

-- Function to get workflow execution status
CREATE FUNCTION get_workflow_execution(p_execution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_execution record;
BEGIN
  SELECT * INTO v_execution FROM workflow_executions WHERE id = p_execution_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Execution not found');
  END IF;

  RETURN jsonb_build_object(
    'id', v_execution.id,
    'workflow_id', v_execution.workflow_id,
    'status', v_execution.status,
    'contact_id', v_execution.contact_id,
    'lead_id', v_execution.lead_id,
    'started_at', v_execution.started_at,
    'completed_at', v_execution.completed_at,
    'output_data', v_execution.output_data,
    'error_message', v_execution.error_message
  );
END;
$$;

-- Update workflow execution status
CREATE FUNCTION update_workflow_execution(
  p_execution_id uuid,
  p_status text,
  p_output_data jsonb DEFAULT NULL,
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE workflow_executions SET
    status = p_status,
    output_data = p_output_data,
    error_message = p_error_message,
    completed_at = CASE WHEN p_status IN ('completed', 'failed') THEN NOW() ELSE NULL END
  WHERE id = p_execution_id;
END;
$$;