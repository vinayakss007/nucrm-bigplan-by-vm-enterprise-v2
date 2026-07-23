--
-- PostgreSQL database dump
--

\restrict BAgfY31P0qQ72qAqzLf2e6bBnJReSFZJ3jzBrVtPvt9yBrMBnG35kQGBi1bifLp

-- Dumped from database version 15.18 (Debian 15.18-0+deb12u1)
-- Dumped by pg_dump version 15.18 (Debian 15.18-0+deb12u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: calculate_churn_risk(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_churn_risk(p_contact_id uuid) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN 0.1;
END;
$$;


--
-- Name: calculate_deal_win_probability(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_deal_win_probability(p_deal_id uuid) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE v_prob numeric;
BEGIN
  SELECT COALESCE(
    CASE 
      WHEN stage.probability IS NOT NULL THEN stage.probability
      WHEN d.value > 0 AND d.value < 10000 THEN 0.3
      WHEN d.value >= 10000 AND d.value < 50000 THEN 0.5
      WHEN d.value >= 50000 THEN 0.7
      ELSE 0.1
    END, 0.1)
  INTO v_prob
  FROM deals d
  LEFT JOIN deal_stages stage ON stage.id = d.stage_id
  WHERE d.id = p_deal_id;
  RETURN COALESCE(v_prob, 0.1);
END;
$$;


--
-- Name: calculate_sequence_step_date(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_sequence_step_date(p_sequence_id uuid, p_step_number integer) RETURNS timestamp with time zone
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN NOW() + interval '1 day';
END;
$$;


--
-- Name: cleanup_old_login_attempts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_login_attempts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '30 days';
  DELETE FROM login_blocks WHERE blocked_until < NOW();
  RETURN NEW;
END;
$$;


--
-- Name: end_impersonation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.end_impersonation(p_session_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM sessions WHERE id = p_session_id AND is_impersonation = true;
END;
$$;


--
-- Name: enroll_contact_in_sequence(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enroll_contact_in_sequence(p_sequence_id uuid, p_contact_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO sequence_enrollments (id, sequence_id, contact_id, status, enrolled_at)
  VALUES (gen_random_uuid(), p_sequence_id, p_contact_id, 'active', NOW());
  RETURN gen_random_uuid();
END;
$$;


--
-- Name: execute_saved_report(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.execute_saved_report(p_report_id uuid, p_user_id uuid, p_source text, p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE v_result jsonb;
BEGIN
  v_result := jsonb_build_object('rows', '[]'::jsonb, 'total', 0, 'page', 1);
  RETURN v_result;
END;
$$;


--
-- Name: execute_workflow(uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.execute_workflow(p_workflow_id uuid, p_trigger_type text, p_trigger_entity_id uuid) RETURNS uuid
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


--
-- Name: find_duplicate_contacts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_duplicate_contacts(p_tenant_id uuid) RETURNS TABLE(contact_id uuid, duplicate_id uuid, field text, value text)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY SELECT c1.id, c2.id, 'email'::text, COALESCE(c1.email, '') 
  FROM contacts c1 JOIN contacts c2 ON c1.email = c2.email AND c1.id < c2.id
  WHERE c1.tenant_id = p_tenant_id AND c1.email IS NOT NULL AND c1.deleted_at IS NULL AND c2.deleted_at IS NULL;
END;
$$;


--
-- Name: get_workflow_execution(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_workflow_execution(p_execution_id uuid) RETURNS jsonb
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


--
-- Name: merge_contacts(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_contacts(p_primary_id uuid, p_secondary_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE deals SET contact_id = p_primary_id WHERE contact_id = p_secondary_id;
  UPDATE activities SET contact_id = p_primary_id WHERE contact_id = p_secondary_id;
  UPDATE notes SET contact_id = p_primary_id WHERE contact_id = p_secondary_id;
  UPDATE tasks SET contact_id = p_primary_id WHERE contact_id = p_secondary_id;
  DELETE FROM contacts WHERE id = p_secondary_id;
END;
$$;


--
-- Name: platform_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.platform_stats() RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'mrr', COALESCE((
      SELECT SUM(p.price_monthly::numeric)
      FROM tenants t
      JOIN plans p ON p.id = t.plan_id
      WHERE t.status = 'active' AND t.deleted_at IS NULL
    ), 0),
    'active_tenants', COALESCE((
      SELECT COUNT(*)::int
      FROM tenants
      WHERE status = 'active' AND deleted_at IS NULL
    ), 0),
    'trialing', COALESCE((
      SELECT COUNT(*)::int
      FROM tenants
      WHERE status = 'trialing' AND deleted_at IS NULL
    ), 0),
    'total_users', COALESCE((
      SELECT COUNT(*)::int
      FROM users
      WHERE deleted_at IS NULL
    ), 0),
    'unresolved_errors', COALESCE((
      SELECT COUNT(*)::int
      FROM error_logs
      WHERE resolved = false
    ), 0)
  ) INTO result;
  RETURN result;
END;
$$;


--
-- Name: purge_trash(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_trash() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE v_count int;
BEGIN
  v_count := 0;
  DELETE FROM contacts WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - interval '30 days';
  v_count := v_count + 1;
  DELETE FROM deals WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - interval '30 days';
  v_count := v_count + 1;
  DELETE FROM companies WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - interval '30 days';
  v_count := v_count + 1;
  DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - interval '30 days';
  v_count := v_count + 1;
  RETURN v_count;
END;
$$;


--
-- Name: register_feature(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_feature(p_name text, p_description text, p_version text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO feature_flags (name, description, version, enabled) 
  VALUES (p_name, p_description, p_version, false) 
  ON CONFLICT (name) DO NOTHING;
END;
$$;


--
-- Name: snapshot_tenant_usage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.snapshot_tenant_usage() RETURNS integer
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO usage_snapshots (tenant_id, user_count, contact_count, deal_count, storage_bytes, period_start, period_end)
  SELECT t.id, 
    (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND deleted_at IS NULL),
    (SELECT COUNT(*) FROM contacts WHERE tenant_id = t.id AND deleted_at IS NULL),
    (SELECT COUNT(*) FROM deals WHERE tenant_id = t.id AND deleted_at IS NULL),
    0::bigint,
    date_trunc('month', NOW()),
    date_trunc('month', NOW()) + interval '1 month'
  FROM tenants t WHERE t.deleted_at IS NULL
  ON CONFLICT (tenant_id, period_start) DO NOTHING;
  RETURN 1;
END;
$$;


--
-- Name: start_impersonation(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.start_impersonation(p_target_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE v_session_id uuid;
BEGIN
  v_session_id := gen_random_uuid();
  INSERT INTO sessions (id, user_id, token_hash, expires_at, is_impersonation, original_user_id)
  VALUES (v_session_id, p_target_user_id, 'impersonation', NOW() + interval '1 hour', true, p_target_user_id);
  RETURN v_session_id;
END;
$$;


--
-- Name: update_contact_lifecycle(uuid, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_contact_lifecycle(p_contact_id uuid, p_stage text, p_user_id uuid, p_reason text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE contacts SET lifecycle_stage = p_stage, updated_at = NOW() WHERE id = p_contact_id;
  INSERT INTO contact_lifecycle_events (contact_id, from_stage, to_stage, changed_by, reason, changed_at)
  VALUES (p_contact_id, (SELECT lifecycle_stage FROM contacts WHERE id = p_contact_id), p_stage, p_user_id, p_reason, NOW());
END;
$$;


--
-- Name: update_workflow_execution(uuid, text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_workflow_execution(p_execution_id uuid, p_status text, p_output_data jsonb DEFAULT NULL::jsonb, p_error_message text DEFAULT NULL::text) RETURNS void
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: __drizzle_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint NOT NULL
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.__drizzle_migrations_id_seq OWNED BY public.__drizzle_migrations.id;


--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    contact_id uuid,
    deal_id uuid,
    company_id uuid,
    event_type text NOT NULL,
    action text,
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: ai_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    action text NOT NULL,
    provider text NOT NULL,
    model text,
    status text DEFAULT 'success'::text NOT NULL,
    tokens_in integer DEFAULT 0,
    tokens_out integer DEFAULT 0,
    tokens_used integer DEFAULT 0,
    cost_cents bigint DEFAULT 0,
    latency_ms integer,
    entity_type text,
    entity_id uuid,
    error_message text,
    accepted boolean,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_credits_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_credits_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    action text NOT NULL,
    provider text NOT NULL,
    model text,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    tokens_used integer DEFAULT 0 NOT NULL,
    cost_cents bigint DEFAULT 0 NOT NULL,
    balance_after_tokens bigint,
    balance_after_cost_cents bigint,
    activity_id uuid,
    billing_period text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_draft_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_draft_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    kind text DEFAULT 'email'::text NOT NULL,
    entity_types text DEFAULT 'contact,deal'::text NOT NULL,
    system_prompt text NOT NULL,
    user_prompt text NOT NULL,
    tone text DEFAULT 'professional'::text,
    default_subject text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid
);


--
-- Name: ai_email_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_email_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    deal_id uuid,
    purpose text DEFAULT 'follow_up'::text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    tone text DEFAULT 'professional'::text,
    length text DEFAULT 'medium'::text,
    model_used text,
    tokens_used integer,
    is_sent boolean DEFAULT false NOT NULL,
    sent_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: ai_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    type text NOT NULL,
    title text,
    content text NOT NULL,
    priority text DEFAULT 'medium'::text,
    score numeric(5,2),
    confidence numeric(3,2),
    is_read boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: ai_module_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_module_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    module_name text NOT NULL,
    enabled boolean DEFAULT false,
    config jsonb DEFAULT '{}'::jsonb,
    usage_stats jsonb DEFAULT '{}'::jsonb,
    plan_requirement text DEFAULT 'starter'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: ai_provider_secrets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_provider_secrets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    provider text NOT NULL,
    key_type text DEFAULT 'tenant'::text NOT NULL,
    user_id uuid,
    encrypted_key text NOT NULL,
    key_prefix text,
    base_url text,
    model_override text,
    is_centralized boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    rotated_at timestamp with time zone
);


--
-- Name: ai_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_key text NOT NULL,
    display_name text NOT NULL,
    default_base_url text,
    enabled boolean DEFAULT true NOT NULL,
    supports_streaming boolean DEFAULT true NOT NULL,
    allow_platform_key boolean DEFAULT false NOT NULL,
    rate_limits jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: TABLE ai_providers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ai_providers IS 'Catalog of AI providers the platform supports. Super-admin maintains the enabled flag and rate caps.';


--
-- Name: COLUMN ai_providers.allow_platform_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_providers.allow_platform_key IS 'If FALSE, every tenant must BYO key and go through approval. If TRUE, the platform default key may be used.';


--
-- Name: ai_usage_aggregated; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_aggregated (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    module_name text NOT NULL,
    billing_period text NOT NULL,
    count bigint DEFAULT 0,
    tokens_used bigint DEFAULT 0,
    cost_cents bigint DEFAULT 0,
    included_in_plan bigint DEFAULT 0,
    overage_count bigint DEFAULT 0,
    overage_cost_cents bigint DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: ai_usage_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    feature text NOT NULL,
    model text,
    prompt_tokens integer DEFAULT 0,
    completion_tokens integer DEFAULT 0,
    tokens_used integer DEFAULT 0,
    cost_cents numeric(10,4),
    cost_estimate numeric(10,5),
    response_time_ms integer,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    type text DEFAULT 'info'::text,
    target text DEFAULT 'all'::text,
    target_tenant_ids uuid[],
    is_active boolean DEFAULT true,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: api_key_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_key_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    api_key_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    endpoint text NOT NULL,
    method text NOT NULL,
    status_code integer,
    response_time_ms integer,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: api_key_usage_infra; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_key_usage_infra (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    api_key_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    ip_address text,
    user_agent text,
    method text,
    path text,
    status_code integer,
    response_time_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    name text NOT NULL,
    key_hash text NOT NULL,
    prefix text NOT NULL,
    scopes jsonb DEFAULT '["*"]'::jsonb,
    is_active boolean DEFAULT true,
    call_count bigint DEFAULT 0,
    last_used_at timestamp with time zone,
    last_used_ip text,
    expires_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: api_keys_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service text NOT NULL,
    key_name text NOT NULL,
    encrypted_key text NOT NULL,
    key_prefix text,
    is_active boolean DEFAULT true,
    is_primary boolean DEFAULT false,
    monthly_budget_cents bigint DEFAULT '-1'::integer,
    current_month_cents bigint DEFAULT 0,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone,
    rate_limit_per_min integer,
    rate_limit_per_day integer,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid
);


--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    rule_id text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_by uuid,
    approved_by uuid,
    rejected_by uuid,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: assignment_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assignment_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    rule_id text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    assigned_to text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: assignment_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assignment_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    entity_type text DEFAULT 'lead'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: at_risk_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.at_risk_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    stage_id uuid,
    max_days_idle integer DEFAULT 14 NOT NULL,
    max_days_in_stage integer,
    sentiment_threshold integer DEFAULT 30,
    description text,
    active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    impersonated_by uuid,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    old_data jsonb,
    new_data jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    ip_address text,
    user_agent text,
    previous_hash text,
    hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: COLUMN audit_logs.previous_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_logs.previous_hash IS 'SHA-256 hash of the previous audit log entry (null for first entry per tenant)';


--
-- Name: COLUMN audit_logs.hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_logs.hash IS 'SHA-256 hash of this entry''s data + previous_hash, forming an immutable chain';


--
-- Name: automation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    automation_id uuid,
    tenant_id uuid NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    trigger_event text,
    trigger_entity text,
    trigger_entity_id uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    error_message text,
    steps_completed integer DEFAULT 0,
    total_steps integer DEFAULT 0,
    triggered_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: automation_workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    workflow_id uuid,
    name text NOT NULL,
    description text,
    enabled boolean DEFAULT true,
    config jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: automations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    trigger_type text DEFAULT 'event'::text NOT NULL,
    trigger_config jsonb DEFAULT '{}'::jsonb,
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb,
    run_count integer DEFAULT 0,
    last_run_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: backup_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backup_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alert_type text NOT NULL,
    message text NOT NULL,
    resolved boolean DEFAULT false,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: backup_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backup_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    backup_type text DEFAULT 'full'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    size_bytes bigint DEFAULT 0,
    storage_path text,
    storage_type text DEFAULT 'local'::text,
    duration_ms integer,
    initiated_auto boolean DEFAULT false,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: backup_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backup_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    schedule_type text DEFAULT 'monthly'::text NOT NULL,
    backup_type text DEFAULT 'full'::text NOT NULL,
    retention_days integer DEFAULT 90 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: billing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    event_type text NOT NULL,
    amount numeric(10,2),
    currency text DEFAULT 'usd'::text,
    stripe_event_id text,
    stripe_invoice_id text,
    stripe_subscription_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: call_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    company_id uuid,
    deal_id uuid,
    user_id uuid,
    direction text DEFAULT 'outbound'::text NOT NULL,
    duration integer DEFAULT 0,
    notes text,
    phone_number text,
    recorded_url text,
    assigned_to uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: call_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    call_id text,
    user_id uuid,
    summary text,
    notes text,
    action_items text[],
    sentiment text,
    duration_seconds integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: call_recordings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_recordings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    recording_id text,
    call_sid text,
    recording_url text,
    transcription text,
    duration_seconds integer,
    direction text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    sender_type text NOT NULL,
    sender_id text,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: chat_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    visitor_id text NOT NULL,
    visitor_name text,
    visitor_email text,
    assigned_to uuid,
    status text DEFAULT 'waiting'::text NOT NULL,
    channel text DEFAULT 'web'::text,
    converted_lead_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: churn_predictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.churn_predictions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    churn_probability numeric(5,2) DEFAULT '0'::numeric,
    churn_risk text,
    risk_factors jsonb DEFAULT '[]'::jsonb,
    recommended_actions text[],
    previous_probability numeric(5,2),
    probability_change numeric(5,2),
    is_actioned boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: comm_email_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comm_email_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    deal_id uuid,
    purpose text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    tone text DEFAULT 'professional'::text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    domain text,
    industry text,
    company_size text,
    annual_revenue numeric(15,2),
    founded_year integer,
    headquarters text,
    description text,
    website text,
    logo_url text,
    phone text,
    address text,
    address_line1 text,
    city text,
    state text,
    country text,
    postal_code text,
    timezone text,
    linkedin_url text,
    twitter_url text,
    facebook_url text,
    is_customer boolean DEFAULT false,
    last_activity_at timestamp with time zone,
    notes text,
    tags text[] DEFAULT '{}'::text[],
    custom_fields jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: compliance_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    requested_by uuid NOT NULL,
    completed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    result jsonb DEFAULT '{}'::jsonb,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: contact_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    email text NOT NULL,
    phone text,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: contact_lifecycle_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_lifecycle_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    from_stage text,
    to_stage text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    changed_by uuid,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: contact_merge_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_merge_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    primary_contact_id uuid NOT NULL,
    merged_contact_id uuid NOT NULL,
    merged_fields jsonb DEFAULT '{}'::jsonb,
    merged_by uuid,
    merged_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: contact_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    overall_score integer DEFAULT 0,
    engagement_score integer DEFAULT 0,
    fit_score integer DEFAULT 0,
    intent_score integer DEFAULT 0,
    score_factors jsonb DEFAULT '[]'::jsonb,
    last_calculated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: contact_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_tags (
    contact_id uuid NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    company_id uuid,
    assigned_to uuid,
    original_owner_id uuid,
    first_name text NOT NULL,
    last_name text DEFAULT ''::text,
    email text,
    secondary_email text,
    phone text,
    mobile_phone text,
    work_phone text,
    job_title text,
    department text,
    address text,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    country text,
    postal_code text,
    timezone text,
    birthday date,
    gender text,
    avatar_url text,
    linkedin_url text,
    twitter_url text,
    facebook_url text,
    instagram_url text,
    website text,
    lead_source text,
    lead_status text DEFAULT 'new'::text,
    lifecycle_stage text DEFAULT 'subscriber'::text,
    score integer DEFAULT 0,
    last_activity_at timestamp with time zone,
    last_contacted_at timestamp with time zone,
    times_contacted integer DEFAULT 0,
    last_assigned_at timestamp with time zone,
    do_not_contact boolean DEFAULT false,
    unsubscribed boolean DEFAULT false,
    is_archived boolean DEFAULT false,
    is_customer boolean DEFAULT false,
    lead_access text DEFAULT 'team'::text,
    owner_notes text,
    notes text,
    tags text[] DEFAULT '{}'::text[],
    custom_fields jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: content_generations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_generations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    content_type text NOT NULL,
    platform text,
    input_prompt text,
    output_content text,
    model_used text,
    tokens_used integer DEFAULT 0,
    cost_cents integer DEFAULT 0,
    status text DEFAULT 'draft'::text,
    scheduled_for timestamp with time zone,
    published_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    company_id uuid,
    title text NOT NULL,
    contract_number text,
    contract_type text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    start_date date NOT NULL,
    end_date date,
    signed_at timestamp with time zone,
    renewed_at timestamp with time zone,
    total_value numeric(15,2),
    billing_frequency text,
    terms text,
    notes text,
    document_url text,
    parent_contract_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: conversation_keywords; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_keywords (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    keyword text NOT NULL,
    category text,
    count integer DEFAULT 0 NOT NULL,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: conversation_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    total_calls integer DEFAULT 0 NOT NULL,
    total_duration_seconds integer DEFAULT 0 NOT NULL,
    avg_duration_seconds numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    last_call_at timestamp with time zone,
    sentiment_score numeric(5,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: cost_anomalies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cost_anomalies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    service text NOT NULL,
    expected_daily_cents bigint,
    actual_daily_cents bigint,
    deviation_pct numeric(10,2),
    suspected_cause text,
    action_taken text,
    reviewed boolean DEFAULT false,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: critical_data_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.critical_data_backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    backup_data jsonb NOT NULL,
    operation text NOT NULL,
    backed_up_at timestamp with time zone DEFAULT now(),
    retained_until timestamp with time zone DEFAULT (now() + '90 days'::interval),
    can_restore boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: custom_field_defs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_field_defs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    field_key text NOT NULL,
    field_label text NOT NULL,
    field_type text DEFAULT 'text'::text NOT NULL,
    field_options jsonb,
    is_required boolean DEFAULT false,
    is_searchable boolean DEFAULT true,
    default_value text,
    display_order integer DEFAULT 0,
    is_calculated boolean DEFAULT false,
    formula text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: custom_plugins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_plugins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    icon text,
    base_url text NOT NULL,
    auth_type text DEFAULT 'none'::text NOT NULL,
    auth_config jsonb DEFAULT '{}'::jsonb,
    custom_headers jsonb DEFAULT '{}'::jsonb,
    actions jsonb DEFAULT '[]'::jsonb,
    webhook_secret text,
    status text DEFAULT 'active'::text NOT NULL,
    last_used_at timestamp with time zone,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: dashboard_layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_layouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    name text DEFAULT 'Default'::text NOT NULL,
    layout jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_default boolean DEFAULT false,
    source text DEFAULT 'user'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: dashboard_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    category text,
    layout jsonb DEFAULT '[]'::jsonb NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: dashboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    layout jsonb DEFAULT '[]'::jsonb,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: data_retention_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_retention_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    retention_days integer NOT NULL,
    action text DEFAULT 'archive'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_executed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: dead_letter_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dead_letter_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    job_type text NOT NULL,
    job_id text,
    queue text NOT NULL,
    payload jsonb NOT NULL,
    error_message text NOT NULL,
    error_stack text,
    attempts integer DEFAULT 0,
    max_attempts integer DEFAULT 3,
    status text DEFAULT 'pending'::text NOT NULL,
    original_run_at timestamp with time zone,
    failed_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone,
    resolved_by uuid,
    resolution text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: deal_forecasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_forecasts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    deal_id uuid NOT NULL,
    win_probability numeric(5,2) DEFAULT '0'::numeric,
    predicted_close_date date,
    predicted_value numeric(12,2),
    positive_factors jsonb DEFAULT '[]'::jsonb,
    negative_factors jsonb DEFAULT '[]'::jsonb,
    original_value numeric(12,2),
    value_change numeric(12,2),
    original_close_date date,
    date_change_days integer,
    confidence_level text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: deal_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deal_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    product_name text NOT NULL,
    description text,
    quantity integer DEFAULT 1,
    price numeric(12,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: deal_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    name text NOT NULL,
    "order" integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    company_id uuid,
    pipeline_id uuid,
    stage_id uuid NOT NULL,
    stage_entered_at timestamp with time zone DEFAULT now(),
    title text NOT NULL,
    amount numeric(15,2) DEFAULT '0'::numeric,
    close_date timestamp with time zone,
    assigned_to uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: deals_by_win_probability; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.deals_by_win_probability AS
 SELECT d.id,
    d.tenant_id,
    d.title,
    d.amount,
    d.close_date,
    d.stage_id,
    ds.name AS stage_name,
    ds."order" AS stage_order,
    d.pipeline_id,
    d.assigned_to,
    d.contact_id,
    d.company_id,
    d.created_at,
    d.updated_at,
    GREATEST(0.05, LEAST(0.95, ((ds."order")::numeric / (NULLIF(pm.max_order, 0))::numeric))) AS probability
   FROM ((public.deals d
     JOIN public.deal_stages ds ON ((d.stage_id = ds.id)))
     CROSS JOIN LATERAL ( SELECT max(ds2."order") AS max_order
           FROM public.deal_stages ds2
          WHERE (ds2.pipeline_id = ds.pipeline_id)) pm)
  WHERE (d.deleted_at IS NULL);


--
-- Name: document_folders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes integer NOT NULL,
    s3_key text NOT NULL,
    s3_bucket text NOT NULL,
    folder_id uuid,
    entity_type text,
    entity_id text,
    uploaded_by uuid NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: edit_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.edit_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    user_id uuid NOT NULL,
    user_name text,
    user_email text,
    field_name text NOT NULL,
    field_label text,
    old_value text,
    new_value text,
    change_type text DEFAULT 'update'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    ip_address text,
    user_agent text
);


--
-- Name: email_clicks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_clicks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    campaign_id uuid,
    email_id uuid,
    link_url text NOT NULL,
    clicked_at timestamp with time zone DEFAULT now(),
    ip_address text
);


--
-- Name: email_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    from_email text NOT NULL,
    to_email text NOT NULL,
    subject text,
    body text,
    template_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    provider text,
    provider_message_id text,
    error_message text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: email_opens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_opens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    campaign_id uuid,
    email_id uuid,
    opened_at timestamp with time zone DEFAULT now(),
    ip_address text,
    user_agent text
);


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    body_text text,
    category text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: email_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_tracking (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    recipient text,
    message_id text,
    subject text,
    sequence_enrollment_id uuid,
    sent_at timestamp with time zone DEFAULT now(),
    opened_at timestamp with time zone,
    clicked_at timestamp with time zone,
    open_count integer DEFAULT 0,
    click_count integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: email_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: email_warmup_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_warmup_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    is_active boolean DEFAULT false,
    daily_limit_start integer DEFAULT 5,
    daily_limit_current integer DEFAULT 5,
    daily_limit_max integer DEFAULT 50,
    ramp_up_days integer DEFAULT 21,
    from_email text NOT NULL,
    from_name text DEFAULT ''::text,
    started_at timestamp with time zone DEFAULT now(),
    last_warmup_at timestamp with time zone,
    total_sent integer DEFAULT 0,
    total_replied integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: email_warmup_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_warmup_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    config_id uuid NOT NULL,
    participant_id uuid,
    direction text DEFAULT 'outbound'::text NOT NULL,
    subject text,
    body text,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text,
    sent_at timestamp with time zone,
    replied_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: email_warmup_pool; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_warmup_pool (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    config_id uuid NOT NULL,
    participant_email text NOT NULL,
    participant_name text DEFAULT ''::text,
    status text DEFAULT 'active'::text,
    last_sent_at timestamp with time zone,
    last_replied_at timestamp with time zone,
    sent_count integer DEFAULT 0,
    reply_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: entity_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_tags (
    tenant_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: error_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.error_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    user_id uuid,
    level text DEFAULT 'error'::text NOT NULL,
    code text,
    message text NOT NULL,
    stack text,
    context jsonb DEFAULT '{}'::jsonb,
    resolved boolean DEFAULT false,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: exchange_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exchange_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    base_currency text NOT NULL,
    target_currency text NOT NULL,
    rate numeric(16,8) NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'exchangerate-api'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: failed_webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.failed_webhooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    webhook_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    url text NOT NULL,
    payload jsonb NOT NULL,
    error_message text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: feature_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feature_name text NOT NULL,
    description text,
    version text DEFAULT '1.0.0'::text,
    enabled boolean DEFAULT true,
    metadata_keys jsonb DEFAULT '[]'::jsonb,
    entities jsonb DEFAULT '[]'::jsonb,
    requires_tables jsonb DEFAULT '[]'::jsonb,
    registered_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: field_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    role_id uuid,
    entity_type text NOT NULL,
    field_name text NOT NULL,
    access_level text DEFAULT 'none'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: field_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    snapshot_type text NOT NULL,
    snapshot_label text,
    snapshot_data text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone
);


--
-- Name: file_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    file_name text NOT NULL,
    file_path text NOT NULL,
    file_size bigint,
    mime_type text,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: file_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_uploads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    file_name text NOT NULL,
    file_path text NOT NULL,
    file_size bigint,
    mime_type text,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: follow_ups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.follow_ups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    lead_id uuid,
    contact_id uuid,
    deal_id uuid,
    assigned_to uuid,
    title text NOT NULL,
    description text,
    due_date timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    missed_days integer DEFAULT 0,
    auto_ai_enabled boolean DEFAULT false,
    completed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: form_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.form_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    form_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    data jsonb DEFAULT '{}'::jsonb,
    contact_id uuid,
    submitted_by text,
    source_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    slug text,
    title text,
    description text,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb,
    success_message text,
    redirect_url text,
    submit_label text DEFAULT 'Submit'::text,
    theme jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    submissions_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid,
    views_count integer DEFAULT 0
);


--
-- Name: health_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.health_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service text NOT NULL,
    status text DEFAULT 'ok'::text NOT NULL,
    latency_ms integer,
    message text,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: hierarchy_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hierarchy_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hierarchy_id uuid NOT NULL,
    permission text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: impersonation_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impersonation_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    impersonator_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    reason text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    name text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email text NOT NULL,
    role_slug text DEFAULT 'member'::text NOT NULL,
    token text NOT NULL,
    invited_by uuid,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: invoice_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    product_id uuid,
    service_id uuid,
    description text NOT NULL,
    item_type text NOT NULL,
    quantity numeric(15,4) DEFAULT '1'::numeric NOT NULL,
    unit_price numeric(15,2) NOT NULL,
    discount_type text DEFAULT 'percentage'::text,
    discount_value numeric(15,2) DEFAULT '0'::numeric,
    discount_amount numeric(15,2) DEFAULT '0'::numeric,
    tax_rate numeric(5,2) DEFAULT '0'::numeric,
    tax_amount numeric(15,2) DEFAULT '0'::numeric,
    total numeric(15,2) NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    tenant_id uuid NOT NULL
);


--
-- Name: invoice_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    amount numeric(15,2) NOT NULL,
    payment_date date NOT NULL,
    payment_method text,
    reference text,
    notes text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid,
    tenant_id uuid NOT NULL
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    company_id uuid,
    invoice_number text NOT NULL,
    title text,
    status text DEFAULT 'draft'::text NOT NULL,
    issue_date date NOT NULL,
    due_date date,
    sent_at timestamp with time zone,
    paid_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    subtotal numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    discount_type text DEFAULT 'percentage'::text,
    discount_value numeric(15,2) DEFAULT '0'::numeric,
    discount_amount numeric(15,2) DEFAULT '0'::numeric,
    tax_amount numeric(15,2) DEFAULT '0'::numeric,
    tax_rate numeric(5,2) DEFAULT '0'::numeric,
    total_amount numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    amount_paid numeric(15,2) DEFAULT '0'::numeric,
    balance_due numeric(15,2) DEFAULT '0'::numeric,
    currency text DEFAULT 'USD'::text,
    notes text,
    terms text,
    footer text,
    quote_id uuid,
    order_id uuid,
    payment_method text,
    payment_reference text,
    is_recurring boolean DEFAULT false,
    recurring_frequency text,
    next_billing_date date,
    parent_invoice_id uuid,
    sent_reminder boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: kb_articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_articles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    category_id uuid,
    title text NOT NULL,
    slug text NOT NULL,
    content text NOT NULL,
    excerpt text,
    status text DEFAULT 'draft'::text NOT NULL,
    views integer DEFAULT 0,
    helpful integer DEFAULT 0,
    not_helpful integer DEFAULT 0,
    tags text[] DEFAULT '{}'::text[],
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid,
    published_at timestamp with time zone
);


--
-- Name: kb_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    icon text DEFAULT 'Book'::text,
    "order" integer DEFAULT 0,
    parent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: lead_activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    user_id uuid,
    performed_by uuid,
    activity_type text NOT NULL,
    description text,
    subject text,
    body text,
    activity_data jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    performed_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: lead_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    lead_id uuid,
    contact_id uuid,
    user_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: lead_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    lead_id uuid NOT NULL,
    service_id uuid,
    product_id text,
    description text,
    quantity numeric(12,2) DEFAULT '1'::numeric NOT NULL,
    unit_price numeric(12,2) DEFAULT '0'::numeric NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    status text DEFAULT 'proposed'::text NOT NULL,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: TABLE lead_offers; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.lead_offers IS 'What was offered to the client per lead. Carried into deals as line items on convert.';


--
-- Name: lead_scoring_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_scoring_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    factor text NOT NULL,
    weight integer DEFAULT 10 NOT NULL,
    condition text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid
);


--
-- Name: lead_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_tags (
    lead_id uuid NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: lead_warming_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_warming_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    target_filter jsonb DEFAULT '{}'::jsonb,
    event_ids jsonb DEFAULT '[]'::jsonb,
    include_birthdays boolean DEFAULT true,
    include_anniversaries boolean DEFAULT false,
    enable_email boolean DEFAULT true,
    enable_whatsapp boolean DEFAULT true,
    enable_sms boolean DEFAULT false,
    ai_generate_messages boolean DEFAULT true,
    ai_tone text DEFAULT 'warm_professional'::text,
    ai_language text DEFAULT 'en'::text,
    ai_analyze_replies boolean DEFAULT true,
    auto_respond_to_positive boolean DEFAULT false,
    notify_on_positive_intent boolean DEFAULT true,
    max_messages_per_contact_per_month integer DEFAULT 4,
    cooldown_days integer DEFAULT 7,
    total_sent integer DEFAULT 0,
    total_replies integer DEFAULT 0,
    total_positive_intent integer DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: lead_warming_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_warming_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name text NOT NULL,
    description text,
    event_type text DEFAULT 'festival'::text NOT NULL,
    recurrence text DEFAULT 'yearly'::text NOT NULL,
    event_month integer,
    event_day integer,
    event_date timestamp with time zone,
    send_days_before integer DEFAULT 0,
    send_hour integer DEFAULT 9,
    channels jsonb DEFAULT '["email", "whatsapp"]'::jsonb,
    default_email_subject text,
    default_email_body text,
    default_whatsapp_template text,
    ai_prompt_hint text,
    is_active boolean DEFAULT true,
    is_system boolean DEFAULT false,
    region text,
    tags jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: lead_warming_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_warming_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    event_id uuid,
    channel text NOT NULL,
    subject text,
    body text NOT NULL,
    template_used text,
    ai_generated boolean DEFAULT false,
    ai_model text,
    ai_prompt_used text,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    error_message text,
    opened_at timestamp with time zone,
    clicked_at timestamp with time zone,
    event_name text,
    personalized_for text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: lead_warming_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_warming_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    message_id uuid NOT NULL,
    campaign_id uuid,
    contact_id uuid NOT NULL,
    channel text NOT NULL,
    reply_content text NOT NULL,
    received_at timestamp with time zone DEFAULT now(),
    ai_analyzed boolean DEFAULT false,
    ai_analyzed_at timestamp with time zone,
    intent text,
    intent_confidence integer,
    sentiment text,
    sentiment_score integer,
    ai_summary text,
    ai_suggested_action text,
    ai_extracted_entities jsonb DEFAULT '{}'::jsonb,
    requires_follow_up boolean DEFAULT false,
    follow_up_created boolean DEFAULT false,
    follow_up_task_id uuid,
    owner_notified boolean DEFAULT false,
    notified_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: lead_warming_schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_warming_schedule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    last_message_at timestamp with time zone,
    next_eligible_at timestamp with time zone,
    messages_this_month integer DEFAULT 0,
    total_messages integer DEFAULT 0,
    total_replies integer DEFAULT 0,
    preferred_channel text,
    opted_out boolean DEFAULT false,
    opted_out_at timestamp with time zone,
    opt_out_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.leads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text DEFAULT ''::text NOT NULL,
    full_name text,
    email text,
    phone text,
    company_name text,
    lead_source text,
    lead_status text DEFAULT 'new'::text NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    value numeric(12,2),
    budget numeric(12,2),
    assigned_to uuid,
    owner_id uuid,
    company_id uuid,
    title text,
    website text,
    mobile text,
    address text,
    address_line1 text,
    city text,
    state text,
    country text,
    postal_code text,
    company_size text,
    company_industry text,
    lifecycle_stage text DEFAULT 'lead'::text,
    budget_currency text DEFAULT 'USD'::text,
    authority_level text DEFAULT 'unknown'::text,
    need_description text,
    timeline text,
    timeline_target_date date,
    linkedin_url text,
    twitter_handle text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    last_activity_at timestamp with time zone,
    notes text,
    internal_notes text,
    form_id text,
    form_submissions_count integer DEFAULT 0,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    is_converted boolean DEFAULT false NOT NULL,
    converted_at timestamp with time zone,
    converted_contact_id uuid,
    contact_id uuid,
    lead_oid text,
    product_id text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: COLUMN leads.contact_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.contact_id IS 'The person this lead is linked to. One contact can have many leads. Set at intake; convert no longer creates the contact.';


--
-- Name: COLUMN leads.lead_oid; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.lead_oid IS 'Human-readable per-tenant lead identifier, e.g. LD-2025-001.';


--
-- Name: COLUMN leads.product_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.leads.product_id IS 'Product entry the lead came in through (matches a key in lib/products/registry.ts).';


--
-- Name: limit_violations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.limit_violations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    violation_type text NOT NULL,
    limit_value integer,
    actual_value integer,
    exceeded_at timestamp with time zone DEFAULT now(),
    notified boolean DEFAULT false,
    notified_at timestamp with time zone,
    resolved boolean DEFAULT false,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    ip_address text NOT NULL,
    user_agent text,
    success boolean DEFAULT false NOT NULL,
    failure_reason text,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: login_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    identifier_type text NOT NULL,
    blocked_until timestamp with time zone NOT NULL,
    block_reason text,
    attempts_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    contact_id uuid,
    deal_id uuid,
    title text NOT NULL,
    description text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone,
    location text,
    meeting_url text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: milestones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.milestones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL,
    due_date date,
    completed boolean DEFAULT false,
    completed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modules (
    id text NOT NULL,
    name text NOT NULL,
    version text DEFAULT '1.0.0'::text NOT NULL,
    description text,
    category text,
    icon text,
    is_available boolean DEFAULT false,
    manifest jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    content text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    type text DEFAULT 'info'::text NOT NULL,
    link text,
    read_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: oauth_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    name text NOT NULL,
    redirect_uris text NOT NULL,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: oauth_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    user_id uuid,
    code text NOT NULL,
    redirect_uri text NOT NULL,
    scope text,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: oauth_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_id uuid,
    user_id uuid,
    access_token text NOT NULL,
    refresh_token text,
    scope text,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: onboarding_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    step_name text NOT NULL,
    is_completed boolean DEFAULT false,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: order_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid,
    service_id uuid,
    description text NOT NULL,
    item_type text NOT NULL,
    quantity numeric(15,4) DEFAULT '1'::numeric NOT NULL,
    unit_price numeric(15,2) NOT NULL,
    total numeric(15,2) NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    tenant_id uuid NOT NULL
);


--
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    company_id uuid,
    order_number text NOT NULL,
    title text,
    status text DEFAULT 'draft'::text NOT NULL,
    order_date date NOT NULL,
    expected_delivery_date date,
    shipped_at timestamp with time zone,
    delivered_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    subtotal numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    discount_amount numeric(15,2) DEFAULT '0'::numeric,
    tax_amount numeric(15,2) DEFAULT '0'::numeric,
    shipping_amount numeric(15,2) DEFAULT '0'::numeric,
    total_amount numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    shipping_address text,
    shipping_city text,
    shipping_state text,
    shipping_country text,
    shipping_postal_code text,
    tracking_number text,
    shipping_carrier text,
    billing_address text,
    billing_city text,
    billing_state text,
    billing_country text,
    billing_postal_code text,
    notes text,
    customer_notes text,
    quote_id uuid,
    invoice_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: page_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    visitor_id uuid NOT NULL,
    url text NOT NULL,
    title text DEFAULT ''::text,
    referrer text DEFAULT ''::text,
    duration_seconds integer DEFAULT 0,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: permission_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    role_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    permissions jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: pipeline_health_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_health_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    metric_date date NOT NULL,
    total_deals integer DEFAULT 0 NOT NULL,
    total_value numeric(15,2) DEFAULT '0'::numeric NOT NULL,
    avg_deal_size numeric(15,2),
    win_rate numeric(5,4),
    avg_cycle_days integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: pipeline_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pipeline_id uuid NOT NULL,
    name text NOT NULL,
    order_val integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: pipelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_default boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: plan_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plan_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id text NOT NULL,
    max_users integer,
    max_contacts integer,
    max_deals integer,
    max_storage_bytes bigint,
    max_api_calls_per_day integer,
    max_ai_tokens_per_day integer,
    max_emails_per_day integer,
    max_active_automations integer,
    max_tickets integer,
    max_forms integer,
    max_custom_fields_per_entity integer,
    max_file_upload_bytes integer,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    price_monthly numeric(10,2) DEFAULT '0'::numeric,
    price_yearly numeric(10,2) DEFAULT '0'::numeric,
    price_cents integer DEFAULT 0,
    price numeric(10,2) DEFAULT '0'::numeric,
    max_users integer DEFAULT 5,
    max_contacts integer DEFAULT 1000,
    max_deals integer DEFAULT 500,
    max_storage_gb numeric(6,2) DEFAULT '1'::numeric,
    max_automations integer DEFAULT 5,
    max_forms integer DEFAULT 3,
    max_api_calls_day integer DEFAULT 1000,
    rate_limit_config jsonb DEFAULT '{"ai": 30, "api": 60, "auth": 5, "bulk": 5, "deals": 30, "export": 10, "import": 5, "webhook": 1000, "contacts": 30, "passwordReset": 3, "emailVerification": 10}'::jsonb,
    features jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: COLUMN plans.rate_limit_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.plans.rate_limit_config IS 'Per-plan rate limits in requests per minute/hour. Keys: api, auth, contacts, deals, export, import, ai, webhook, passwordReset, emailVerification, bulk';


--
-- Name: platform_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: plugin_execution_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plugin_execution_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    plugin_id uuid NOT NULL,
    action_name text NOT NULL,
    method text NOT NULL,
    url text NOT NULL,
    request_headers jsonb DEFAULT '{}'::jsonb,
    request_body jsonb,
    response_status integer,
    response_body text,
    duration_ms integer,
    success boolean DEFAULT false NOT NULL,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: portal_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.portal_clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    access_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true,
    last_login_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: price_book_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_book_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    price_book_id uuid NOT NULL,
    product_id uuid NOT NULL,
    unit_price numeric(15,2) NOT NULL,
    discount_percent numeric(5,2) DEFAULT '0'::numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: price_books; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_books (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    currency text DEFAULT 'USD'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    valid_from date,
    valid_until date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: product_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text,
    description text,
    icon text,
    modules jsonb DEFAULT '[]'::jsonb,
    custom_fields jsonb DEFAULT '[]'::jsonb,
    pipelines jsonb DEFAULT '[]'::jsonb,
    automations jsonb DEFAULT '[]'::jsonb,
    is_builtin boolean DEFAULT false,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid,
    tenant_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    sku text,
    base_price numeric(12,2) DEFAULT '0'::numeric,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: project_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now(),
    added_by uuid
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active'::text NOT NULL,
    start_date date,
    end_date date,
    owner_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: quote_line_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quote_line_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quote_id uuid NOT NULL,
    product_id uuid,
    description text NOT NULL,
    quantity numeric(15,4) DEFAULT '1'::numeric NOT NULL,
    unit_price numeric(15,2) NOT NULL,
    discount_percent numeric(5,2) DEFAULT '0'::numeric,
    tax_percent numeric(5,2) DEFAULT '0'::numeric,
    total numeric(15,2) NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    deal_id uuid,
    title text NOT NULL,
    quote_number text,
    status text DEFAULT 'draft'::text NOT NULL,
    subtotal numeric(15,2) DEFAULT '0'::numeric,
    discount numeric(15,2) DEFAULT '0'::numeric,
    tax numeric(15,2) DEFAULT '0'::numeric,
    total_amount numeric(15,2) DEFAULT '0'::numeric,
    expires_at timestamp with time zone,
    notes text,
    terms text,
    metadata jsonb DEFAULT '{}'::jsonb,
    sent_at timestamp with time zone,
    accepted_at timestamp with time zone,
    declined_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: record_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.record_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    role_id uuid,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    access_level text DEFAULT 'none'::text NOT NULL,
    granted_by uuid,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: report_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    report_id uuid NOT NULL,
    executed_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'completed'::text,
    result_count integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: report_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.report_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    report_type text NOT NULL,
    query_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    chart_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: restore_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restore_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    snapshot_data jsonb NOT NULL,
    table_count integer,
    record_count integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: revenue_forecast_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_forecast_summary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    forecast_date date DEFAULT CURRENT_DATE NOT NULL,
    total_expected_revenue numeric(15,2) DEFAULT '0'::numeric,
    total_deals integer DEFAULT 0,
    avg_deal_value numeric(12,2) DEFAULT '0'::numeric,
    win_rate numeric(5,2) DEFAULT '0'::numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: revenue_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    opportunity_type text NOT NULL,
    entity_type text,
    entity_id uuid,
    estimated_value numeric(12,2),
    reason text,
    suggested_action text,
    status text DEFAULT 'new'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    detected_at timestamp with time zone DEFAULT now(),
    acted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: revenue_projections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revenue_projections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    projected_amount numeric(15,2) NOT NULL,
    actual_amount numeric(15,2) DEFAULT '0'::numeric,
    confidence_score numeric(5,4),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    is_system boolean DEFAULT false,
    permissions jsonb DEFAULT '{}'::jsonb,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: saved_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    report_type text NOT NULL,
    config jsonb NOT NULL,
    chart_type text DEFAULT 'table'::text,
    is_public boolean DEFAULT false,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: saved_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    entity_type text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    columns jsonb,
    is_shared boolean DEFAULT false,
    is_default boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: scheduled_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scheduled_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    frequency text NOT NULL,
    recipients jsonb DEFAULT '[]'::jsonb,
    config jsonb DEFAULT '{}'::jsonb,
    format text DEFAULT 'pdf'::text,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    user_id uuid,
    event_type text NOT NULL,
    ip_address text,
    user_agent text,
    metadata text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: segment_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.segment_members (
    segment_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now()
);


--
-- Name: segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.segments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    entity_type text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    query_logic jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    last_refreshed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: selective_restore_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.selective_restore_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    action text NOT NULL,
    table_name text,
    record_id uuid,
    old_data jsonb,
    new_data jsonb,
    performed_by uuid,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: selective_restore_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.selective_restore_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    backup_id uuid NOT NULL,
    action text NOT NULL,
    status text DEFAULT 'pending'::text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: sequence_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequence_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    sequence_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    current_step integer DEFAULT 1 NOT NULL,
    next_step_at timestamp with time zone,
    enrolled_by uuid,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: sequence_step_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequence_step_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enrollment_id uuid NOT NULL,
    step_id uuid,
    tenant_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    scheduled_at timestamp with time zone,
    executed_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: sequence_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequence_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    step_number integer NOT NULL,
    step_type text DEFAULT 'email'::text NOT NULL,
    delay_days integer DEFAULT 0,
    delay_hours integer DEFAULT 0,
    delay_minutes integer DEFAULT 0,
    template_id uuid,
    content text,
    subject text,
    body text,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'draft'::text NOT NULL,
    enroll_count integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: service_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    color text DEFAULT '#6366f1'::text,
    icon text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: service_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    company_id uuid,
    name text NOT NULL,
    plan_name text,
    status text DEFAULT 'active'::text NOT NULL,
    start_date date NOT NULL,
    current_period_start date,
    current_period_end date,
    cancelled_at timestamp with time zone,
    trial_end_date date,
    amount numeric(15,2) NOT NULL,
    currency text DEFAULT 'USD'::text,
    billing_frequency text NOT NULL,
    auto_renew boolean DEFAULT true,
    payment_method text,
    last4 text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: services; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.services (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    company_id uuid,
    name text NOT NULL,
    description text,
    category text,
    pricing_type text DEFAULT 'fixed'::text NOT NULL,
    unit_price numeric(15,2),
    hourly_rate numeric(15,2),
    monthly_price numeric(15,2),
    yearly_price numeric(15,2),
    tax_rate numeric(5,2) DEFAULT '0'::numeric,
    taxable boolean DEFAULT true,
    currency text DEFAULT 'USD'::text,
    is_active boolean DEFAULT true,
    is_featured boolean DEFAULT false,
    duration_minutes integer,
    duration_hours integer,
    image_url text,
    times_used integer DEFAULT 0,
    total_revenue numeric(15,2) DEFAULT '0'::numeric,
    tags text[] DEFAULT '{}'::text[],
    custom_fields jsonb DEFAULT '{}'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: signing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signing_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    signer_email text NOT NULL,
    event text NOT NULL,
    event_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: signing_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signing_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    document_id uuid NOT NULL,
    provider text DEFAULT 'internal'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    external_id text,
    signers jsonb DEFAULT '[]'::jsonb,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: sla_breaches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sla_breaches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    policy_id text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    breach_type text NOT NULL,
    breached_at timestamp with time zone NOT NULL,
    notified_users jsonb DEFAULT '[]'::jsonb,
    escalation_level integer DEFAULT 0,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: sla_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sla_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    priority text NOT NULL,
    response_time_minutes integer NOT NULL,
    resolution_time_minutes integer NOT NULL,
    escalation_rules jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: sms_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    direction text NOT NULL,
    "to" text NOT NULL,
    "from" text NOT NULL,
    body text NOT NULL,
    template_id uuid,
    status text DEFAULT 'queued'::text NOT NULL,
    twilio_sid text,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: sms_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sms_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    body text NOT NULL,
    variables jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: sso_providers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sso_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    provider_type text NOT NULL,
    name text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: sso_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sso_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    provider_id uuid,
    session_id text NOT NULL,
    id_token text,
    saml_assertion text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: storage_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.storage_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    storage_key text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    description text,
    tags text[] DEFAULT '{}'::text[],
    linked_entity_type text,
    linked_entity_id uuid,
    uploaded_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    plan_id text,
    status text DEFAULT 'active'::text NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: super_admin_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.super_admin_audit_logs (
    id text NOT NULL,
    admin_id text NOT NULL,
    admin_email text NOT NULL,
    action text NOT NULL,
    target_type text,
    target_id text,
    target_name text,
    tenant_id text,
    tenant_name text,
    ip_address text,
    user_agent text,
    old_data text,
    new_data text,
    metadata text,
    previous_hash text,
    hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN super_admin_audit_logs.previous_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.super_admin_audit_logs.previous_hash IS 'SHA-256 hash of the previous super admin audit entry (null for first entry)';


--
-- Name: COLUMN super_admin_audit_logs.hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.super_admin_audit_logs.hash IS 'SHA-256 hash of this entry''s data + previous_hash, forming an immutable chain';


--
-- Name: super_admin_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.super_admin_backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    backup_name text NOT NULL,
    backup_type text DEFAULT 'full'::text,
    storage_path text NOT NULL,
    backup_size bigint,
    status text DEFAULT 'completed'::text,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    subject text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    category text DEFAULT 'general'::text,
    assigned_to uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid,
    resolved_at timestamp with time zone
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    color text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    priority text DEFAULT 'medium'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    due_date timestamp with time zone,
    completed boolean DEFAULT false,
    completed_at timestamp with time zone,
    contact_id uuid,
    deal_id uuid,
    assigned_to uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: tax_exemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_exemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: tax_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tax_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    rate numeric(8,4) NOT NULL,
    type text DEFAULT 'percentage'::text NOT NULL,
    country text,
    state text,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: tenant_ai_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_ai_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    model text NOT NULL,
    encrypted_api_key text NOT NULL,
    base_url_override text,
    status text DEFAULT 'pending'::text NOT NULL,
    decision_reason text,
    approved_by uuid,
    approved_at timestamp with time zone,
    fallback_chain jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_used_at timestamp with time zone,
    call_count integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: TABLE tenant_ai_credentials; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.tenant_ai_credentials IS 'Per-tenant BYO API key + chosen model. Must be approved by super-admin before the gateway will call it.';


--
-- Name: COLUMN tenant_ai_credentials.encrypted_api_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant_ai_credentials.encrypted_api_key IS 'AES-GCM encrypted key. Never store plaintext. Decrypted by lib/crypto/secrets.ts inside the gateway only.';


--
-- Name: COLUMN tenant_ai_credentials.fallback_chain; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant_ai_credentials.fallback_chain IS 'JSON array of provider_keys in priority order. Used by the gateway on transient failures.';


--
-- Name: tenant_ai_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_ai_credits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    allocated_tokens bigint DEFAULT 0 NOT NULL,
    used_tokens bigint DEFAULT 0 NOT NULL,
    allocated_cost_cents bigint DEFAULT 0 NOT NULL,
    used_cost_cents bigint DEFAULT 0 NOT NULL,
    billing_period text NOT NULL,
    hard_cap_enabled boolean DEFAULT true NOT NULL,
    soft_cap_pct integer DEFAULT 80,
    status text DEFAULT 'active'::text NOT NULL,
    allocation_notes text,
    set_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    allocated_by uuid
);


--
-- Name: tenant_backup_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_backup_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    backup_type text DEFAULT 'full'::text,
    data_size bigint DEFAULT 0,
    table_count integer DEFAULT 0,
    record_count bigint DEFAULT 0,
    backup_data jsonb,
    backup_note text,
    include_tables jsonb,
    initiated_by uuid,
    initiated_auto boolean DEFAULT false,
    duration_ms integer,
    error_message text,
    retention_days integer DEFAULT 90,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: tenant_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    filename text NOT NULL,
    storage_path text NOT NULL,
    size_bytes integer,
    status text DEFAULT 'pending'::text NOT NULL,
    backup_type text DEFAULT 'automated'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    expires_at timestamp with time zone
);


--
-- Name: tenant_hierarchy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_hierarchy (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_tenant_id uuid NOT NULL,
    child_tenant_id uuid NOT NULL,
    relationship text DEFAULT 'parent'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: tenant_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid,
    role_slug text DEFAULT 'member'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    invited_by uuid,
    invited_at timestamp with time zone DEFAULT now(),
    joined_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    settings jsonb DEFAULT '{}'::jsonb,
    notification_prefs jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: tenant_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_modules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    module_id text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    enabled_features jsonb DEFAULT '[]'::jsonb,
    force_enabled boolean DEFAULT false,
    settings jsonb DEFAULT '{}'::jsonb,
    installed_by uuid,
    installed_at timestamp with time zone DEFAULT now(),
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: tenant_restore_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_restore_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    backup_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    restore_options jsonb,
    tables_restored integer DEFAULT 0,
    records_restored bigint DEFAULT 0,
    initiated_by uuid,
    duration_ms integer,
    error_message text,
    initiated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: tenant_restores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_restores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    backup_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    initiated_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: tenant_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    template_id uuid NOT NULL,
    applied_at timestamp with time zone DEFAULT now(),
    applied_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: tenant_token_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_token_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    openai_monthly_limit bigint DEFAULT '-1'::integer,
    whatsapp_monthly_msgs bigint DEFAULT '-1'::integer,
    voice_monthly_mins bigint DEFAULT '-1'::integer,
    content_monthly_gen bigint DEFAULT '-1'::integer,
    proposal_monthly_gen bigint DEFAULT '-1'::integer,
    followup_monthly_cnt bigint DEFAULT '-1'::integer,
    score_monthly_cnt bigint DEFAULT '-1'::integer,
    total_monthly_cost bigint DEFAULT '-1'::integer,
    hard_cap_action text DEFAULT 'block'::text,
    override_reason text,
    set_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    subdomain text,
    status text DEFAULT 'trialing'::text NOT NULL,
    plan_id text DEFAULT 'free'::text NOT NULL,
    trial_ends_at timestamp with time zone DEFAULT (now() + '14 days'::interval),
    owner_id uuid,
    primary_color text DEFAULT '#7c3aed'::text,
    billing_email text,
    logo_url text,
    favicon_url text,
    custom_domain text,
    subscription_id text,
    stripe_customer_id text,
    stripe_subscription_id text,
    billing_type text DEFAULT 'trial'::text,
    manual_paid_until timestamp with time zone,
    current_users integer DEFAULT 0,
    current_contacts integer DEFAULT 0,
    current_deals integer DEFAULT 0,
    storage_used_bytes bigint DEFAULT 0,
    industry text,
    company_size text,
    country text,
    domain_verified boolean DEFAULT false,
    domain_verified_at timestamp with time zone,
    admin_notes text,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    short_code text
);


--
-- Name: territories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.territories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    type text DEFAULT 'custom'::text NOT NULL,
    geo_config jsonb DEFAULT '{}'::jsonb,
    assigned_to uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: territory_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.territory_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    territory_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: ticket_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ticket_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    contact_id uuid,
    body text NOT NULL,
    is_internal boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: token_budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service text NOT NULL,
    monthly_budget_cents bigint DEFAULT 0 NOT NULL,
    current_month_cents bigint DEFAULT 0 NOT NULL,
    alert_at_50pct boolean DEFAULT true,
    alert_at_80pct boolean DEFAULT true,
    alert_at_100pct boolean DEFAULT true,
    hard_cap_enabled boolean DEFAULT true,
    soft_cap_enabled boolean DEFAULT true,
    billing_period text NOT NULL,
    reset_day integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: usage_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alert_type text NOT NULL,
    target_type text NOT NULL,
    target_id uuid,
    service text,
    current_value bigint,
    threshold_value bigint,
    message text,
    notification_sent text,
    acknowledged boolean DEFAULT false,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: usage_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    snapshot_date text DEFAULT (CURRENT_DATE)::text NOT NULL,
    contacts_count integer DEFAULT 0,
    leads_count integer DEFAULT 0,
    deals_count integer DEFAULT 0,
    users_count integer DEFAULT 0,
    storage_used_mb numeric(10,2) DEFAULT '0'::numeric,
    api_calls_count integer DEFAULT 0,
    email_sent_count integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: user_departures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_departures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    user_email text,
    user_name text,
    departure_date date,
    departed_by uuid,
    reason text,
    notes text,
    is_rehirable boolean DEFAULT false,
    contacts_reassigned_to uuid,
    contacts_count integer DEFAULT 0,
    deals_count integer DEFAULT 0,
    tasks_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: user_token_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_token_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    module text NOT NULL,
    daily_limit bigint DEFAULT '-1'::integer,
    monthly_limit bigint DEFAULT '-1'::integer,
    max_cost_per_call bigint DEFAULT '-1'::integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    counters jsonb DEFAULT '{}'::jsonb,
    storage_bytes bigint DEFAULT 0,
    api_calls_today integer DEFAULT 0,
    api_calls_date date DEFAULT CURRENT_DATE,
    ai_tokens_today integer DEFAULT 0,
    ai_tokens_date date DEFAULT CURRENT_DATE,
    last_activity_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text,
    full_name text,
    avatar_url text,
    phone text,
    timezone text DEFAULT 'UTC'::text,
    is_super_admin boolean DEFAULT false,
    last_tenant_id uuid,
    default_tenant_id uuid,
    email_verified boolean DEFAULT false,
    email_verify_token text,
    reset_token text,
    reset_token_expires timestamp with time zone,
    oauth_provider text,
    oauth_id text,
    locale text DEFAULT 'en'::text,
    theme text DEFAULT 'light'::text,
    telegram_bot_token text,
    telegram_chat_id text,
    telegram_enabled boolean DEFAULT false,
    telegram_notify_login boolean DEFAULT true,
    telegram_notify_signup boolean DEFAULT true,
    telegram_notify_password_change boolean DEFAULT true,
    telegram_notify_2fa_change boolean DEFAULT true,
    telegram_notify_security_alerts boolean DEFAULT true,
    totp_enabled boolean DEFAULT false,
    totp_secret text,
    totp_backup_codes jsonb,
    totp_verified_at timestamp with time zone,
    unlimited_rate_limit boolean DEFAULT false,
    deleted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: COLUMN users.unlimited_rate_limit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.unlimited_rate_limit IS 'When true, user bypasses all rate limits (for super admin)';


--
-- Name: visitors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visitors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    fingerprint_id text NOT NULL,
    identified_contact_id uuid,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    total_page_views integer DEFAULT 0 NOT NULL,
    score integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: voice_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    deal_id uuid,
    call_sid text,
    direction text NOT NULL,
    status text NOT NULL,
    duration_seconds integer DEFAULT 0,
    recording_url text,
    transcript text,
    ai_summary text,
    ai_sentiment text,
    ai_action_items jsonb DEFAULT '[]'::jsonb,
    cost_cents integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: webhook_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    webhook_id uuid,
    event_type text DEFAULT 'generic'::text NOT NULL,
    payload jsonb,
    response_status integer,
    response_body text,
    duration_ms integer,
    status text DEFAULT 'success'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: webhook_inbound_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_inbound_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    webhook_id uuid,
    api_key_id uuid,
    tenant_id uuid NOT NULL,
    action text,
    entity text,
    status text,
    status_code integer,
    payload jsonb,
    headers jsonb DEFAULT '{}'::jsonb,
    response_status integer,
    response_body text,
    error_message text,
    record_id uuid,
    payload_size integer,
    processed boolean DEFAULT false,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: webhook_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    webhook_id uuid NOT NULL,
    url text NOT NULL,
    method text DEFAULT 'POST'::text NOT NULL,
    headers jsonb DEFAULT '{}'::jsonb,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    max_retries integer DEFAULT 3 NOT NULL,
    response_status integer,
    response_body text,
    error_message text,
    delivered_at timestamp with time zone,
    failed_at timestamp with time zone,
    next_retry_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    events jsonb DEFAULT '[]'::jsonb NOT NULL,
    secret text,
    is_active boolean DEFAULT true,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: whatsapp_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    whatsapp_from text NOT NULL,
    whatsapp_to text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    ai_enabled boolean DEFAULT false,
    ai_last_response text,
    last_message_at timestamp with time zone DEFAULT now(),
    message_count integer DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: whatsapp_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    direction text NOT NULL,
    content_type text DEFAULT 'text'::text NOT NULL,
    content text NOT NULL,
    external_id text,
    status text DEFAULT 'sent'::text NOT NULL,
    ai_generated boolean DEFAULT false,
    ai_model_used text,
    delivered boolean DEFAULT false,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    read_at timestamp with time zone
);


--
-- Name: whatsapp_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    language text DEFAULT 'en'::text,
    category text,
    status text,
    content text,
    components jsonb DEFAULT '[]'::jsonb,
    variables jsonb DEFAULT '[]'::jsonb,
    meta_data jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: workflow_action_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_action_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    execution_id uuid NOT NULL,
    action_id uuid,
    tenant_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    error_message text,
    result jsonb,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: workflow_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    action_type text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    condition_config jsonb,
    order_index integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: workflow_execution_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_execution_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_execution_id uuid,
    tenant_id uuid NOT NULL,
    message text NOT NULL,
    level text DEFAULT 'info'::text,
    step_name text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: workflow_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflow_executions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    lead_id uuid,
    status text DEFAULT 'running'::text NOT NULL,
    input_data jsonb,
    output_data jsonb,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone
);


--
-- Name: workflows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'draft'::text NOT NULL,
    trigger_type text DEFAULT 'manual'::text NOT NULL,
    trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    nodes jsonb DEFAULT '[]'::jsonb NOT NULL,
    edges jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    created_by uuid,
    updated_by uuid,
    deleted_by uuid
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('public.__drizzle_migrations_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: ai_activity ai_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_activity
    ADD CONSTRAINT ai_activity_pkey PRIMARY KEY (id);


--
-- Name: ai_credits_ledger ai_credits_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_credits_ledger
    ADD CONSTRAINT ai_credits_ledger_pkey PRIMARY KEY (id);


--
-- Name: ai_draft_templates ai_draft_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_draft_templates
    ADD CONSTRAINT ai_draft_templates_pkey PRIMARY KEY (id);


--
-- Name: ai_email_drafts ai_email_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_email_drafts
    ADD CONSTRAINT ai_email_drafts_pkey PRIMARY KEY (id);


--
-- Name: ai_insights ai_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_insights
    ADD CONSTRAINT ai_insights_pkey PRIMARY KEY (id);


--
-- Name: ai_module_configs ai_module_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_module_configs
    ADD CONSTRAINT ai_module_configs_pkey PRIMARY KEY (id);


--
-- Name: ai_provider_secrets ai_provider_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_secrets
    ADD CONSTRAINT ai_provider_secrets_pkey PRIMARY KEY (id);


--
-- Name: ai_providers ai_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_aggregated ai_usage_aggregated_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_aggregated
    ADD CONSTRAINT ai_usage_aggregated_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_logs ai_usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_logs
    ADD CONSTRAINT ai_usage_logs_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: api_key_usage_infra api_key_usage_infra_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key_usage_infra
    ADD CONSTRAINT api_key_usage_infra_pkey PRIMARY KEY (id);


--
-- Name: api_key_usage api_key_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key_usage
    ADD CONSTRAINT api_key_usage_pkey PRIMARY KEY (id);


--
-- Name: api_keys api_keys_key_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_unique UNIQUE (key_hash);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: api_keys_registry api_keys_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys_registry
    ADD CONSTRAINT api_keys_registry_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: assignment_logs assignment_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_logs
    ADD CONSTRAINT assignment_logs_pkey PRIMARY KEY (id);


--
-- Name: assignment_rules assignment_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_rules
    ADD CONSTRAINT assignment_rules_pkey PRIMARY KEY (id);


--
-- Name: at_risk_rules at_risk_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.at_risk_rules
    ADD CONSTRAINT at_risk_rules_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: automation_runs automation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_pkey PRIMARY KEY (id);


--
-- Name: automation_workflows automation_workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_workflows
    ADD CONSTRAINT automation_workflows_pkey PRIMARY KEY (id);


--
-- Name: automations automations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_pkey PRIMARY KEY (id);


--
-- Name: backup_alerts backup_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_alerts
    ADD CONSTRAINT backup_alerts_pkey PRIMARY KEY (id);


--
-- Name: backup_records backup_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_records
    ADD CONSTRAINT backup_records_pkey PRIMARY KEY (id);


--
-- Name: backup_schedules backup_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_schedules
    ADD CONSTRAINT backup_schedules_pkey PRIMARY KEY (id);


--
-- Name: billing_events billing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_pkey PRIMARY KEY (id);


--
-- Name: billing_events billing_events_stripe_event_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_stripe_event_id_unique UNIQUE (stripe_event_id);


--
-- Name: call_logs call_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_pkey PRIMARY KEY (id);


--
-- Name: call_notes call_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_notes
    ADD CONSTRAINT call_notes_pkey PRIMARY KEY (id);


--
-- Name: call_recordings call_recordings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_recordings
    ADD CONSTRAINT call_recordings_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_sessions chat_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);


--
-- Name: churn_predictions churn_predictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.churn_predictions
    ADD CONSTRAINT churn_predictions_pkey PRIMARY KEY (id);


--
-- Name: comm_email_drafts comm_email_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comm_email_drafts
    ADD CONSTRAINT comm_email_drafts_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: compliance_requests compliance_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_requests
    ADD CONSTRAINT compliance_requests_pkey PRIMARY KEY (id);


--
-- Name: contact_emails contact_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_emails
    ADD CONSTRAINT contact_emails_pkey PRIMARY KEY (id);


--
-- Name: contact_lifecycle_history contact_lifecycle_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_lifecycle_history
    ADD CONSTRAINT contact_lifecycle_history_pkey PRIMARY KEY (id);


--
-- Name: contact_merge_history contact_merge_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_merge_history
    ADD CONSTRAINT contact_merge_history_pkey PRIMARY KEY (id);


--
-- Name: contact_scores contact_scores_contact_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_scores
    ADD CONSTRAINT contact_scores_contact_id_unique UNIQUE (contact_id);


--
-- Name: contact_scores contact_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_scores
    ADD CONSTRAINT contact_scores_pkey PRIMARY KEY (id);


--
-- Name: contact_tags contact_tags_contact_id_tag_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_tags
    ADD CONSTRAINT contact_tags_contact_id_tag_id_pk PRIMARY KEY (contact_id, tag_id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: content_generations content_generations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_generations
    ADD CONSTRAINT content_generations_pkey PRIMARY KEY (id);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (id);


--
-- Name: conversation_keywords conversation_keywords_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_keywords
    ADD CONSTRAINT conversation_keywords_pkey PRIMARY KEY (id);


--
-- Name: conversation_metrics conversation_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_metrics
    ADD CONSTRAINT conversation_metrics_pkey PRIMARY KEY (id);


--
-- Name: cost_anomalies cost_anomalies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_anomalies
    ADD CONSTRAINT cost_anomalies_pkey PRIMARY KEY (id);


--
-- Name: critical_data_backups critical_data_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.critical_data_backups
    ADD CONSTRAINT critical_data_backups_pkey PRIMARY KEY (id);


--
-- Name: custom_field_defs custom_field_defs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_defs
    ADD CONSTRAINT custom_field_defs_pkey PRIMARY KEY (id);


--
-- Name: custom_plugins custom_plugins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_plugins
    ADD CONSTRAINT custom_plugins_pkey PRIMARY KEY (id);


--
-- Name: dashboard_layouts dashboard_layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_layouts
    ADD CONSTRAINT dashboard_layouts_pkey PRIMARY KEY (id);


--
-- Name: dashboard_templates dashboard_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_templates
    ADD CONSTRAINT dashboard_templates_pkey PRIMARY KEY (id);


--
-- Name: dashboard_templates dashboard_templates_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_templates
    ADD CONSTRAINT dashboard_templates_slug_unique UNIQUE (slug);


--
-- Name: dashboards dashboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboards
    ADD CONSTRAINT dashboards_pkey PRIMARY KEY (id);


--
-- Name: data_retention_policies data_retention_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_retention_policies
    ADD CONSTRAINT data_retention_policies_pkey PRIMARY KEY (id);


--
-- Name: dead_letter_queue dead_letter_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dead_letter_queue
    ADD CONSTRAINT dead_letter_queue_pkey PRIMARY KEY (id);


--
-- Name: deal_forecasts deal_forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_forecasts
    ADD CONSTRAINT deal_forecasts_pkey PRIMARY KEY (id);


--
-- Name: deal_products deal_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_products
    ADD CONSTRAINT deal_products_pkey PRIMARY KEY (id);


--
-- Name: deal_stages deal_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_stages
    ADD CONSTRAINT deal_stages_pkey PRIMARY KEY (id);


--
-- Name: deals deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);


--
-- Name: document_folders document_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_folders
    ADD CONSTRAINT document_folders_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: edit_history edit_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edit_history
    ADD CONSTRAINT edit_history_pkey PRIMARY KEY (id);


--
-- Name: email_clicks email_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_clicks
    ADD CONSTRAINT email_clicks_pkey PRIMARY KEY (id);


--
-- Name: email_log email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_pkey PRIMARY KEY (id);


--
-- Name: email_opens email_opens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_opens
    ADD CONSTRAINT email_opens_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: email_tracking email_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_tracking
    ADD CONSTRAINT email_tracking_pkey PRIMARY KEY (id);


--
-- Name: email_verifications email_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (id);


--
-- Name: email_verifications email_verifications_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_token_hash_unique UNIQUE (token_hash);


--
-- Name: email_warmup_configs email_warmup_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_warmup_configs
    ADD CONSTRAINT email_warmup_configs_pkey PRIMARY KEY (id);


--
-- Name: email_warmup_logs email_warmup_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_warmup_logs
    ADD CONSTRAINT email_warmup_logs_pkey PRIMARY KEY (id);


--
-- Name: email_warmup_pool email_warmup_pool_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_warmup_pool
    ADD CONSTRAINT email_warmup_pool_pkey PRIMARY KEY (id);


--
-- Name: entity_tags entity_tags_tag_id_entity_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_tags
    ADD CONSTRAINT entity_tags_tag_id_entity_id_pk PRIMARY KEY (tag_id, entity_id);


--
-- Name: error_logs error_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);


--
-- Name: exchange_rates exchange_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_pkey PRIMARY KEY (id);


--
-- Name: failed_webhooks failed_webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_webhooks
    ADD CONSTRAINT failed_webhooks_pkey PRIMARY KEY (id);


--
-- Name: feature_registry feature_registry_feature_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_registry
    ADD CONSTRAINT feature_registry_feature_name_unique UNIQUE (feature_name);


--
-- Name: feature_registry feature_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_registry
    ADD CONSTRAINT feature_registry_pkey PRIMARY KEY (id);


--
-- Name: field_permissions field_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_permissions
    ADD CONSTRAINT field_permissions_pkey PRIMARY KEY (id);


--
-- Name: field_snapshots field_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_snapshots
    ADD CONSTRAINT field_snapshots_pkey PRIMARY KEY (id);


--
-- Name: file_attachments file_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_attachments
    ADD CONSTRAINT file_attachments_pkey PRIMARY KEY (id);


--
-- Name: file_uploads file_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_pkey PRIMARY KEY (id);


--
-- Name: follow_ups follow_ups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_ups
    ADD CONSTRAINT follow_ups_pkey PRIMARY KEY (id);


--
-- Name: form_submissions form_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_pkey PRIMARY KEY (id);


--
-- Name: forms forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_pkey PRIMARY KEY (id);


--
-- Name: forms forms_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_slug_unique UNIQUE (slug);


--
-- Name: health_checks health_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.health_checks
    ADD CONSTRAINT health_checks_pkey PRIMARY KEY (id);


--
-- Name: hierarchy_permissions hierarchy_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hierarchy_permissions
    ADD CONSTRAINT hierarchy_permissions_pkey PRIMARY KEY (id);


--
-- Name: impersonation_sessions impersonation_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_sessions
    ADD CONSTRAINT impersonation_sessions_pkey PRIMARY KEY (id);


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_pkey PRIMARY KEY (id);


--
-- Name: invitations invitations_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_token_unique UNIQUE (token);


--
-- Name: invoice_line_items invoice_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_line_items
    ADD CONSTRAINT invoice_line_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_payments invoice_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: kb_articles kb_articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_articles
    ADD CONSTRAINT kb_articles_pkey PRIMARY KEY (id);


--
-- Name: kb_categories kb_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_categories
    ADD CONSTRAINT kb_categories_pkey PRIMARY KEY (id);


--
-- Name: lead_activities lead_activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_pkey PRIMARY KEY (id);


--
-- Name: lead_assignments lead_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_pkey PRIMARY KEY (id);


--
-- Name: lead_offers lead_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_offers
    ADD CONSTRAINT lead_offers_pkey PRIMARY KEY (id);


--
-- Name: lead_scoring_rules lead_scoring_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_scoring_rules
    ADD CONSTRAINT lead_scoring_rules_pkey PRIMARY KEY (id);


--
-- Name: lead_tags lead_tags_lead_id_tag_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_tags
    ADD CONSTRAINT lead_tags_lead_id_tag_id_pk PRIMARY KEY (lead_id, tag_id);


--
-- Name: lead_warming_campaigns lead_warming_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_campaigns
    ADD CONSTRAINT lead_warming_campaigns_pkey PRIMARY KEY (id);


--
-- Name: lead_warming_events lead_warming_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_events
    ADD CONSTRAINT lead_warming_events_pkey PRIMARY KEY (id);


--
-- Name: lead_warming_messages lead_warming_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_messages
    ADD CONSTRAINT lead_warming_messages_pkey PRIMARY KEY (id);


--
-- Name: lead_warming_replies lead_warming_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_replies
    ADD CONSTRAINT lead_warming_replies_pkey PRIMARY KEY (id);


--
-- Name: lead_warming_schedule lead_warming_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_schedule
    ADD CONSTRAINT lead_warming_schedule_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: limit_violations limit_violations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.limit_violations
    ADD CONSTRAINT limit_violations_pkey PRIMARY KEY (id);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (id);


--
-- Name: login_blocks login_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_blocks
    ADD CONSTRAINT login_blocks_pkey PRIMARY KEY (id);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: milestones milestones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT milestones_pkey PRIMARY KEY (id);


--
-- Name: modules modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modules
    ADD CONSTRAINT modules_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_client_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_clients
    ADD CONSTRAINT oauth_clients_client_id_unique UNIQUE (client_id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_codes oauth_codes_code_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_codes
    ADD CONSTRAINT oauth_codes_code_unique UNIQUE (code);


--
-- Name: oauth_codes oauth_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_codes
    ADD CONSTRAINT oauth_codes_pkey PRIMARY KEY (id);


--
-- Name: oauth_tokens oauth_tokens_access_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_tokens
    ADD CONSTRAINT oauth_tokens_access_token_unique UNIQUE (access_token);


--
-- Name: oauth_tokens oauth_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_tokens
    ADD CONSTRAINT oauth_tokens_pkey PRIMARY KEY (id);


--
-- Name: oauth_tokens oauth_tokens_refresh_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_tokens
    ADD CONSTRAINT oauth_tokens_refresh_token_unique UNIQUE (refresh_token);


--
-- Name: onboarding_progress onboarding_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_pkey PRIMARY KEY (id);


--
-- Name: order_line_items order_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_line_items
    ADD CONSTRAINT order_line_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: page_views page_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_views
    ADD CONSTRAINT page_views_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_token_unique UNIQUE (token);


--
-- Name: permission_overrides permission_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_overrides
    ADD CONSTRAINT permission_overrides_pkey PRIMARY KEY (id);


--
-- Name: pipeline_health_metrics pipeline_health_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_health_metrics
    ADD CONSTRAINT pipeline_health_metrics_pkey PRIMARY KEY (id);


--
-- Name: pipeline_stages pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);


--
-- Name: pipelines pipelines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_pkey PRIMARY KEY (id);


--
-- Name: plan_limits plan_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_limits
    ADD CONSTRAINT plan_limits_pkey PRIMARY KEY (id);


--
-- Name: plan_limits plan_limits_plan_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plan_limits
    ADD CONSTRAINT plan_limits_plan_id_unique UNIQUE (plan_id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: plans plans_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_slug_unique UNIQUE (slug);


--
-- Name: platform_settings platform_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_pkey PRIMARY KEY (id);


--
-- Name: plugin_execution_logs plugin_execution_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_execution_logs
    ADD CONSTRAINT plugin_execution_logs_pkey PRIMARY KEY (id);


--
-- Name: portal_clients portal_clients_access_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_clients
    ADD CONSTRAINT portal_clients_access_token_unique UNIQUE (access_token);


--
-- Name: portal_clients portal_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_clients
    ADD CONSTRAINT portal_clients_pkey PRIMARY KEY (id);


--
-- Name: price_book_entries price_book_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_book_entries
    ADD CONSTRAINT price_book_entries_pkey PRIMARY KEY (id);


--
-- Name: price_books price_books_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_books
    ADD CONSTRAINT price_books_pkey PRIMARY KEY (id);


--
-- Name: product_templates product_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_templates
    ADD CONSTRAINT product_templates_pkey PRIMARY KEY (id);


--
-- Name: product_templates product_templates_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_templates
    ADD CONSTRAINT product_templates_slug_unique UNIQUE (slug);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: project_tasks project_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_tasks
    ADD CONSTRAINT project_tasks_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: quote_line_items quote_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_line_items
    ADD CONSTRAINT quote_line_items_pkey PRIMARY KEY (id);


--
-- Name: quotes quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);


--
-- Name: record_permissions record_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_permissions
    ADD CONSTRAINT record_permissions_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: report_executions report_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_executions
    ADD CONSTRAINT report_executions_pkey PRIMARY KEY (id);


--
-- Name: report_templates report_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_templates
    ADD CONSTRAINT report_templates_pkey PRIMARY KEY (id);


--
-- Name: report_templates report_templates_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_templates
    ADD CONSTRAINT report_templates_slug_unique UNIQUE (slug);


--
-- Name: restore_snapshots restore_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restore_snapshots
    ADD CONSTRAINT restore_snapshots_pkey PRIMARY KEY (id);


--
-- Name: revenue_forecast_summary revenue_forecast_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_forecast_summary
    ADD CONSTRAINT revenue_forecast_summary_pkey PRIMARY KEY (id);


--
-- Name: revenue_opportunities revenue_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_opportunities
    ADD CONSTRAINT revenue_opportunities_pkey PRIMARY KEY (id);


--
-- Name: revenue_projections revenue_projections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_projections
    ADD CONSTRAINT revenue_projections_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: saved_reports saved_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports
    ADD CONSTRAINT saved_reports_pkey PRIMARY KEY (id);


--
-- Name: saved_views saved_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_pkey PRIMARY KEY (id);


--
-- Name: scheduled_reports scheduled_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_reports
    ADD CONSTRAINT scheduled_reports_pkey PRIMARY KEY (id);


--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);


--
-- Name: segments segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segments
    ADD CONSTRAINT segments_pkey PRIMARY KEY (id);


--
-- Name: selective_restore_audit_log selective_restore_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selective_restore_audit_log
    ADD CONSTRAINT selective_restore_audit_log_pkey PRIMARY KEY (id);


--
-- Name: selective_restore_logs selective_restore_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selective_restore_logs
    ADD CONSTRAINT selective_restore_logs_pkey PRIMARY KEY (id);


--
-- Name: sequence_enrollments sequence_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_pkey PRIMARY KEY (id);


--
-- Name: sequence_step_logs sequence_step_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_step_logs
    ADD CONSTRAINT sequence_step_logs_pkey PRIMARY KEY (id);


--
-- Name: sequence_steps sequence_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_steps
    ADD CONSTRAINT sequence_steps_pkey PRIMARY KEY (id);


--
-- Name: sequences sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequences
    ADD CONSTRAINT sequences_pkey PRIMARY KEY (id);


--
-- Name: service_categories service_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);


--
-- Name: service_subscriptions service_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_subscriptions
    ADD CONSTRAINT service_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_hash_unique UNIQUE (token_hash);


--
-- Name: signing_events signing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signing_events
    ADD CONSTRAINT signing_events_pkey PRIMARY KEY (id);


--
-- Name: signing_requests signing_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signing_requests
    ADD CONSTRAINT signing_requests_pkey PRIMARY KEY (id);


--
-- Name: sla_breaches sla_breaches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_breaches
    ADD CONSTRAINT sla_breaches_pkey PRIMARY KEY (id);


--
-- Name: sla_policies sla_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_policies
    ADD CONSTRAINT sla_policies_pkey PRIMARY KEY (id);


--
-- Name: sms_messages sms_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages
    ADD CONSTRAINT sms_messages_pkey PRIMARY KEY (id);


--
-- Name: sms_templates sms_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_templates
    ADD CONSTRAINT sms_templates_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: sso_sessions sso_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_sessions
    ADD CONSTRAINT sso_sessions_pkey PRIMARY KEY (id);


--
-- Name: storage_documents storage_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_documents
    ADD CONSTRAINT storage_documents_pkey PRIMARY KEY (id);


--
-- Name: storage_documents storage_documents_storage_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_documents
    ADD CONSTRAINT storage_documents_storage_key_unique UNIQUE (storage_key);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: super_admin_audit_logs super_admin_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.super_admin_audit_logs
    ADD CONSTRAINT super_admin_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: super_admin_backups super_admin_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.super_admin_backups
    ADD CONSTRAINT super_admin_backups_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_key_unique UNIQUE (key);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: tax_exemptions tax_exemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_exemptions
    ADD CONSTRAINT tax_exemptions_pkey PRIMARY KEY (id);


--
-- Name: tax_rates tax_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rates
    ADD CONSTRAINT tax_rates_pkey PRIMARY KEY (id);


--
-- Name: tenant_ai_credentials tenant_ai_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_ai_credentials
    ADD CONSTRAINT tenant_ai_credentials_pkey PRIMARY KEY (id);


--
-- Name: tenant_ai_credits tenant_ai_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_ai_credits
    ADD CONSTRAINT tenant_ai_credits_pkey PRIMARY KEY (id);


--
-- Name: tenant_ai_credits tenant_ai_credits_tenant_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_ai_credits
    ADD CONSTRAINT tenant_ai_credits_tenant_id_unique UNIQUE (tenant_id);


--
-- Name: tenant_backup_records tenant_backup_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_backup_records
    ADD CONSTRAINT tenant_backup_records_pkey PRIMARY KEY (id);


--
-- Name: tenant_backups tenant_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_backups
    ADD CONSTRAINT tenant_backups_pkey PRIMARY KEY (id);


--
-- Name: tenant_hierarchy tenant_hierarchy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_hierarchy
    ADD CONSTRAINT tenant_hierarchy_pkey PRIMARY KEY (id);


--
-- Name: tenant_members tenant_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_pkey PRIMARY KEY (id);


--
-- Name: tenant_modules tenant_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_modules
    ADD CONSTRAINT tenant_modules_pkey PRIMARY KEY (id);


--
-- Name: tenant_restore_records tenant_restore_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_restore_records
    ADD CONSTRAINT tenant_restore_records_pkey PRIMARY KEY (id);


--
-- Name: tenant_restores tenant_restores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_restores
    ADD CONSTRAINT tenant_restores_pkey PRIMARY KEY (id);


--
-- Name: tenant_templates tenant_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_templates
    ADD CONSTRAINT tenant_templates_pkey PRIMARY KEY (id);


--
-- Name: tenant_token_limits tenant_token_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_token_limits
    ADD CONSTRAINT tenant_token_limits_pkey PRIMARY KEY (id);


--
-- Name: tenant_token_limits tenant_token_limits_tenant_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_token_limits
    ADD CONSTRAINT tenant_token_limits_tenant_id_unique UNIQUE (tenant_id);


--
-- Name: tenants tenants_custom_domain_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_custom_domain_unique UNIQUE (custom_domain);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_slug_unique UNIQUE (slug);


--
-- Name: territories territories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.territories
    ADD CONSTRAINT territories_pkey PRIMARY KEY (id);


--
-- Name: territory_assignments territory_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.territory_assignments
    ADD CONSTRAINT territory_assignments_pkey PRIMARY KEY (id);


--
-- Name: ticket_replies ticket_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_replies
    ADD CONSTRAINT ticket_replies_pkey PRIMARY KEY (id);


--
-- Name: token_budgets token_budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_budgets
    ADD CONSTRAINT token_budgets_pkey PRIMARY KEY (id);


--
-- Name: usage_alerts usage_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_alerts
    ADD CONSTRAINT usage_alerts_pkey PRIMARY KEY (id);


--
-- Name: usage_snapshots usage_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_snapshots
    ADD CONSTRAINT usage_snapshots_pkey PRIMARY KEY (id);


--
-- Name: user_departures user_departures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departures
    ADD CONSTRAINT user_departures_pkey PRIMARY KEY (id);


--
-- Name: user_token_limits user_token_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_token_limits
    ADD CONSTRAINT user_token_limits_pkey PRIMARY KEY (id);


--
-- Name: user_usage user_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_usage
    ADD CONSTRAINT user_usage_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: visitors visitors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitors
    ADD CONSTRAINT visitors_pkey PRIMARY KEY (id);


--
-- Name: voice_calls voice_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_calls
    ADD CONSTRAINT voice_calls_pkey PRIMARY KEY (id);


--
-- Name: webhook_deliveries webhook_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);


--
-- Name: webhook_inbound_logs webhook_inbound_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_inbound_logs
    ADD CONSTRAINT webhook_inbound_logs_pkey PRIMARY KEY (id);


--
-- Name: webhook_queue webhook_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_queue
    ADD CONSTRAINT webhook_queue_pkey PRIMARY KEY (id);


--
-- Name: webhooks webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_conversations whatsapp_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_messages whatsapp_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_templates whatsapp_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_templates
    ADD CONSTRAINT whatsapp_templates_pkey PRIMARY KEY (id);


--
-- Name: workflow_action_logs workflow_action_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_action_logs
    ADD CONSTRAINT workflow_action_logs_pkey PRIMARY KEY (id);


--
-- Name: workflow_actions workflow_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_actions
    ADD CONSTRAINT workflow_actions_pkey PRIMARY KEY (id);


--
-- Name: workflow_execution_logs workflow_execution_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_execution_logs
    ADD CONSTRAINT workflow_execution_logs_pkey PRIMARY KEY (id);


--
-- Name: workflow_executions workflow_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_executions
    ADD CONSTRAINT workflow_executions_pkey PRIMARY KEY (id);


--
-- Name: workflows workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_pkey PRIMARY KEY (id);


--
-- Name: idx_activities_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_contact ON public.activities USING btree (contact_id);


--
-- Name: idx_activities_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_deal ON public.activities USING btree (deal_id);


--
-- Name: idx_activities_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_entity ON public.activities USING btree (entity_type, entity_id);


--
-- Name: idx_activities_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_metadata_g ON public.activities USING gin (metadata);


--
-- Name: idx_activities_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_tenant ON public.activities USING btree (tenant_id);


--
-- Name: idx_activities_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_tenant_created ON public.activities USING btree (tenant_id, created_at DESC);


--
-- Name: idx_activities_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_user ON public.activities USING btree (tenant_id, user_id, created_at DESC);


--
-- Name: idx_ai_activity_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_activity_action ON public.ai_activity USING btree (tenant_id, action, created_at);


--
-- Name: idx_ai_activity_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_activity_status ON public.ai_activity USING btree (tenant_id, status);


--
-- Name: idx_ai_activity_tenant_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_activity_tenant_time ON public.ai_activity USING btree (tenant_id, created_at);


--
-- Name: idx_ai_activity_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_activity_user ON public.ai_activity USING btree (tenant_id, user_id, created_at);


--
-- Name: idx_ai_credits_ledger_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_credits_ledger_activity ON public.ai_credits_ledger USING btree (activity_id);


--
-- Name: idx_ai_credits_ledger_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_credits_ledger_period ON public.ai_credits_ledger USING btree (tenant_id, billing_period);


--
-- Name: idx_ai_credits_ledger_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_credits_ledger_tenant ON public.ai_credits_ledger USING btree (tenant_id, created_at);


--
-- Name: idx_ai_credits_ledger_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_credits_ledger_user ON public.ai_credits_ledger USING btree (tenant_id, user_id, created_at);


--
-- Name: idx_ai_draft_templates_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_draft_templates_kind ON public.ai_draft_templates USING btree (tenant_id, kind, active);


--
-- Name: idx_ai_draft_templates_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_draft_templates_slug ON public.ai_draft_templates USING btree (tenant_id, slug) WHERE (deleted_at IS NULL);


--
-- Name: idx_ai_draft_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_draft_templates_tenant ON public.ai_draft_templates USING btree (tenant_id);


--
-- Name: idx_ai_email_drafts_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_email_drafts_metadata_g ON public.ai_email_drafts USING gin (metadata);


--
-- Name: idx_ai_email_drafts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_email_drafts_tenant ON public.ai_email_drafts USING btree (tenant_id);


--
-- Name: idx_ai_email_drafts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_email_drafts_user ON public.ai_email_drafts USING btree (tenant_id, created_by, created_at);


--
-- Name: idx_ai_insights_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_insights_metadata_g ON public.ai_insights USING gin (metadata);


--
-- Name: idx_ai_insights_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_insights_tenant ON public.ai_insights USING btree (tenant_id);


--
-- Name: idx_ai_module_config_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_module_config_gin ON public.ai_module_configs USING btree (config);


--
-- Name: idx_ai_module_config_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_module_config_unique ON public.ai_module_configs USING btree (tenant_id, module_name);


--
-- Name: idx_ai_module_configs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_module_configs_tenant ON public.ai_module_configs USING btree (tenant_id);


--
-- Name: idx_ai_provider_secrets_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_provider_secrets_active ON public.ai_provider_secrets USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_ai_provider_secrets_personal; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_provider_secrets_personal ON public.ai_provider_secrets USING btree (tenant_id, provider, user_id) WHERE ((deleted_at IS NULL) AND (key_type = 'personal'::text));


--
-- Name: idx_ai_provider_secrets_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_provider_secrets_tenant ON public.ai_provider_secrets USING btree (tenant_id);


--
-- Name: idx_ai_provider_secrets_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_provider_secrets_unique ON public.ai_provider_secrets USING btree (tenant_id, provider, key_type) WHERE (deleted_at IS NULL);


--
-- Name: idx_ai_provider_secrets_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_provider_secrets_user ON public.ai_provider_secrets USING btree (user_id);


--
-- Name: idx_ai_providers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_providers_active ON public.ai_providers USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_ai_providers_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_providers_enabled ON public.ai_providers USING btree (enabled);


--
-- Name: idx_ai_providers_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_providers_metadata_g ON public.ai_providers USING gin (metadata);


--
-- Name: idx_ai_usage_agg_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ai_usage_agg_unique ON public.ai_usage_aggregated USING btree (tenant_id, module_name, billing_period);


--
-- Name: idx_ai_usage_aggregated_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_aggregated_tenant ON public.ai_usage_aggregated USING btree (tenant_id);


--
-- Name: idx_ai_usage_logs_feature; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_logs_feature ON public.ai_usage_logs USING btree (tenant_id, feature, created_at);


--
-- Name: idx_ai_usage_logs_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_logs_metadata_g ON public.ai_usage_logs USING gin (metadata);


--
-- Name: idx_ai_usage_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_logs_tenant ON public.ai_usage_logs USING btree (tenant_id);


--
-- Name: idx_announcements_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_active ON public.announcements USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_announcements_active_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_active_time ON public.announcements USING btree (is_active, starts_at, ends_at);


--
-- Name: idx_api_key_usage_infra_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_key_usage_infra_tenant ON public.api_key_usage_infra USING btree (tenant_id);


--
-- Name: idx_api_key_usage_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_key_usage_key ON public.api_key_usage_infra USING btree (api_key_id, created_at);


--
-- Name: idx_api_key_usage_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_key_usage_tenant ON public.api_key_usage USING btree (tenant_id, created_at DESC);


--
-- Name: idx_api_keys_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_metadata_g ON public.api_keys USING gin (metadata);


--
-- Name: idx_api_keys_reg_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_reg_service ON public.api_keys_registry USING btree (service, is_active);


--
-- Name: idx_api_keys_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_tenant ON public.api_keys USING btree (tenant_id);


--
-- Name: idx_approval_requests_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_requests_entity ON public.approval_requests USING btree (tenant_id, entity_type, entity_id);


--
-- Name: idx_approval_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_requests_status ON public.approval_requests USING btree (tenant_id, status);


--
-- Name: idx_approval_requests_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_requests_tenant ON public.approval_requests USING btree (tenant_id);


--
-- Name: idx_assignment_logs_assignee; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_logs_assignee ON public.assignment_logs USING btree (tenant_id, assigned_to);


--
-- Name: idx_assignment_logs_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_logs_entity ON public.assignment_logs USING btree (tenant_id, entity_type, entity_id);


--
-- Name: idx_assignment_logs_rule; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_logs_rule ON public.assignment_logs USING btree (tenant_id, rule_id);


--
-- Name: idx_assignment_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_logs_tenant ON public.assignment_logs USING btree (tenant_id);


--
-- Name: idx_assignment_rules_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_rules_active ON public.assignment_rules USING btree (tenant_id, is_active);


--
-- Name: idx_assignment_rules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_rules_tenant ON public.assignment_rules USING btree (tenant_id);


--
-- Name: idx_assignment_rules_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_rules_type ON public.assignment_rules USING btree (tenant_id, type);


--
-- Name: idx_at_risk_rules_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_at_risk_rules_active ON public.at_risk_rules USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_at_risk_rules_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_at_risk_rules_stage ON public.at_risk_rules USING btree (tenant_id, stage_id);


--
-- Name: idx_at_risk_rules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_at_risk_rules_tenant ON public.at_risk_rules USING btree (tenant_id);


--
-- Name: idx_audit_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (tenant_id, action, created_at DESC);


--
-- Name: idx_audit_logs_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_entity ON public.audit_logs USING btree (entity_type, entity_id);


--
-- Name: idx_audit_logs_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_metadata_g ON public.audit_logs USING gin (metadata);


--
-- Name: idx_audit_logs_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_resource ON public.audit_logs USING btree (tenant_id, entity_type, entity_id, created_at DESC);


--
-- Name: idx_audit_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_tenant ON public.audit_logs USING btree (tenant_id);


--
-- Name: idx_audit_logs_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_tenant_created ON public.audit_logs USING btree (tenant_id, created_at DESC);


--
-- Name: idx_audit_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree (tenant_id, user_id, created_at DESC);


--
-- Name: idx_automation_runs_automation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_runs_automation ON public.automation_runs USING btree (automation_id);


--
-- Name: idx_automation_runs_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_runs_metadata_g ON public.automation_runs USING gin (metadata);


--
-- Name: idx_automation_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_runs_status ON public.automation_runs USING btree (status, started_at);


--
-- Name: idx_automation_runs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_runs_tenant ON public.automation_runs USING btree (tenant_id);


--
-- Name: idx_automation_workflows_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_workflows_active ON public.automation_workflows USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_automation_workflows_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_workflows_tenant ON public.automation_workflows USING btree (tenant_id);


--
-- Name: idx_automation_workflows_tenant_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_automation_workflows_tenant_workflow ON public.automation_workflows USING btree (tenant_id, workflow_id);


--
-- Name: idx_automations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automations_active ON public.automations USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_automations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automations_tenant ON public.automations USING btree (tenant_id);


--
-- Name: idx_backup_alerts_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backup_alerts_unresolved ON public.backup_alerts USING btree (resolved, created_at) WHERE (resolved = false);


--
-- Name: idx_backup_records_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backup_records_status ON public.backup_records USING btree (status, completed_at);


--
-- Name: idx_backup_schedules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backup_schedules_tenant ON public.backup_schedules USING btree (tenant_id);


--
-- Name: idx_billing_events_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_events_metadata_g ON public.billing_events USING gin (metadata);


--
-- Name: idx_billing_events_stripe_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_events_stripe_event ON public.billing_events USING btree (stripe_event_id) WHERE (stripe_event_id IS NOT NULL);


--
-- Name: idx_billing_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_events_tenant ON public.billing_events USING btree (tenant_id);


--
-- Name: idx_billing_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_billing_events_type ON public.billing_events USING btree (event_type, created_at);


--
-- Name: idx_call_logs_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_metadata_g ON public.call_logs USING gin (metadata);


--
-- Name: idx_call_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_logs_tenant ON public.call_logs USING btree (tenant_id);


--
-- Name: idx_call_notes_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_notes_contact ON public.call_notes USING btree (tenant_id, contact_id, created_at);


--
-- Name: idx_call_notes_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_notes_tenant ON public.call_notes USING btree (tenant_id);


--
-- Name: idx_call_recordings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_recordings_tenant ON public.call_recordings USING btree (tenant_id);


--
-- Name: idx_chat_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_session ON public.chat_messages USING btree (session_id);


--
-- Name: idx_chat_messages_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_messages_tenant ON public.chat_messages USING btree (tenant_id);


--
-- Name: idx_chat_sessions_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_assigned ON public.chat_sessions USING btree (assigned_to);


--
-- Name: idx_chat_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_status ON public.chat_sessions USING btree (tenant_id, status);


--
-- Name: idx_chat_sessions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_tenant ON public.chat_sessions USING btree (tenant_id);


--
-- Name: idx_chat_sessions_visitor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_chat_sessions_visitor ON public.chat_sessions USING btree (visitor_id);


--
-- Name: idx_churn_predictions_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_churn_predictions_contact ON public.churn_predictions USING btree (contact_id);


--
-- Name: idx_churn_predictions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_churn_predictions_tenant ON public.churn_predictions USING btree (tenant_id);


--
-- Name: idx_comm_email_drafts_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_email_drafts_metadata_g ON public.comm_email_drafts USING gin (metadata);


--
-- Name: idx_comm_email_drafts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_email_drafts_tenant ON public.comm_email_drafts USING btree (tenant_id);


--
-- Name: idx_companies_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_active ON public.companies USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_companies_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_domain ON public.companies USING btree (domain);


--
-- Name: idx_companies_industry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_industry ON public.companies USING btree (tenant_id, industry) WHERE (deleted_at IS NULL);


--
-- Name: idx_companies_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_metadata_g ON public.companies USING gin (metadata);


--
-- Name: idx_companies_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_name ON public.companies USING btree (name);


--
-- Name: idx_companies_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_search ON public.companies USING gin (to_tsvector('english'::regconfig, ((name || ' '::text) || COALESCE(domain, ''::text))));


--
-- Name: idx_companies_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_tenant ON public.companies USING btree (tenant_id);


--
-- Name: idx_companies_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_tenant_created ON public.companies USING btree (tenant_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_compliance_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_requests_status ON public.compliance_requests USING btree (tenant_id, status);


--
-- Name: idx_compliance_requests_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_requests_tenant ON public.compliance_requests USING btree (tenant_id);


--
-- Name: idx_compliance_requests_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_requests_type ON public.compliance_requests USING btree (tenant_id, type);


--
-- Name: idx_contact_emails_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_emails_contact ON public.contact_emails USING btree (contact_id);


--
-- Name: idx_contact_emails_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_contact_emails_unique ON public.contact_emails USING btree (contact_id, email);


--
-- Name: idx_contact_lifecycle_history_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_lifecycle_history_contact ON public.contact_lifecycle_history USING btree (contact_id, changed_at);


--
-- Name: idx_contact_lifecycle_history_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_lifecycle_history_metadata_g ON public.contact_lifecycle_history USING gin (metadata);


--
-- Name: idx_contact_lifecycle_history_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_lifecycle_history_tenant ON public.contact_lifecycle_history USING btree (tenant_id);


--
-- Name: idx_contact_merge_history_merged; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_merge_history_merged ON public.contact_merge_history USING btree (merged_contact_id, merged_at);


--
-- Name: idx_contact_merge_history_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_merge_history_metadata_g ON public.contact_merge_history USING gin (metadata);


--
-- Name: idx_contact_merge_history_primary; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_merge_history_primary ON public.contact_merge_history USING btree (primary_contact_id, merged_at);


--
-- Name: idx_contact_merge_history_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_merge_history_tenant ON public.contact_merge_history USING btree (tenant_id);


--
-- Name: idx_contact_scores_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_scores_contact ON public.contact_scores USING btree (contact_id);


--
-- Name: idx_contact_scores_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_scores_tenant ON public.contact_scores USING btree (tenant_id);


--
-- Name: idx_contacts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_active ON public.contacts USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_contacts_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_assigned ON public.contacts USING btree (assigned_to);


--
-- Name: idx_contacts_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_company ON public.contacts USING btree (company_id);


--
-- Name: idx_contacts_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_created_by ON public.contacts USING btree (created_by);


--
-- Name: idx_contacts_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_email ON public.contacts USING btree (tenant_id, email);


--
-- Name: idx_contacts_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_email_lower ON public.contacts USING btree (lower(email)) WHERE ((deleted_at IS NULL) AND (email IS NOT NULL));


--
-- Name: idx_contacts_lifecycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_lifecycle ON public.contacts USING btree (tenant_id, lifecycle_stage) WHERE (deleted_at IS NULL);


--
-- Name: idx_contacts_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_metadata_g ON public.contacts USING gin (metadata);


--
-- Name: idx_contacts_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_search ON public.contacts USING gin (to_tsvector('english'::regconfig, ((((first_name || ' '::text) || COALESCE(last_name, ''::text)) || ' '::text) || COALESCE(email, ''::text))));


--
-- Name: idx_contacts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_status ON public.contacts USING btree (tenant_id, lead_status) WHERE (deleted_at IS NULL);


--
-- Name: idx_contacts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_tenant ON public.contacts USING btree (tenant_id);


--
-- Name: idx_contacts_tenant_archived_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_tenant_archived_created ON public.contacts USING btree (tenant_id, is_archived, created_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_contacts_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_tenant_created ON public.contacts USING btree (tenant_id, created_at);


--
-- Name: idx_contacts_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_tenant_status ON public.contacts USING btree (tenant_id, lead_status);


--
-- Name: idx_content_generations_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_generations_metadata_g ON public.content_generations USING gin (metadata);


--
-- Name: idx_content_generations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_generations_tenant ON public.content_generations USING btree (tenant_id);


--
-- Name: idx_contracts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_active ON public.contracts USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_contracts_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_company ON public.contracts USING btree (company_id);


--
-- Name: idx_contracts_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_contact ON public.contracts USING btree (contact_id);


--
-- Name: idx_contracts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_status ON public.contracts USING btree (tenant_id, status);


--
-- Name: idx_contracts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contracts_tenant ON public.contracts USING btree (tenant_id);


--
-- Name: idx_conv_keywords_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_keywords_tenant ON public.conversation_keywords USING btree (tenant_id, count);


--
-- Name: idx_conv_metrics_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conv_metrics_contact ON public.conversation_metrics USING btree (contact_id);


--
-- Name: idx_conversation_keywords_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversation_keywords_tenant ON public.conversation_keywords USING btree (tenant_id);


--
-- Name: idx_conversation_metrics_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversation_metrics_tenant ON public.conversation_metrics USING btree (tenant_id);


--
-- Name: idx_cost_anomalies_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_anomalies_tenant ON public.cost_anomalies USING btree (tenant_id);


--
-- Name: idx_cost_anomalies_unreviewed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cost_anomalies_unreviewed ON public.cost_anomalies USING btree (reviewed);


--
-- Name: idx_critical_backups_can_restore; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_critical_backups_can_restore ON public.critical_data_backups USING btree (can_restore, backed_up_at);


--
-- Name: idx_critical_backups_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_critical_backups_record ON public.critical_data_backups USING btree (table_name, record_id);


--
-- Name: idx_critical_backups_retain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_critical_backups_retain ON public.critical_data_backups USING btree (retained_until);


--
-- Name: idx_critical_backups_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_critical_backups_tenant ON public.critical_data_backups USING btree (tenant_id, table_name);


--
-- Name: idx_custom_fields_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_fields_key ON public.custom_field_defs USING btree (field_key);


--
-- Name: idx_custom_fields_tenant_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_fields_tenant_entity ON public.custom_field_defs USING btree (tenant_id, entity_type);


--
-- Name: idx_custom_fields_unique_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_custom_fields_unique_key ON public.custom_field_defs USING btree (tenant_id, entity_type, field_key);


--
-- Name: idx_custom_plugins_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_plugins_active ON public.custom_plugins USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_custom_plugins_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_plugins_metadata_g ON public.custom_plugins USING gin (metadata);


--
-- Name: idx_custom_plugins_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_plugins_status ON public.custom_plugins USING btree (tenant_id, status);


--
-- Name: idx_custom_plugins_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_plugins_tenant ON public.custom_plugins USING btree (tenant_id);


--
-- Name: idx_custom_plugins_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_plugins_user ON public.custom_plugins USING btree (user_id);


--
-- Name: idx_dashboard_layouts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_layouts_tenant ON public.dashboard_layouts USING btree (tenant_id);


--
-- Name: idx_dashboard_layouts_user_default; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_layouts_user_default ON public.dashboard_layouts USING btree (user_id, is_default);


--
-- Name: idx_dashboard_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_templates_active ON public.dashboard_templates USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_dashboards_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboards_active ON public.dashboards USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_dashboards_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboards_tenant ON public.dashboards USING btree (tenant_id);


--
-- Name: idx_data_retention_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_retention_entity ON public.data_retention_policies USING btree (tenant_id, entity_type);


--
-- Name: idx_data_retention_policies_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_data_retention_policies_tenant ON public.data_retention_policies USING btree (tenant_id);


--
-- Name: idx_dead_letter_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dead_letter_created ON public.dead_letter_queue USING btree (created_at);


--
-- Name: idx_dead_letter_job_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dead_letter_job_type ON public.dead_letter_queue USING btree (job_type);


--
-- Name: idx_dead_letter_queue_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dead_letter_queue_tenant ON public.dead_letter_queue USING btree (tenant_id);


--
-- Name: idx_dead_letter_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dead_letter_status ON public.dead_letter_queue USING btree (status, tenant_id);


--
-- Name: idx_deal_forecasts_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_forecasts_deal ON public.deal_forecasts USING btree (deal_id);


--
-- Name: idx_deal_forecasts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_forecasts_tenant ON public.deal_forecasts USING btree (tenant_id);


--
-- Name: idx_deal_products_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_products_deal ON public.deal_products USING btree (deal_id);


--
-- Name: idx_deal_products_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_products_tenant ON public.deal_products USING btree (tenant_id);


--
-- Name: idx_deal_stages_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_stages_metadata_g ON public.deal_stages USING gin (metadata);


--
-- Name: idx_deal_stages_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deal_stages_pipeline ON public.deal_stages USING btree (pipeline_id, "order");


--
-- Name: idx_deals_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_active ON public.deals USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_deals_amount; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_amount ON public.deals USING btree (tenant_id, ((amount)::numeric)) WHERE ((deleted_at IS NULL) AND (amount IS NOT NULL));


--
-- Name: idx_deals_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_assigned ON public.deals USING btree (assigned_to);


--
-- Name: idx_deals_close_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_close_date ON public.deals USING btree (close_date);


--
-- Name: idx_deals_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_contact ON public.deals USING btree (contact_id);


--
-- Name: idx_deals_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_metadata_g ON public.deals USING gin (metadata);


--
-- Name: idx_deals_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_pipeline ON public.deals USING btree (tenant_id, pipeline_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_deals_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_stage ON public.deals USING btree (stage_id);


--
-- Name: idx_deals_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_tenant ON public.deals USING btree (tenant_id);


--
-- Name: idx_deals_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_tenant_created ON public.deals USING btree (tenant_id, created_at);


--
-- Name: idx_deals_tenant_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_tenant_stage ON public.deals USING btree (tenant_id, stage_id);


--
-- Name: idx_document_folders_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_folders_parent ON public.document_folders USING btree (tenant_id, parent_id);


--
-- Name: idx_document_folders_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_document_folders_tenant ON public.document_folders USING btree (tenant_id);


--
-- Name: idx_documents_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_entity ON public.documents USING btree (tenant_id, entity_type, entity_id);


--
-- Name: idx_documents_folder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_folder ON public.documents USING btree (tenant_id, folder_id);


--
-- Name: idx_documents_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_tenant ON public.documents USING btree (tenant_id);


--
-- Name: idx_documents_uploader; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_uploader ON public.documents USING btree (tenant_id, uploaded_by);


--
-- Name: idx_edit_history_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_edit_history_created ON public.edit_history USING btree (created_at);


--
-- Name: idx_edit_history_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_edit_history_entity ON public.edit_history USING btree (entity_type, entity_id);


--
-- Name: idx_edit_history_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_edit_history_tenant ON public.edit_history USING btree (tenant_id);


--
-- Name: idx_edit_history_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_edit_history_user ON public.edit_history USING btree (user_id);


--
-- Name: idx_email_clicks_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_clicks_campaign ON public.email_clicks USING btree (campaign_id);


--
-- Name: idx_email_clicks_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_clicks_contact ON public.email_clicks USING btree (contact_id);


--
-- Name: idx_email_clicks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_clicks_tenant ON public.email_clicks USING btree (tenant_id);


--
-- Name: idx_email_log_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_log_contact ON public.email_log USING btree (contact_id, created_at);


--
-- Name: idx_email_log_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_log_status ON public.email_log USING btree (status, created_at);


--
-- Name: idx_email_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_log_tenant ON public.email_log USING btree (tenant_id);


--
-- Name: idx_email_opens_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_opens_campaign ON public.email_opens USING btree (campaign_id);


--
-- Name: idx_email_opens_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_opens_contact ON public.email_opens USING btree (contact_id);


--
-- Name: idx_email_opens_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_opens_tenant ON public.email_opens USING btree (tenant_id);


--
-- Name: idx_email_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_templates_active ON public.email_templates USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_email_templates_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_templates_metadata_g ON public.email_templates USING gin (metadata);


--
-- Name: idx_email_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_templates_tenant ON public.email_templates USING btree (tenant_id);


--
-- Name: idx_email_tracking_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_tracking_metadata_g ON public.email_tracking USING gin (metadata);


--
-- Name: idx_email_tracking_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_tracking_tenant ON public.email_tracking USING btree (tenant_id);


--
-- Name: idx_email_warmup_configs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_warmup_configs_tenant ON public.email_warmup_configs USING btree (tenant_id);


--
-- Name: idx_email_warmup_logs_config; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_warmup_logs_config ON public.email_warmup_logs USING btree (config_id, created_at);


--
-- Name: idx_email_warmup_pool_config; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_warmup_pool_config ON public.email_warmup_pool USING btree (config_id, status);


--
-- Name: idx_email_warmup_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_warmup_unique ON public.email_warmup_configs USING btree (tenant_id, from_email);


--
-- Name: idx_entity_tags_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_tags_lookup ON public.entity_tags USING btree (entity_type, entity_id);


--
-- Name: idx_entity_tags_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entity_tags_tenant ON public.entity_tags USING btree (tenant_id);


--
-- Name: idx_error_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_created ON public.error_logs USING btree (created_at);


--
-- Name: idx_error_logs_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_level ON public.error_logs USING btree (level);


--
-- Name: idx_error_logs_resolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_resolved ON public.error_logs USING btree (resolved);


--
-- Name: idx_error_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_tenant ON public.error_logs USING btree (tenant_id);


--
-- Name: idx_error_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_error_logs_user ON public.error_logs USING btree (user_id);


--
-- Name: idx_exchange_rates_fetched; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exchange_rates_fetched ON public.exchange_rates USING btree (fetched_at);


--
-- Name: idx_exchange_rates_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exchange_rates_pair ON public.exchange_rates USING btree (base_currency, target_currency);


--
-- Name: idx_failed_webhooks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_failed_webhooks_tenant ON public.failed_webhooks USING btree (tenant_id);


--
-- Name: idx_failed_webhooks_webhook; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_failed_webhooks_webhook ON public.failed_webhooks USING btree (webhook_id);


--
-- Name: idx_feature_registry_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feature_registry_enabled ON public.feature_registry USING btree (enabled);


--
-- Name: idx_field_permissions_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_field_permissions_unique ON public.field_permissions USING btree (tenant_id, role_id, entity_type, field_name);


--
-- Name: idx_file_attachments_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_attachments_entity ON public.file_attachments USING btree (entity_type, entity_id);


--
-- Name: idx_file_attachments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_attachments_tenant ON public.file_attachments USING btree (tenant_id);


--
-- Name: idx_file_uploads_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_uploads_active ON public.file_uploads USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_file_uploads_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_uploads_entity ON public.file_uploads USING btree (entity_type, entity_id);


--
-- Name: idx_file_uploads_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_uploads_tenant ON public.file_uploads USING btree (tenant_id);


--
-- Name: idx_files_link; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_link ON public.storage_documents USING btree (linked_entity_type, linked_entity_id);


--
-- Name: idx_files_uploader; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_files_uploader ON public.storage_documents USING btree (uploaded_by);


--
-- Name: idx_follow_ups_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follow_ups_active ON public.follow_ups USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_follow_ups_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follow_ups_assigned ON public.follow_ups USING btree (assigned_to);


--
-- Name: idx_follow_ups_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follow_ups_contact ON public.follow_ups USING btree (contact_id);


--
-- Name: idx_follow_ups_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follow_ups_deal ON public.follow_ups USING btree (deal_id);


--
-- Name: idx_follow_ups_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follow_ups_due_date ON public.follow_ups USING btree (due_date);


--
-- Name: idx_follow_ups_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follow_ups_lead ON public.follow_ups USING btree (lead_id);


--
-- Name: idx_follow_ups_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follow_ups_status ON public.follow_ups USING btree (tenant_id, status);


--
-- Name: idx_follow_ups_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_follow_ups_tenant ON public.follow_ups USING btree (tenant_id);


--
-- Name: idx_form_submissions_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_submissions_contact ON public.form_submissions USING btree (contact_id) WHERE (contact_id IS NOT NULL);


--
-- Name: idx_form_submissions_form; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_submissions_form ON public.form_submissions USING btree (form_id, created_at);


--
-- Name: idx_form_submissions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_submissions_tenant ON public.form_submissions USING btree (tenant_id);


--
-- Name: idx_forms_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forms_active ON public.forms USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_forms_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_forms_slug ON public.forms USING btree (slug);


--
-- Name: idx_forms_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forms_tenant ON public.forms USING btree (tenant_id);


--
-- Name: idx_health_checks_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_health_checks_service ON public.health_checks USING btree (service, checked_at);


--
-- Name: idx_impersonation_sessions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impersonation_sessions_active ON public.impersonation_sessions USING btree (impersonator_id, started_at) WHERE (ended_at IS NULL);


--
-- Name: idx_integrations_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integrations_metadata_g ON public.integrations USING btree (config);


--
-- Name: idx_integrations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integrations_tenant ON public.integrations USING btree (tenant_id);


--
-- Name: idx_integrations_tenant_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integrations_tenant_type ON public.integrations USING btree (tenant_id, type);


--
-- Name: idx_invitations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_tenant ON public.invitations USING btree (tenant_id);


--
-- Name: idx_invitations_tenant_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_invitations_tenant_email ON public.invitations USING btree (tenant_id, email);


--
-- Name: idx_invoice_line_items_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_line_items_invoice ON public.invoice_line_items USING btree (invoice_id);


--
-- Name: idx_invoice_line_items_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_line_items_tenant ON public.invoice_line_items USING btree (tenant_id);


--
-- Name: idx_invoice_payments_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_payments_date ON public.invoice_payments USING btree (payment_date);


--
-- Name: idx_invoice_payments_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_payments_invoice ON public.invoice_payments USING btree (invoice_id);


--
-- Name: idx_invoice_payments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoice_payments_tenant ON public.invoice_payments USING btree (tenant_id);


--
-- Name: idx_invoices_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_active ON public.invoices USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_invoices_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_company ON public.invoices USING btree (company_id);


--
-- Name: idx_invoices_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_contact ON public.invoices USING btree (contact_id);


--
-- Name: idx_invoices_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_due_date ON public.invoices USING btree (due_date);


--
-- Name: idx_invoices_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_invoices_number ON public.invoices USING btree (tenant_id, invoice_number);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.invoices USING btree (tenant_id, status);


--
-- Name: idx_invoices_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_tenant ON public.invoices USING btree (tenant_id);


--
-- Name: idx_kb_articles_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_articles_active ON public.kb_articles USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_kb_articles_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_articles_category ON public.kb_articles USING btree (category_id);


--
-- Name: idx_kb_articles_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_articles_metadata_g ON public.kb_articles USING gin (metadata);


--
-- Name: idx_kb_articles_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_articles_search ON public.kb_articles USING gin (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(content, ''::text))));


--
-- Name: idx_kb_articles_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_articles_slug ON public.kb_articles USING btree (tenant_id, slug);


--
-- Name: idx_kb_articles_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_articles_status ON public.kb_articles USING btree (tenant_id, status);


--
-- Name: idx_kb_articles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_articles_tenant ON public.kb_articles USING btree (tenant_id);


--
-- Name: idx_kb_categories_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_categories_active ON public.kb_categories USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_kb_categories_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_categories_slug ON public.kb_categories USING btree (tenant_id, slug);


--
-- Name: idx_kb_categories_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_categories_tenant ON public.kb_categories USING btree (tenant_id);


--
-- Name: idx_lead_activities_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_activities_lead ON public.lead_activities USING btree (tenant_id, lead_id, created_at DESC);


--
-- Name: idx_lead_activities_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_activities_metadata_g ON public.lead_activities USING gin (metadata);


--
-- Name: idx_lead_activities_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_activities_tenant ON public.lead_activities USING btree (tenant_id);


--
-- Name: idx_lead_activities_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_activities_tenant_created ON public.lead_activities USING btree (tenant_id, created_at DESC);


--
-- Name: idx_lead_activities_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_activities_type ON public.lead_activities USING btree (tenant_id, activity_type, created_at DESC);


--
-- Name: idx_lead_assignments_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_assignments_contact ON public.lead_assignments USING btree (contact_id);


--
-- Name: idx_lead_assignments_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_assignments_lead ON public.lead_assignments USING btree (lead_id);


--
-- Name: idx_lead_assignments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_assignments_tenant ON public.lead_assignments USING btree (tenant_id);


--
-- Name: idx_lead_assignments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_assignments_user ON public.lead_assignments USING btree (user_id);


--
-- Name: idx_lead_offers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_offers_active ON public.lead_offers USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_lead_offers_lead; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_offers_lead ON public.lead_offers USING btree (lead_id);


--
-- Name: idx_lead_offers_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_offers_metadata_g ON public.lead_offers USING gin (metadata);


--
-- Name: idx_lead_offers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_offers_tenant ON public.lead_offers USING btree (tenant_id);


--
-- Name: idx_lead_offers_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_offers_tenant_status ON public.lead_offers USING btree (tenant_id, status);


--
-- Name: idx_lead_scoring_rules_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_scoring_rules_active ON public.lead_scoring_rules USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_lead_scoring_rules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_scoring_rules_tenant ON public.lead_scoring_rules USING btree (tenant_id);


--
-- Name: idx_lead_warming_campaigns_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_campaigns_active ON public.lead_warming_campaigns USING btree (status) WHERE (status = 'active'::text);


--
-- Name: idx_lead_warming_campaigns_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_campaigns_status ON public.lead_warming_campaigns USING btree (tenant_id, status);


--
-- Name: idx_lead_warming_campaigns_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_campaigns_tenant ON public.lead_warming_campaigns USING btree (tenant_id);


--
-- Name: idx_lead_warming_events_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_events_active ON public.lead_warming_events USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_lead_warming_events_month_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_events_month_day ON public.lead_warming_events USING btree (event_month, event_day);


--
-- Name: idx_lead_warming_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_events_tenant ON public.lead_warming_events USING btree (tenant_id);


--
-- Name: idx_lead_warming_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_events_type ON public.lead_warming_events USING btree (event_type);


--
-- Name: idx_lead_warming_messages_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_messages_tenant ON public.lead_warming_messages USING btree (tenant_id);


--
-- Name: idx_lead_warming_msg_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_msg_campaign ON public.lead_warming_messages USING btree (campaign_id, created_at);


--
-- Name: idx_lead_warming_msg_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_msg_channel ON public.lead_warming_messages USING btree (tenant_id, channel, sent_at);


--
-- Name: idx_lead_warming_msg_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_msg_contact ON public.lead_warming_messages USING btree (contact_id, created_at);


--
-- Name: idx_lead_warming_msg_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_msg_status ON public.lead_warming_messages USING btree (status, sent_at);


--
-- Name: idx_lead_warming_replies_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_replies_contact ON public.lead_warming_replies USING btree (contact_id);


--
-- Name: idx_lead_warming_replies_intent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_replies_intent ON public.lead_warming_replies USING btree (tenant_id, intent);


--
-- Name: idx_lead_warming_replies_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_replies_message ON public.lead_warming_replies USING btree (message_id);


--
-- Name: idx_lead_warming_replies_positive; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_replies_positive ON public.lead_warming_replies USING btree (tenant_id, intent) WHERE (intent = 'interested'::text);


--
-- Name: idx_lead_warming_replies_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_replies_tenant ON public.lead_warming_replies USING btree (tenant_id);


--
-- Name: idx_lead_warming_replies_unanalyzed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_replies_unanalyzed ON public.lead_warming_replies USING btree (ai_analyzed) WHERE (ai_analyzed = false);


--
-- Name: idx_lead_warming_sched_eligible; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_sched_eligible ON public.lead_warming_schedule USING btree (next_eligible_at) WHERE (opted_out = false);


--
-- Name: idx_lead_warming_sched_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_lead_warming_sched_unique ON public.lead_warming_schedule USING btree (contact_id, campaign_id);


--
-- Name: idx_lead_warming_schedule_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lead_warming_schedule_tenant ON public.lead_warming_schedule USING btree (tenant_id);


--
-- Name: idx_leads_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_active ON public.leads USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_leads_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_assigned ON public.leads USING btree (assigned_to);


--
-- Name: idx_leads_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_contact ON public.leads USING btree (contact_id);


--
-- Name: idx_leads_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_email ON public.leads USING btree (email);


--
-- Name: idx_leads_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_email_lower ON public.leads USING btree (lower(email)) WHERE ((deleted_at IS NULL) AND (email IS NOT NULL));


--
-- Name: idx_leads_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_metadata_g ON public.leads USING gin (metadata);


--
-- Name: idx_leads_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_source ON public.leads USING btree (tenant_id, lead_source) WHERE (deleted_at IS NULL);


--
-- Name: idx_leads_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_tenant ON public.leads USING btree (tenant_id);


--
-- Name: idx_leads_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_tenant_created ON public.leads USING btree (tenant_id, created_at);


--
-- Name: idx_leads_tenant_oid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_tenant_oid ON public.leads USING btree (tenant_id, lead_oid);


--
-- Name: idx_leads_tenant_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_tenant_product ON public.leads USING btree (tenant_id, product_id);


--
-- Name: idx_leads_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_leads_tenant_status ON public.leads USING btree (tenant_id, lead_status);


--
-- Name: idx_limit_violations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_limit_violations_tenant ON public.limit_violations USING btree (tenant_id);


--
-- Name: idx_limit_violations_unresolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_limit_violations_unresolved ON public.limit_violations USING btree (resolved, exceeded_at) WHERE (resolved = false);


--
-- Name: idx_login_attempts_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_email ON public.login_attempts USING btree (email);


--
-- Name: idx_login_attempts_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_ip ON public.login_attempts USING btree (ip_address);


--
-- Name: idx_login_attempts_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_time ON public.login_attempts USING btree (attempted_at);


--
-- Name: idx_login_blocks_identifier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_blocks_identifier ON public.login_blocks USING btree (identifier);


--
-- Name: idx_login_blocks_identifier_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_login_blocks_identifier_type ON public.login_blocks USING btree (identifier, identifier_type);


--
-- Name: idx_login_blocks_until; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_blocks_until ON public.login_blocks USING btree (blocked_until);


--
-- Name: idx_meetings_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_active ON public.meetings USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_meetings_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_contact ON public.meetings USING btree (contact_id);


--
-- Name: idx_meetings_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_created_by ON public.meetings USING btree (created_by);


--
-- Name: idx_meetings_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_deal ON public.meetings USING btree (deal_id);


--
-- Name: idx_meetings_start_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_start_time ON public.meetings USING btree (start_time);


--
-- Name: idx_meetings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_status ON public.meetings USING btree (status);


--
-- Name: idx_meetings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_tenant ON public.meetings USING btree (tenant_id);


--
-- Name: idx_meetings_tenant_start_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_tenant_start_active ON public.meetings USING btree (tenant_id, start_time) WHERE (deleted_at IS NULL);


--
-- Name: idx_meetings_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_meetings_user ON public.meetings USING btree (user_id);


--
-- Name: idx_milestones_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_milestones_project ON public.milestones USING btree (project_id);


--
-- Name: idx_milestones_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_milestones_tenant ON public.milestones USING btree (tenant_id);


--
-- Name: idx_notes_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_active ON public.notes USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_notes_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_entity ON public.notes USING btree (entity_type, entity_id, created_at);


--
-- Name: idx_notes_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_tenant ON public.notes USING btree (tenant_id);


--
-- Name: idx_notifications_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_metadata_g ON public.notifications USING gin (metadata);


--
-- Name: idx_notifications_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recent ON public.notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);


--
-- Name: idx_notifications_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_tenant ON public.notifications USING btree (tenant_id);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id, tenant_id) WHERE (read_at IS NULL);


--
-- Name: idx_notifications_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user ON public.notifications USING btree (user_id);


--
-- Name: idx_oauth_clients_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_oauth_clients_client_id ON public.oauth_clients USING btree (client_id);


--
-- Name: idx_oauth_clients_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_clients_tenant ON public.oauth_clients USING btree (tenant_id);


--
-- Name: idx_oauth_codes_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_codes_client ON public.oauth_codes USING btree (client_id);


--
-- Name: idx_oauth_codes_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_oauth_codes_code ON public.oauth_codes USING btree (code);


--
-- Name: idx_oauth_tokens_access; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_oauth_tokens_access ON public.oauth_tokens USING btree (access_token);


--
-- Name: idx_oauth_tokens_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_tokens_client ON public.oauth_tokens USING btree (client_id);


--
-- Name: idx_oauth_tokens_refresh; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_tokens_refresh ON public.oauth_tokens USING btree (refresh_token);


--
-- Name: idx_oauth_tokens_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_tokens_user ON public.oauth_tokens USING btree (user_id);


--
-- Name: idx_onboarding_progress_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_progress_tenant ON public.onboarding_progress USING btree (tenant_id);


--
-- Name: idx_onboarding_progress_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_onboarding_progress_unique ON public.onboarding_progress USING btree (tenant_id, user_id, step_name);


--
-- Name: idx_onboarding_step; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_step ON public.onboarding_progress USING btree (step_name, is_completed);


--
-- Name: idx_onboarding_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_onboarding_tenant_user ON public.onboarding_progress USING btree (tenant_id, user_id);


--
-- Name: idx_order_line_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_line_items_order ON public.order_line_items USING btree (order_id);


--
-- Name: idx_order_line_items_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_line_items_tenant ON public.order_line_items USING btree (tenant_id);


--
-- Name: idx_orders_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_active ON public.orders USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_orders_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_company ON public.orders USING btree (company_id);


--
-- Name: idx_orders_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_contact ON public.orders USING btree (contact_id);


--
-- Name: idx_orders_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_orders_number ON public.orders USING btree (tenant_id, order_number);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (tenant_id, status);


--
-- Name: idx_orders_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_tenant ON public.orders USING btree (tenant_id);


--
-- Name: idx_permission_overrides_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_overrides_entity ON public.permission_overrides USING btree (entity_type, entity_id);


--
-- Name: idx_permission_overrides_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_overrides_role ON public.permission_overrides USING btree (role_id);


--
-- Name: idx_permission_overrides_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permission_overrides_tenant ON public.permission_overrides USING btree (tenant_id);


--
-- Name: idx_pipeline_health_metrics_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_health_metrics_tenant ON public.pipeline_health_metrics USING btree (tenant_id);


--
-- Name: idx_pipeline_health_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pipeline_health_unique ON public.pipeline_health_metrics USING btree (pipeline_id, metric_date);


--
-- Name: idx_pipeline_stages_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_stages_metadata_g ON public.pipeline_stages USING gin (metadata);


--
-- Name: idx_pipeline_stages_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_stages_pipeline ON public.pipeline_stages USING btree (pipeline_id, order_val);


--
-- Name: idx_pipelines_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipelines_metadata_g ON public.pipelines USING gin (metadata);


--
-- Name: idx_pipelines_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipelines_tenant ON public.pipelines USING btree (tenant_id);


--
-- Name: idx_plans_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_active ON public.plans USING btree (is_active, sort_order);


--
-- Name: idx_plans_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_name ON public.plans USING btree (name);


--
-- Name: idx_plans_rate_limit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_rate_limit ON public.plans USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_plans_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_slug ON public.plans USING btree (slug);


--
-- Name: idx_platform_settings_global_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_platform_settings_global_unique ON public.platform_settings USING btree (key) WHERE (tenant_id IS NULL);


--
-- Name: idx_platform_settings_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_settings_key ON public.platform_settings USING btree (key) WHERE (key IS NOT NULL);


--
-- Name: idx_platform_settings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_settings_tenant ON public.platform_settings USING btree (tenant_id);


--
-- Name: idx_platform_settings_tenant_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_platform_settings_tenant_unique ON public.platform_settings USING btree (key, tenant_id) WHERE (tenant_id IS NOT NULL);


--
-- Name: idx_plugin_execution_logs_plugin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_execution_logs_plugin ON public.plugin_execution_logs USING btree (plugin_id, created_at);


--
-- Name: idx_plugin_execution_logs_success; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_execution_logs_success ON public.plugin_execution_logs USING btree (tenant_id, success);


--
-- Name: idx_plugin_execution_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plugin_execution_logs_tenant ON public.plugin_execution_logs USING btree (tenant_id);


--
-- Name: idx_portal_clients_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_clients_email ON public.portal_clients USING btree (email);


--
-- Name: idx_portal_clients_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_portal_clients_tenant ON public.portal_clients USING btree (tenant_id);


--
-- Name: idx_portal_clients_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_portal_clients_token ON public.portal_clients USING btree (access_token);


--
-- Name: idx_price_book_entries_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_price_book_entries_unique ON public.price_book_entries USING btree (price_book_id, product_id);


--
-- Name: idx_price_books_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_books_tenant ON public.price_books USING btree (tenant_id) WHERE (is_active = true);


--
-- Name: idx_product_templates_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_templates_slug ON public.product_templates USING btree (slug);


--
-- Name: idx_product_templates_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_templates_status ON public.product_templates USING btree (status);


--
-- Name: idx_products_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_active ON public.products USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_products_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_metadata_g ON public.products USING gin (metadata);


--
-- Name: idx_products_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_tenant ON public.products USING btree (tenant_id);


--
-- Name: idx_project_tasks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_tasks_tenant ON public.project_tasks USING btree (tenant_id);


--
-- Name: idx_project_tasks_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_project_tasks_unique ON public.project_tasks USING btree (project_id, task_id);


--
-- Name: idx_projects_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_active ON public.projects USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_projects_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_owner ON public.projects USING btree (owner_id);


--
-- Name: idx_projects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_status ON public.projects USING btree (tenant_id, status);


--
-- Name: idx_projects_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_tenant ON public.projects USING btree (tenant_id);


--
-- Name: idx_quote_line_items_quote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quote_line_items_quote ON public.quote_line_items USING btree (quote_id);


--
-- Name: idx_quotes_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_active ON public.quotes USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_quotes_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_deal ON public.quotes USING btree (deal_id);


--
-- Name: idx_quotes_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_metadata_g ON public.quotes USING gin (metadata);


--
-- Name: idx_quotes_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotes_tenant ON public.quotes USING btree (tenant_id);


--
-- Name: idx_record_permissions_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_record_permissions_entity ON public.record_permissions USING btree (tenant_id, entity_type, entity_id);


--
-- Name: idx_record_permissions_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_record_permissions_role ON public.record_permissions USING btree (tenant_id, role_id);


--
-- Name: idx_report_executions_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_executions_metadata_g ON public.report_executions USING gin (metadata);


--
-- Name: idx_report_executions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_executions_tenant ON public.report_executions USING btree (tenant_id);


--
-- Name: idx_report_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_report_templates_active ON public.report_templates USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_restore_snapshots_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restore_snapshots_tenant ON public.restore_snapshots USING btree (tenant_id);


--
-- Name: idx_rev_projections_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rev_projections_tenant ON public.revenue_projections USING btree (tenant_id, period_start);


--
-- Name: idx_revenue_forecast_summary_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revenue_forecast_summary_tenant ON public.revenue_forecast_summary USING btree (tenant_id);


--
-- Name: idx_revenue_forecast_tenant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revenue_forecast_tenant_date ON public.revenue_forecast_summary USING btree (tenant_id, forecast_date);


--
-- Name: idx_revenue_opportunities_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revenue_opportunities_metadata_g ON public.revenue_opportunities USING gin (metadata);


--
-- Name: idx_revenue_opportunities_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revenue_opportunities_tenant ON public.revenue_opportunities USING btree (tenant_id);


--
-- Name: idx_revenue_projections_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revenue_projections_metadata_g ON public.revenue_projections USING gin (metadata);


--
-- Name: idx_revenue_projections_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_revenue_projections_tenant ON public.revenue_projections USING btree (tenant_id);


--
-- Name: idx_roles_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_tenant ON public.roles USING btree (tenant_id);


--
-- Name: idx_roles_tenant_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_roles_tenant_slug ON public.roles USING btree (tenant_id, slug);


--
-- Name: idx_sa_audit_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sa_audit_action ON public.super_admin_audit_logs USING btree (action);


--
-- Name: idx_sa_audit_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sa_audit_admin ON public.super_admin_audit_logs USING btree (admin_id);


--
-- Name: idx_sa_audit_admin_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sa_audit_admin_time ON public.super_admin_audit_logs USING btree (admin_id, created_at DESC);


--
-- Name: idx_sa_audit_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sa_audit_target ON public.super_admin_audit_logs USING btree (target_type, target_id);


--
-- Name: idx_sa_audit_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sa_audit_tenant ON public.super_admin_audit_logs USING btree (tenant_id);


--
-- Name: idx_sa_audit_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sa_audit_time ON public.super_admin_audit_logs USING btree (created_at DESC);


--
-- Name: idx_saved_reports_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_reports_tenant ON public.saved_reports USING btree (tenant_id);


--
-- Name: idx_saved_views_entity_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_views_entity_tenant ON public.saved_views USING btree (entity_type, tenant_id);


--
-- Name: idx_saved_views_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_saved_views_tenant ON public.saved_views USING btree (tenant_id);


--
-- Name: idx_scheduled_reports_next_run; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_reports_next_run ON public.scheduled_reports USING btree (next_run_at);


--
-- Name: idx_scheduled_reports_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_reports_status ON public.scheduled_reports USING btree (status, tenant_id);


--
-- Name: idx_scheduled_reports_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scheduled_reports_tenant ON public.scheduled_reports USING btree (tenant_id);


--
-- Name: idx_security_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_tenant ON public.security_events USING btree (tenant_id);


--
-- Name: idx_security_events_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_time ON public.security_events USING btree (created_at);


--
-- Name: idx_security_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_type ON public.security_events USING btree (event_type);


--
-- Name: idx_security_events_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_security_events_user ON public.security_events USING btree (user_id);


--
-- Name: idx_segment_members_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_segment_members_pk ON public.segment_members USING btree (segment_id, entity_id);


--
-- Name: idx_segment_members_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_segment_members_tenant ON public.segment_members USING btree (tenant_id);


--
-- Name: idx_segments_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_segments_metadata_g ON public.segments USING gin (metadata);


--
-- Name: idx_segments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_segments_tenant ON public.segments USING btree (tenant_id);


--
-- Name: idx_selective_restore_audit_log_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_selective_restore_audit_log_tenant ON public.selective_restore_audit_log USING btree (tenant_id);


--
-- Name: idx_selective_restore_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_selective_restore_logs_tenant ON public.selective_restore_logs USING btree (tenant_id);


--
-- Name: idx_seq_enroll_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_enroll_contact ON public.sequence_enrollments USING btree (contact_id);


--
-- Name: idx_seq_enroll_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_enroll_seq ON public.sequence_enrollments USING btree (sequence_id);


--
-- Name: idx_seq_enroll_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seq_enroll_status ON public.sequence_enrollments USING btree (status);


--
-- Name: idx_sequence_enrollments_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_enrollments_active ON public.sequence_enrollments USING btree (tenant_id, status) WHERE (status = 'active'::text);


--
-- Name: idx_sequence_enrollments_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_enrollments_contact ON public.sequence_enrollments USING btree (tenant_id, contact_id) WHERE (status = 'active'::text);


--
-- Name: idx_sequence_enrollments_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_enrollments_metadata_g ON public.sequence_enrollments USING gin (metadata);


--
-- Name: idx_sequence_enrollments_next; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_enrollments_next ON public.sequence_enrollments USING btree (tenant_id, next_step_at) WHERE ((status = 'active'::text) AND (next_step_at IS NOT NULL));


--
-- Name: idx_sequence_enrollments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_enrollments_tenant ON public.sequence_enrollments USING btree (tenant_id);


--
-- Name: idx_sequence_step_logs_enrollment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_step_logs_enrollment ON public.sequence_step_logs USING btree (enrollment_id);


--
-- Name: idx_sequence_step_logs_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_step_logs_scheduled ON public.sequence_step_logs USING btree (scheduled_at) WHERE (status = 'pending'::text);


--
-- Name: idx_sequence_step_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_step_logs_tenant ON public.sequence_step_logs USING btree (tenant_id);


--
-- Name: idx_sequence_steps_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_steps_seq ON public.sequence_steps USING btree (sequence_id, step_number);


--
-- Name: idx_sequence_steps_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_steps_tenant ON public.sequence_steps USING btree (tenant_id);


--
-- Name: idx_sequences_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequences_active ON public.sequences USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_sequences_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequences_metadata_g ON public.sequences USING gin (metadata);


--
-- Name: idx_sequences_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequences_tenant ON public.sequences USING btree (tenant_id);


--
-- Name: idx_service_categories_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_categories_name ON public.service_categories USING btree (name);


--
-- Name: idx_service_categories_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_categories_tenant ON public.service_categories USING btree (tenant_id);


--
-- Name: idx_service_subscriptions_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_subscriptions_active ON public.service_subscriptions USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_service_subscriptions_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_subscriptions_company ON public.service_subscriptions USING btree (company_id);


--
-- Name: idx_service_subscriptions_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_subscriptions_contact ON public.service_subscriptions USING btree (contact_id);


--
-- Name: idx_service_subscriptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_subscriptions_status ON public.service_subscriptions USING btree (tenant_id, status);


--
-- Name: idx_service_subscriptions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_service_subscriptions_tenant ON public.service_subscriptions USING btree (tenant_id);


--
-- Name: idx_services_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_active ON public.services USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_services_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_category ON public.services USING btree (category);


--
-- Name: idx_services_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_company ON public.services USING btree (company_id);


--
-- Name: idx_services_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_contact ON public.services USING btree (contact_id);


--
-- Name: idx_services_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_name ON public.services USING btree (name);


--
-- Name: idx_services_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_services_tenant ON public.services USING btree (tenant_id);


--
-- Name: idx_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_token ON public.sessions USING btree (token_hash);


--
-- Name: idx_signing_events_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signing_events_request ON public.signing_events USING btree (request_id);


--
-- Name: idx_signing_events_signer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signing_events_signer ON public.signing_events USING btree (signer_email);


--
-- Name: idx_signing_events_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signing_events_tenant ON public.signing_events USING btree (tenant_id);


--
-- Name: idx_signing_requests_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signing_requests_document ON public.signing_requests USING btree (document_id);


--
-- Name: idx_signing_requests_external; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signing_requests_external ON public.signing_requests USING btree (provider, external_id);


--
-- Name: idx_signing_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signing_requests_status ON public.signing_requests USING btree (tenant_id, status);


--
-- Name: idx_signing_requests_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_signing_requests_tenant ON public.signing_requests USING btree (tenant_id);


--
-- Name: idx_sla_breaches_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sla_breaches_entity ON public.sla_breaches USING btree (tenant_id, entity_type, entity_id);


--
-- Name: idx_sla_breaches_policy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sla_breaches_policy ON public.sla_breaches USING btree (tenant_id, policy_id);


--
-- Name: idx_sla_breaches_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sla_breaches_tenant ON public.sla_breaches USING btree (tenant_id);


--
-- Name: idx_sla_policies_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sla_policies_active ON public.sla_policies USING btree (tenant_id, is_active);


--
-- Name: idx_sla_policies_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sla_policies_priority ON public.sla_policies USING btree (tenant_id, priority);


--
-- Name: idx_sla_policies_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sla_policies_tenant ON public.sla_policies USING btree (tenant_id);


--
-- Name: idx_sms_messages_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_messages_contact ON public.sms_messages USING btree (contact_id);


--
-- Name: idx_sms_messages_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_messages_status ON public.sms_messages USING btree (tenant_id, status);


--
-- Name: idx_sms_messages_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_messages_tenant ON public.sms_messages USING btree (tenant_id);


--
-- Name: idx_sms_messages_twilio_sid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_messages_twilio_sid ON public.sms_messages USING btree (twilio_sid);


--
-- Name: idx_sms_templates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_templates_active ON public.sms_templates USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_sms_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sms_templates_tenant ON public.sms_templates USING btree (tenant_id);


--
-- Name: idx_snapshots_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_entity ON public.field_snapshots USING btree (entity_type, entity_id);


--
-- Name: idx_snapshots_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_expires ON public.field_snapshots USING btree (expires_at);


--
-- Name: idx_snapshots_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snapshots_tenant ON public.field_snapshots USING btree (tenant_id);


--
-- Name: idx_sso_providers_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sso_providers_active ON public.sso_providers USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_sso_providers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sso_providers_tenant ON public.sso_providers USING btree (tenant_id) WHERE (is_active = true);


--
-- Name: idx_sso_sessions_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sso_sessions_id ON public.sso_sessions USING btree (session_id);


--
-- Name: idx_sso_sessions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sso_sessions_tenant ON public.sso_sessions USING btree (tenant_id);


--
-- Name: idx_sso_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sso_sessions_user ON public.sso_sessions USING btree (user_id, created_at);


--
-- Name: idx_storage_documents_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storage_documents_active ON public.storage_documents USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_storage_documents_link; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storage_documents_link ON public.storage_documents USING btree (linked_entity_type, linked_entity_id);


--
-- Name: idx_storage_documents_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storage_documents_metadata_g ON public.storage_documents USING gin (metadata);


--
-- Name: idx_storage_documents_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storage_documents_tenant ON public.storage_documents USING btree (tenant_id);


--
-- Name: idx_storage_documents_uploader; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_storage_documents_uploader ON public.storage_documents USING btree (uploaded_by);


--
-- Name: idx_subscriptions_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_metadata_g ON public.subscriptions USING gin (metadata);


--
-- Name: idx_subscriptions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_tenant ON public.subscriptions USING btree (tenant_id);


--
-- Name: idx_super_admin_audit_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_super_admin_audit_action ON public.super_admin_audit_logs USING btree (action, created_at);


--
-- Name: idx_super_admin_audit_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_super_admin_audit_admin ON public.super_admin_audit_logs USING btree (admin_id, created_at);


--
-- Name: idx_super_admin_audit_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_super_admin_audit_tenant ON public.super_admin_audit_logs USING btree (tenant_id, created_at);


--
-- Name: idx_super_admin_audit_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_super_admin_audit_time ON public.super_admin_audit_logs USING btree (created_at);


--
-- Name: idx_super_admin_backups_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_super_admin_backups_name ON public.super_admin_backups USING btree (backup_name);


--
-- Name: idx_super_admin_backups_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_super_admin_backups_status ON public.super_admin_backups USING btree (status, created_at);


--
-- Name: idx_support_tickets_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_active ON public.support_tickets USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_support_tickets_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_metadata_g ON public.support_tickets USING gin (metadata);


--
-- Name: idx_support_tickets_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_tenant ON public.support_tickets USING btree (tenant_id);


--
-- Name: idx_tags_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tags_metadata_g ON public.tags USING gin (metadata);


--
-- Name: idx_tags_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tags_tenant ON public.tags USING btree (tenant_id);


--
-- Name: idx_tasks_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_active ON public.tasks USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_tasks_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_assigned ON public.tasks USING btree (assigned_to);


--
-- Name: idx_tasks_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_contact ON public.tasks USING btree (contact_id);


--
-- Name: idx_tasks_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_created_by ON public.tasks USING btree (created_by);


--
-- Name: idx_tasks_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_deal ON public.tasks USING btree (deal_id);


--
-- Name: idx_tasks_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_due ON public.tasks USING btree (due_date);


--
-- Name: idx_tasks_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_due_date ON public.tasks USING btree (tenant_id, due_date) WHERE ((deleted_at IS NULL) AND (due_date IS NOT NULL));


--
-- Name: idx_tasks_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_metadata_g ON public.tasks USING gin (metadata);


--
-- Name: idx_tasks_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_open ON public.tasks USING btree (tenant_id, completed) WHERE ((deleted_at IS NULL) AND (completed = false));


--
-- Name: idx_tasks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_tenant ON public.tasks USING btree (tenant_id);


--
-- Name: idx_tasks_tenant_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_tenant_created ON public.tasks USING btree (tenant_id, created_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: idx_tasks_tenant_due_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_tenant_due_active ON public.tasks USING btree (tenant_id, due_date, created_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_tasks_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_tenant_status ON public.tasks USING btree (tenant_id, status);


--
-- Name: idx_tax_exemptions_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_exemptions_entity ON public.tax_exemptions USING btree (entity_type, entity_id);


--
-- Name: idx_tax_exemptions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_exemptions_tenant ON public.tax_exemptions USING btree (tenant_id);


--
-- Name: idx_tax_rates_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_rates_active ON public.tax_rates USING btree (tenant_id, is_active);


--
-- Name: idx_tax_rates_region; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_rates_region ON public.tax_rates USING btree (country, state);


--
-- Name: idx_tax_rates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tax_rates_tenant ON public.tax_rates USING btree (tenant_id);


--
-- Name: idx_tenant_ai_credentials_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_ai_credentials_active ON public.tenant_ai_credentials USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_tenant_ai_credentials_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_ai_credentials_metadata_g ON public.tenant_ai_credentials USING gin (metadata);


--
-- Name: idx_tenant_ai_credentials_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_ai_credentials_provider ON public.tenant_ai_credentials USING btree (provider_id);


--
-- Name: idx_tenant_ai_credentials_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_ai_credentials_tenant ON public.tenant_ai_credentials USING btree (tenant_id);


--
-- Name: idx_tenant_ai_credentials_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_ai_credentials_tenant_status ON public.tenant_ai_credentials USING btree (tenant_id, status);


--
-- Name: idx_tenant_ai_credits_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_ai_credits_period ON public.tenant_ai_credits USING btree (tenant_id, billing_period);


--
-- Name: idx_tenant_ai_credits_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_ai_credits_status ON public.tenant_ai_credits USING btree (status);


--
-- Name: idx_tenant_ai_credits_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_ai_credits_tenant ON public.tenant_ai_credits USING btree (tenant_id);


--
-- Name: idx_tenant_backup_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_backup_expires ON public.tenant_backup_records USING btree (expires_at) WHERE (status = 'completed'::text);


--
-- Name: idx_tenant_backup_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_backup_status ON public.tenant_backup_records USING btree (status, created_at);


--
-- Name: idx_tenant_backup_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_backup_tenant ON public.tenant_backup_records USING btree (tenant_id, status);


--
-- Name: idx_tenant_backups_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_backups_metadata_g ON public.tenant_backups USING gin (metadata);


--
-- Name: idx_tenant_backups_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_backups_tenant ON public.tenant_backups USING btree (tenant_id);


--
-- Name: idx_tenant_members_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_members_tenant ON public.tenant_members USING btree (tenant_id);


--
-- Name: idx_tenant_members_tenant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tenant_members_tenant_user ON public.tenant_members USING btree (tenant_id, user_id);


--
-- Name: idx_tenant_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_members_user ON public.tenant_members USING btree (user_id);


--
-- Name: idx_tenant_modules_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_modules_tenant ON public.tenant_modules USING btree (tenant_id);


--
-- Name: idx_tenant_modules_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tenant_modules_unique ON public.tenant_modules USING btree (tenant_id, module_id);


--
-- Name: idx_tenant_restore_backup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_restore_backup ON public.tenant_restore_records USING btree (backup_id);


--
-- Name: idx_tenant_restore_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_restore_tenant ON public.tenant_restore_records USING btree (tenant_id, status);


--
-- Name: idx_tenant_restores_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_restores_metadata_g ON public.tenant_restores USING gin (metadata);


--
-- Name: idx_tenant_restores_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_restores_tenant ON public.tenant_restores USING btree (tenant_id);


--
-- Name: idx_tenant_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_templates_tenant ON public.tenant_templates USING btree (tenant_id);


--
-- Name: idx_tenant_templates_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tenant_templates_unique ON public.tenant_templates USING btree (tenant_id, template_id);


--
-- Name: idx_tenants_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_metadata_g ON public.tenants USING gin (metadata);


--
-- Name: idx_tenants_short_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tenants_short_code ON public.tenants USING btree (short_code) WHERE (short_code IS NOT NULL);


--
-- Name: idx_tenants_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_slug ON public.tenants USING btree (slug);


--
-- Name: idx_tenants_subdomain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_subdomain ON public.tenants USING btree (subdomain);


--
-- Name: idx_ticket_replies_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_replies_tenant ON public.ticket_replies USING btree (tenant_id);


--
-- Name: idx_ticket_replies_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ticket_replies_ticket ON public.ticket_replies USING btree (ticket_id);


--
-- Name: idx_tickets_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_assigned ON public.support_tickets USING btree (assigned_to);


--
-- Name: idx_tickets_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_contact ON public.support_tickets USING btree (contact_id);


--
-- Name: idx_tickets_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_status ON public.support_tickets USING btree (status);


--
-- Name: idx_tickets_tenant_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tickets_tenant_status ON public.support_tickets USING btree (tenant_id, status);


--
-- Name: idx_token_budgets_service; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_token_budgets_service ON public.token_budgets USING btree (service, billing_period);


--
-- Name: idx_token_budgets_service_period; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_token_budgets_service_period ON public.token_budgets USING btree (service, billing_period);


--
-- Name: idx_usage_alerts_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_alerts_target ON public.usage_alerts USING btree (target_type, target_id);


--
-- Name: idx_usage_alerts_unacked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_alerts_unacked ON public.usage_alerts USING btree (acknowledged);


--
-- Name: idx_usage_snapshots_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_snapshots_date ON public.usage_snapshots USING btree (snapshot_date);


--
-- Name: idx_usage_snapshots_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_snapshots_metadata_g ON public.usage_snapshots USING gin (metadata);


--
-- Name: idx_usage_snapshots_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_snapshots_tenant ON public.usage_snapshots USING btree (tenant_id);


--
-- Name: idx_usage_snapshots_tenant_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_snapshots_tenant_date ON public.usage_snapshots USING btree (tenant_id, snapshot_date);


--
-- Name: idx_user_departures_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_departures_date ON public.user_departures USING btree (departure_date);


--
-- Name: idx_user_departures_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_departures_tenant ON public.user_departures USING btree (tenant_id);


--
-- Name: idx_user_departures_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_departures_user ON public.user_departures USING btree (user_id);


--
-- Name: idx_user_token_limits_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_token_limits_tenant ON public.user_token_limits USING btree (tenant_id);


--
-- Name: idx_user_token_limits_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_token_limits_unique ON public.user_token_limits USING btree (tenant_id, user_id, module);


--
-- Name: idx_user_usage_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_usage_tenant ON public.user_usage USING btree (tenant_id);


--
-- Name: idx_user_usage_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_user_usage_unique ON public.user_usage USING btree (tenant_id, user_id);


--
-- Name: idx_users_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_active ON public.users USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_metadata_g ON public.users USING gin (metadata);


--
-- Name: idx_voice_calls_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_calls_metadata_g ON public.voice_calls USING gin (metadata);


--
-- Name: idx_voice_calls_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_voice_calls_tenant ON public.voice_calls USING btree (tenant_id);


--
-- Name: idx_webhook_deliv_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_deliv_status ON public.webhook_deliveries USING btree (status);


--
-- Name: idx_webhook_deliv_webhook; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_deliv_webhook ON public.webhook_deliveries USING btree (webhook_id);


--
-- Name: idx_webhook_deliveries_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_deliveries_metadata_g ON public.webhook_deliveries USING gin (metadata);


--
-- Name: idx_webhook_deliveries_next_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_deliveries_next_retry ON public.webhook_queue USING btree (next_retry_at) WHERE (status = 'pending'::text);


--
-- Name: idx_webhook_deliveries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_deliveries_status ON public.webhook_queue USING btree (status);


--
-- Name: idx_webhook_deliveries_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_deliveries_tenant ON public.webhook_deliveries USING btree (tenant_id);


--
-- Name: idx_webhook_deliveries_webhook_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_deliveries_webhook_id ON public.webhook_queue USING btree (webhook_id);


--
-- Name: idx_webhook_inbound_logs_api_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_inbound_logs_api_key ON public.webhook_inbound_logs USING btree (api_key_id);


--
-- Name: idx_webhook_inbound_logs_processed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_inbound_logs_processed ON public.webhook_inbound_logs USING btree (processed) WHERE (processed = false);


--
-- Name: idx_webhook_inbound_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_inbound_logs_tenant ON public.webhook_inbound_logs USING btree (tenant_id);


--
-- Name: idx_webhook_inbound_logs_webhook; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhook_inbound_logs_webhook ON public.webhook_inbound_logs USING btree (webhook_id);


--
-- Name: idx_webhooks_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhooks_metadata_g ON public.webhooks USING gin (metadata);


--
-- Name: idx_webhooks_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhooks_tenant ON public.webhooks USING btree (tenant_id);


--
-- Name: idx_whatsapp_conv_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_conv_contact ON public.whatsapp_conversations USING btree (contact_id);


--
-- Name: idx_whatsapp_conversations_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_conversations_active ON public.whatsapp_conversations USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_whatsapp_conversations_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_conversations_metadata_g ON public.whatsapp_conversations USING gin (metadata);


--
-- Name: idx_whatsapp_conversations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_conversations_tenant ON public.whatsapp_conversations USING btree (tenant_id);


--
-- Name: idx_whatsapp_messages_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_messages_metadata_g ON public.whatsapp_messages USING gin (metadata);


--
-- Name: idx_whatsapp_messages_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_messages_tenant ON public.whatsapp_messages USING btree (tenant_id);


--
-- Name: idx_whatsapp_msg_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_msg_conv ON public.whatsapp_messages USING btree (conversation_id);


--
-- Name: idx_whatsapp_templates_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_whatsapp_templates_tenant ON public.whatsapp_templates USING btree (tenant_id);


--
-- Name: idx_whatsapp_templates_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_whatsapp_templates_unique ON public.whatsapp_templates USING btree (tenant_id, name, language);


--
-- Name: idx_workflow_action_logs_execution; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_action_logs_execution ON public.workflow_action_logs USING btree (execution_id);


--
-- Name: idx_workflow_action_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_action_logs_tenant ON public.workflow_action_logs USING btree (tenant_id);


--
-- Name: idx_workflow_actions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_actions_tenant ON public.workflow_actions USING btree (tenant_id);


--
-- Name: idx_workflow_actions_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_actions_workflow ON public.workflow_actions USING btree (workflow_id, order_index);


--
-- Name: idx_workflow_execution_logs_execution; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_execution_logs_execution ON public.workflow_execution_logs USING btree (workflow_execution_id);


--
-- Name: idx_workflow_execution_logs_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_execution_logs_level ON public.workflow_execution_logs USING btree (level, created_at);


--
-- Name: idx_workflow_execution_logs_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_execution_logs_metadata_g ON public.workflow_execution_logs USING gin (metadata);


--
-- Name: idx_workflow_execution_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_execution_logs_tenant ON public.workflow_execution_logs USING btree (tenant_id);


--
-- Name: idx_workflow_executions_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_executions_metadata_g ON public.workflow_executions USING gin (metadata);


--
-- Name: idx_workflow_executions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_executions_tenant ON public.workflow_executions USING btree (tenant_id);


--
-- Name: idx_workflow_executions_workflow; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflow_executions_workflow ON public.workflow_executions USING btree (workflow_id, started_at);


--
-- Name: idx_workflows_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_active ON public.workflows USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_workflows_metadata_g; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_metadata_g ON public.workflows USING gin (metadata);


--
-- Name: idx_workflows_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workflows_tenant ON public.workflows USING btree (tenant_id) WHERE ((deleted_at IS NULL) AND (is_active = true));


--
-- Name: uniq_ai_providers_provider_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_ai_providers_provider_key ON public.ai_providers USING btree (provider_key);


--
-- Name: uniq_tenant_ai_credential_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_tenant_ai_credential_active ON public.tenant_ai_credentials USING btree (tenant_id, provider_id, status);


--
-- Name: login_attempts cleanup_login_data; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER cleanup_login_data AFTER INSERT ON public.login_attempts FOR EACH STATEMENT EXECUTE FUNCTION public.cleanup_old_login_attempts();


--
-- Name: activities activities_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: activities activities_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: activities activities_deal_id_deals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_deal_id_deals_id_fk FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;


--
-- Name: activities activities_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: activities activities_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_activity ai_activity_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_activity
    ADD CONSTRAINT ai_activity_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_activity ai_activity_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_activity
    ADD CONSTRAINT ai_activity_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_credits_ledger ai_credits_ledger_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_credits_ledger
    ADD CONSTRAINT ai_credits_ledger_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_credits_ledger ai_credits_ledger_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_credits_ledger
    ADD CONSTRAINT ai_credits_ledger_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_draft_templates ai_draft_templates_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_draft_templates
    ADD CONSTRAINT ai_draft_templates_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_draft_templates ai_draft_templates_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_draft_templates
    ADD CONSTRAINT ai_draft_templates_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_draft_templates ai_draft_templates_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_draft_templates
    ADD CONSTRAINT ai_draft_templates_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_email_drafts ai_email_drafts_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_email_drafts
    ADD CONSTRAINT ai_email_drafts_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: ai_email_drafts ai_email_drafts_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_email_drafts
    ADD CONSTRAINT ai_email_drafts_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_email_drafts ai_email_drafts_deal_id_deals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_email_drafts
    ADD CONSTRAINT ai_email_drafts_deal_id_deals_id_fk FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;


--
-- Name: ai_email_drafts ai_email_drafts_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_email_drafts
    ADD CONSTRAINT ai_email_drafts_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_email_drafts ai_email_drafts_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_email_drafts
    ADD CONSTRAINT ai_email_drafts_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_email_drafts ai_email_drafts_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_email_drafts
    ADD CONSTRAINT ai_email_drafts_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_insights ai_insights_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_insights
    ADD CONSTRAINT ai_insights_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_module_configs ai_module_configs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_module_configs
    ADD CONSTRAINT ai_module_configs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_provider_secrets ai_provider_secrets_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_secrets
    ADD CONSTRAINT ai_provider_secrets_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_provider_secrets ai_provider_secrets_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_secrets
    ADD CONSTRAINT ai_provider_secrets_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_provider_secrets ai_provider_secrets_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_provider_secrets
    ADD CONSTRAINT ai_provider_secrets_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_providers ai_providers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_providers ai_providers_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_providers ai_providers_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_providers
    ADD CONSTRAINT ai_providers_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_usage_aggregated ai_usage_aggregated_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_aggregated
    ADD CONSTRAINT ai_usage_aggregated_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_usage_logs ai_usage_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_logs
    ADD CONSTRAINT ai_usage_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ai_usage_logs ai_usage_logs_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_logs
    ADD CONSTRAINT ai_usage_logs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: announcements announcements_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: announcements announcements_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: announcements announcements_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: api_key_usage api_key_usage_api_key_id_api_keys_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key_usage
    ADD CONSTRAINT api_key_usage_api_key_id_api_keys_id_fk FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;


--
-- Name: api_key_usage_infra api_key_usage_infra_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key_usage_infra
    ADD CONSTRAINT api_key_usage_infra_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: api_key_usage api_key_usage_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_key_usage
    ADD CONSTRAINT api_key_usage_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: api_keys_registry api_keys_registry_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys_registry
    ADD CONSTRAINT api_keys_registry_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: api_keys api_keys_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: api_keys api_keys_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: approval_requests approval_requests_approved_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_approved_by_users_id_fk FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: approval_requests approval_requests_rejected_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_rejected_by_users_id_fk FOREIGN KEY (rejected_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: approval_requests approval_requests_requested_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_requested_by_users_id_fk FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: approval_requests approval_requests_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: assignment_logs assignment_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_logs
    ADD CONSTRAINT assignment_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: assignment_rules assignment_rules_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_rules
    ADD CONSTRAINT assignment_rules_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: at_risk_rules at_risk_rules_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.at_risk_rules
    ADD CONSTRAINT at_risk_rules_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: at_risk_rules at_risk_rules_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.at_risk_rules
    ADD CONSTRAINT at_risk_rules_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: at_risk_rules at_risk_rules_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.at_risk_rules
    ADD CONSTRAINT at_risk_rules_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automation_runs automation_runs_automation_id_automations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_automation_id_automations_id_fk FOREIGN KEY (automation_id) REFERENCES public.automations(id) ON DELETE SET NULL;


--
-- Name: automation_runs automation_runs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: automation_runs automation_runs_triggered_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_triggered_by_users_id_fk FOREIGN KEY (triggered_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automation_workflows automation_workflows_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_workflows
    ADD CONSTRAINT automation_workflows_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automation_workflows automation_workflows_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_workflows
    ADD CONSTRAINT automation_workflows_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automation_workflows automation_workflows_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_workflows
    ADD CONSTRAINT automation_workflows_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: automation_workflows automation_workflows_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_workflows
    ADD CONSTRAINT automation_workflows_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automations automations_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automations automations_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: automations automations_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: automations automations_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: backup_records backup_records_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_records
    ADD CONSTRAINT backup_records_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: backup_records backup_records_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_records
    ADD CONSTRAINT backup_records_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: backup_records backup_records_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_records
    ADD CONSTRAINT backup_records_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: backup_schedules backup_schedules_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backup_schedules
    ADD CONSTRAINT backup_schedules_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: billing_events billing_events_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: call_logs call_logs_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: call_logs call_logs_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: call_logs call_logs_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: call_logs call_logs_deal_id_deals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_deal_id_deals_id_fk FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;


--
-- Name: call_logs call_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: call_logs call_logs_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_logs
    ADD CONSTRAINT call_logs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: call_notes call_notes_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_notes
    ADD CONSTRAINT call_notes_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: call_notes call_notes_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_notes
    ADD CONSTRAINT call_notes_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: call_notes call_notes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_notes
    ADD CONSTRAINT call_notes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: call_recordings call_recordings_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_recordings
    ADD CONSTRAINT call_recordings_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: call_recordings call_recordings_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_recordings
    ADD CONSTRAINT call_recordings_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_session_id_chat_sessions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_session_id_chat_sessions_id_fk FOREIGN KEY (session_id) REFERENCES public.chat_sessions(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: chat_sessions chat_sessions_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: chat_sessions chat_sessions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_sessions
    ADD CONSTRAINT chat_sessions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: churn_predictions churn_predictions_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.churn_predictions
    ADD CONSTRAINT churn_predictions_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: churn_predictions churn_predictions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.churn_predictions
    ADD CONSTRAINT churn_predictions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: comm_email_drafts comm_email_drafts_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comm_email_drafts
    ADD CONSTRAINT comm_email_drafts_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: comm_email_drafts comm_email_drafts_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comm_email_drafts
    ADD CONSTRAINT comm_email_drafts_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: comm_email_drafts comm_email_drafts_deal_id_deals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comm_email_drafts
    ADD CONSTRAINT comm_email_drafts_deal_id_deals_id_fk FOREIGN KEY (deal_id) REFERENCES public.deals(id);


--
-- Name: comm_email_drafts comm_email_drafts_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comm_email_drafts
    ADD CONSTRAINT comm_email_drafts_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: companies companies_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: companies companies_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: companies companies_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: companies companies_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: compliance_requests compliance_requests_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_requests
    ADD CONSTRAINT compliance_requests_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: contact_emails contact_emails_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_emails
    ADD CONSTRAINT contact_emails_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_lifecycle_history contact_lifecycle_history_changed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_lifecycle_history
    ADD CONSTRAINT contact_lifecycle_history_changed_by_users_id_fk FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: contact_lifecycle_history contact_lifecycle_history_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_lifecycle_history
    ADD CONSTRAINT contact_lifecycle_history_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_lifecycle_history contact_lifecycle_history_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_lifecycle_history
    ADD CONSTRAINT contact_lifecycle_history_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: contact_merge_history contact_merge_history_merged_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_merge_history
    ADD CONSTRAINT contact_merge_history_merged_by_users_id_fk FOREIGN KEY (merged_by) REFERENCES public.users(id);


--
-- Name: contact_merge_history contact_merge_history_merged_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_merge_history
    ADD CONSTRAINT contact_merge_history_merged_contact_id_contacts_id_fk FOREIGN KEY (merged_contact_id) REFERENCES public.contacts(id);


--
-- Name: contact_merge_history contact_merge_history_primary_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_merge_history
    ADD CONSTRAINT contact_merge_history_primary_contact_id_contacts_id_fk FOREIGN KEY (primary_contact_id) REFERENCES public.contacts(id);


--
-- Name: contact_merge_history contact_merge_history_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_merge_history
    ADD CONSTRAINT contact_merge_history_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: contact_scores contact_scores_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_scores
    ADD CONSTRAINT contact_scores_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_scores contact_scores_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_scores
    ADD CONSTRAINT contact_scores_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: contact_tags contact_tags_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_tags
    ADD CONSTRAINT contact_tags_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_tags contact_tags_tag_id_tags_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_tags
    ADD CONSTRAINT contact_tags_tag_id_tags_id_fk FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contacts contacts_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: contacts contacts_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contacts contacts_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contacts contacts_original_owner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_original_owner_id_users_id_fk FOREIGN KEY (original_owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contacts contacts_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: content_generations content_generations_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_generations
    ADD CONSTRAINT content_generations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: content_generations content_generations_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_generations
    ADD CONSTRAINT content_generations_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: contracts contracts_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: contracts contracts_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: conversation_keywords conversation_keywords_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_keywords
    ADD CONSTRAINT conversation_keywords_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: conversation_metrics conversation_metrics_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_metrics
    ADD CONSTRAINT conversation_metrics_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: conversation_metrics conversation_metrics_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_metrics
    ADD CONSTRAINT conversation_metrics_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: cost_anomalies cost_anomalies_reviewed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_anomalies
    ADD CONSTRAINT cost_anomalies_reviewed_by_users_id_fk FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: cost_anomalies cost_anomalies_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cost_anomalies
    ADD CONSTRAINT cost_anomalies_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: critical_data_backups critical_data_backups_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.critical_data_backups
    ADD CONSTRAINT critical_data_backups_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: critical_data_backups critical_data_backups_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.critical_data_backups
    ADD CONSTRAINT critical_data_backups_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: critical_data_backups critical_data_backups_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.critical_data_backups
    ADD CONSTRAINT critical_data_backups_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: custom_field_defs custom_field_defs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_field_defs
    ADD CONSTRAINT custom_field_defs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: custom_plugins custom_plugins_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_plugins
    ADD CONSTRAINT custom_plugins_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: custom_plugins custom_plugins_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_plugins
    ADD CONSTRAINT custom_plugins_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: dashboard_layouts dashboard_layouts_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_layouts
    ADD CONSTRAINT dashboard_layouts_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: dashboard_layouts dashboard_layouts_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_layouts
    ADD CONSTRAINT dashboard_layouts_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: dashboard_layouts dashboard_layouts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_layouts
    ADD CONSTRAINT dashboard_layouts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: dashboards dashboards_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboards
    ADD CONSTRAINT dashboards_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: dashboards dashboards_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboards
    ADD CONSTRAINT dashboards_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: dashboards dashboards_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboards
    ADD CONSTRAINT dashboards_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: dashboards dashboards_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboards
    ADD CONSTRAINT dashboards_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: data_retention_policies data_retention_policies_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_retention_policies
    ADD CONSTRAINT data_retention_policies_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: dead_letter_queue dead_letter_queue_resolved_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dead_letter_queue
    ADD CONSTRAINT dead_letter_queue_resolved_by_users_id_fk FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: dead_letter_queue dead_letter_queue_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dead_letter_queue
    ADD CONSTRAINT dead_letter_queue_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: deal_forecasts deal_forecasts_deal_id_deals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_forecasts
    ADD CONSTRAINT deal_forecasts_deal_id_deals_id_fk FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;


--
-- Name: deal_forecasts deal_forecasts_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_forecasts
    ADD CONSTRAINT deal_forecasts_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: deal_products deal_products_deal_id_deals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_products
    ADD CONSTRAINT deal_products_deal_id_deals_id_fk FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;


--
-- Name: deal_products deal_products_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_products
    ADD CONSTRAINT deal_products_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: deal_stages deal_stages_pipeline_id_pipelines_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_stages
    ADD CONSTRAINT deal_stages_pipeline_id_pipelines_id_fk FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;


--
-- Name: deals deals_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: deals deals_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: deals deals_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: deals deals_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: deals deals_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: deals deals_pipeline_id_pipelines_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pipeline_id_pipelines_id_fk FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE SET NULL;


--
-- Name: deals deals_stage_id_deal_stages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_stage_id_deal_stages_id_fk FOREIGN KEY (stage_id) REFERENCES public.deal_stages(id);


--
-- Name: deals deals_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: deals deals_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: document_folders document_folders_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_folders
    ADD CONSTRAINT document_folders_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: documents documents_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_clicks email_clicks_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_clicks
    ADD CONSTRAINT email_clicks_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: email_clicks email_clicks_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_clicks
    ADD CONSTRAINT email_clicks_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_log email_log_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id);


--
-- Name: email_log email_log_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_opens email_opens_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_opens
    ADD CONSTRAINT email_opens_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: email_opens email_opens_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_opens
    ADD CONSTRAINT email_opens_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_templates email_templates_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_tracking email_tracking_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_tracking
    ADD CONSTRAINT email_tracking_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: email_tracking email_tracking_sequence_enrollment_id_sequence_enrollments_id_f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_tracking
    ADD CONSTRAINT email_tracking_sequence_enrollment_id_sequence_enrollments_id_f FOREIGN KEY (sequence_enrollment_id) REFERENCES public.sequence_enrollments(id) ON DELETE SET NULL;


--
-- Name: email_tracking email_tracking_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_tracking
    ADD CONSTRAINT email_tracking_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_verifications email_verifications_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: email_warmup_configs email_warmup_configs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_warmup_configs
    ADD CONSTRAINT email_warmup_configs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: email_warmup_logs email_warmup_logs_config_id_email_warmup_configs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_warmup_logs
    ADD CONSTRAINT email_warmup_logs_config_id_email_warmup_configs_id_fk FOREIGN KEY (config_id) REFERENCES public.email_warmup_configs(id) ON DELETE CASCADE;


--
-- Name: email_warmup_logs email_warmup_logs_participant_id_email_warmup_pool_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_warmup_logs
    ADD CONSTRAINT email_warmup_logs_participant_id_email_warmup_pool_id_fk FOREIGN KEY (participant_id) REFERENCES public.email_warmup_pool(id) ON DELETE SET NULL;


--
-- Name: email_warmup_pool email_warmup_pool_config_id_email_warmup_configs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_warmup_pool
    ADD CONSTRAINT email_warmup_pool_config_id_email_warmup_configs_id_fk FOREIGN KEY (config_id) REFERENCES public.email_warmup_configs(id) ON DELETE CASCADE;


--
-- Name: entity_tags entity_tags_tag_id_tags_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_tags
    ADD CONSTRAINT entity_tags_tag_id_tags_id_fk FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: entity_tags entity_tags_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_tags
    ADD CONSTRAINT entity_tags_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: error_logs error_logs_resolved_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_resolved_by_users_id_fk FOREIGN KEY (resolved_by) REFERENCES public.users(id);


--
-- Name: error_logs error_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: error_logs error_logs_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.error_logs
    ADD CONSTRAINT error_logs_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: failed_webhooks failed_webhooks_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.failed_webhooks
    ADD CONSTRAINT failed_webhooks_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: field_permissions field_permissions_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_permissions
    ADD CONSTRAINT field_permissions_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: field_permissions field_permissions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_permissions
    ADD CONSTRAINT field_permissions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: file_attachments file_attachments_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_attachments
    ADD CONSTRAINT file_attachments_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: file_attachments file_attachments_uploaded_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_attachments
    ADD CONSTRAINT file_attachments_uploaded_by_users_id_fk FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: file_uploads file_uploads_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: file_uploads file_uploads_uploaded_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_uploads
    ADD CONSTRAINT file_uploads_uploaded_by_users_id_fk FOREIGN KEY (uploaded_by) REFERENCES public.users(id);


--
-- Name: documents fk_documents_uploaded_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT fk_documents_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: invoice_line_items fk_invoice_line_items_invoice; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_line_items
    ADD CONSTRAINT fk_invoice_line_items_invoice FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_line_items fk_invoice_line_items_tenant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_line_items
    ADD CONSTRAINT fk_invoice_line_items_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: invoice_payments fk_invoice_payments_invoice; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT fk_invoice_payments_invoice FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_payments fk_invoice_payments_recorded_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT fk_invoice_payments_recorded_by FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoice_payments fk_invoice_payments_tenant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT fk_invoice_payments_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: order_line_items fk_order_line_items_order; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_line_items
    ADD CONSTRAINT fk_order_line_items_order FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_line_items fk_order_line_items_tenant; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_line_items
    ADD CONSTRAINT fk_order_line_items_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: service_subscriptions fk_service_subscriptions_company; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_subscriptions
    ADD CONSTRAINT fk_service_subscriptions_company FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: service_subscriptions fk_service_subscriptions_contact; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_subscriptions
    ADD CONSTRAINT fk_service_subscriptions_contact FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: follow_ups follow_ups_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_ups
    ADD CONSTRAINT follow_ups_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: follow_ups follow_ups_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_ups
    ADD CONSTRAINT follow_ups_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: follow_ups follow_ups_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_ups
    ADD CONSTRAINT follow_ups_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: follow_ups follow_ups_deal_id_deals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_ups
    ADD CONSTRAINT follow_ups_deal_id_deals_id_fk FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;


--
-- Name: follow_ups follow_ups_lead_id_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_ups
    ADD CONSTRAINT follow_ups_lead_id_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: follow_ups follow_ups_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.follow_ups
    ADD CONSTRAINT follow_ups_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: form_submissions form_submissions_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id);


--
-- Name: form_submissions form_submissions_form_id_forms_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_form_id_forms_id_fk FOREIGN KEY (form_id) REFERENCES public.forms(id) ON DELETE CASCADE;


--
-- Name: form_submissions form_submissions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_submissions
    ADD CONSTRAINT form_submissions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: forms forms_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: forms forms_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: forms forms_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: forms forms_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forms
    ADD CONSTRAINT forms_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: impersonation_sessions impersonation_sessions_impersonator_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_sessions
    ADD CONSTRAINT impersonation_sessions_impersonator_id_users_id_fk FOREIGN KEY (impersonator_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: impersonation_sessions impersonation_sessions_target_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_sessions
    ADD CONSTRAINT impersonation_sessions_target_user_id_users_id_fk FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: impersonation_sessions impersonation_sessions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_sessions
    ADD CONSTRAINT impersonation_sessions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: integrations integrations_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: integrations integrations_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: invitations invitations_invited_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_invited_by_users_id_fk FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invitations invitations_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invitations
    ADD CONSTRAINT invitations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: invoice_payments invoice_payments_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoice_payments invoice_payments_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoice_payments invoice_payments_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_payments
    ADD CONSTRAINT invoice_payments_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kb_articles kb_articles_category_id_kb_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_articles
    ADD CONSTRAINT kb_articles_category_id_kb_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.kb_categories(id) ON DELETE SET NULL;


--
-- Name: kb_articles kb_articles_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_articles
    ADD CONSTRAINT kb_articles_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kb_articles kb_articles_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_articles
    ADD CONSTRAINT kb_articles_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: kb_categories kb_categories_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_categories
    ADD CONSTRAINT kb_categories_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: kb_categories kb_categories_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_categories
    ADD CONSTRAINT kb_categories_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: lead_activities lead_activities_lead_id_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_lead_id_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_activities lead_activities_performed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_performed_by_users_id_fk FOREIGN KEY (performed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lead_activities lead_activities_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: lead_activities lead_activities_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_activities
    ADD CONSTRAINT lead_activities_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: lead_assignments lead_assignments_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: lead_assignments lead_assignments_lead_id_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_lead_id_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_assignments lead_assignments_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: lead_assignments lead_assignments_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_assignments
    ADD CONSTRAINT lead_assignments_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: lead_offers lead_offers_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_offers
    ADD CONSTRAINT lead_offers_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lead_offers lead_offers_lead_id_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_offers
    ADD CONSTRAINT lead_offers_lead_id_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_offers lead_offers_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_offers
    ADD CONSTRAINT lead_offers_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: lead_scoring_rules lead_scoring_rules_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_scoring_rules
    ADD CONSTRAINT lead_scoring_rules_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lead_scoring_rules lead_scoring_rules_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_scoring_rules
    ADD CONSTRAINT lead_scoring_rules_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: lead_scoring_rules lead_scoring_rules_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_scoring_rules
    ADD CONSTRAINT lead_scoring_rules_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lead_tags lead_tags_lead_id_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_tags
    ADD CONSTRAINT lead_tags_lead_id_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;


--
-- Name: lead_tags lead_tags_tag_id_tags_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_tags
    ADD CONSTRAINT lead_tags_tag_id_tags_id_fk FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE;


--
-- Name: lead_warming_campaigns lead_warming_campaigns_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_campaigns
    ADD CONSTRAINT lead_warming_campaigns_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: lead_warming_campaigns lead_warming_campaigns_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_campaigns
    ADD CONSTRAINT lead_warming_campaigns_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: lead_warming_events lead_warming_events_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_events
    ADD CONSTRAINT lead_warming_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: lead_warming_messages lead_warming_messages_campaign_id_lead_warming_campaigns_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_messages
    ADD CONSTRAINT lead_warming_messages_campaign_id_lead_warming_campaigns_id_fk FOREIGN KEY (campaign_id) REFERENCES public.lead_warming_campaigns(id) ON DELETE CASCADE;


--
-- Name: lead_warming_messages lead_warming_messages_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_messages
    ADD CONSTRAINT lead_warming_messages_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: lead_warming_messages lead_warming_messages_event_id_lead_warming_events_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_messages
    ADD CONSTRAINT lead_warming_messages_event_id_lead_warming_events_id_fk FOREIGN KEY (event_id) REFERENCES public.lead_warming_events(id) ON DELETE SET NULL;


--
-- Name: lead_warming_messages lead_warming_messages_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_messages
    ADD CONSTRAINT lead_warming_messages_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: lead_warming_replies lead_warming_replies_campaign_id_lead_warming_campaigns_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_replies
    ADD CONSTRAINT lead_warming_replies_campaign_id_lead_warming_campaigns_id_fk FOREIGN KEY (campaign_id) REFERENCES public.lead_warming_campaigns(id) ON DELETE SET NULL;


--
-- Name: lead_warming_replies lead_warming_replies_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_replies
    ADD CONSTRAINT lead_warming_replies_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: lead_warming_replies lead_warming_replies_message_id_lead_warming_messages_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_replies
    ADD CONSTRAINT lead_warming_replies_message_id_lead_warming_messages_id_fk FOREIGN KEY (message_id) REFERENCES public.lead_warming_messages(id) ON DELETE CASCADE;


--
-- Name: lead_warming_replies lead_warming_replies_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_replies
    ADD CONSTRAINT lead_warming_replies_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: lead_warming_schedule lead_warming_schedule_campaign_id_lead_warming_campaigns_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_schedule
    ADD CONSTRAINT lead_warming_schedule_campaign_id_lead_warming_campaigns_id_fk FOREIGN KEY (campaign_id) REFERENCES public.lead_warming_campaigns(id) ON DELETE CASCADE;


--
-- Name: lead_warming_schedule lead_warming_schedule_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_schedule
    ADD CONSTRAINT lead_warming_schedule_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: lead_warming_schedule lead_warming_schedule_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_warming_schedule
    ADD CONSTRAINT lead_warming_schedule_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: leads leads_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: leads leads_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: leads leads_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: leads leads_converted_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_converted_contact_id_contacts_id_fk FOREIGN KEY (converted_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: leads leads_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: leads leads_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: leads leads_owner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: leads leads_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: leads leads_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: limit_violations limit_violations_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.limit_violations
    ADD CONSTRAINT limit_violations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: meetings meetings_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: meetings meetings_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: meetings meetings_deal_id_deals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_deal_id_deals_id_fk FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;


--
-- Name: meetings meetings_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: meetings meetings_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: meetings meetings_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: meetings meetings_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: milestones milestones_project_id_projects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT milestones_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: milestones milestones_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.milestones
    ADD CONSTRAINT milestones_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: notes notes_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notes notes_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notes notes_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: notes notes_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: oauth_clients oauth_clients_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_clients
    ADD CONSTRAINT oauth_clients_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: oauth_clients oauth_clients_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_clients
    ADD CONSTRAINT oauth_clients_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: oauth_codes oauth_codes_client_id_oauth_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_codes
    ADD CONSTRAINT oauth_codes_client_id_oauth_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_codes oauth_codes_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_codes
    ADD CONSTRAINT oauth_codes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: oauth_tokens oauth_tokens_client_id_oauth_clients_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_tokens
    ADD CONSTRAINT oauth_tokens_client_id_oauth_clients_id_fk FOREIGN KEY (client_id) REFERENCES public.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_tokens oauth_tokens_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_tokens
    ADD CONSTRAINT oauth_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: onboarding_progress onboarding_progress_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: onboarding_progress onboarding_progress_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: orders orders_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: orders orders_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: orders orders_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: orders orders_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: orders orders_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: orders orders_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: page_views page_views_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_views
    ADD CONSTRAINT page_views_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: password_resets password_resets_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: permission_overrides permission_overrides_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_overrides
    ADD CONSTRAINT permission_overrides_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: permission_overrides permission_overrides_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission_overrides
    ADD CONSTRAINT permission_overrides_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: pipeline_health_metrics pipeline_health_metrics_pipeline_id_pipelines_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_health_metrics
    ADD CONSTRAINT pipeline_health_metrics_pipeline_id_pipelines_id_fk FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;


--
-- Name: pipeline_health_metrics pipeline_health_metrics_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_health_metrics
    ADD CONSTRAINT pipeline_health_metrics_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: pipeline_stages pipeline_stages_pipeline_id_pipelines_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pipeline_id_pipelines_id_fk FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;


--
-- Name: pipelines pipelines_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: platform_settings platform_settings_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_settings
    ADD CONSTRAINT platform_settings_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: plugin_execution_logs plugin_execution_logs_plugin_id_custom_plugins_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_execution_logs
    ADD CONSTRAINT plugin_execution_logs_plugin_id_custom_plugins_id_fk FOREIGN KEY (plugin_id) REFERENCES public.custom_plugins(id) ON DELETE CASCADE;


--
-- Name: plugin_execution_logs plugin_execution_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plugin_execution_logs
    ADD CONSTRAINT plugin_execution_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: portal_clients portal_clients_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_clients
    ADD CONSTRAINT portal_clients_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: portal_clients portal_clients_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.portal_clients
    ADD CONSTRAINT portal_clients_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: price_book_entries price_book_entries_price_book_id_price_books_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_book_entries
    ADD CONSTRAINT price_book_entries_price_book_id_price_books_id_fk FOREIGN KEY (price_book_id) REFERENCES public.price_books(id) ON DELETE CASCADE;


--
-- Name: price_book_entries price_book_entries_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_book_entries
    ADD CONSTRAINT price_book_entries_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: price_books price_books_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_books
    ADD CONSTRAINT price_books_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: price_books price_books_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_books
    ADD CONSTRAINT price_books_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: price_books price_books_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_books
    ADD CONSTRAINT price_books_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: price_books price_books_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_books
    ADD CONSTRAINT price_books_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: product_templates product_templates_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_templates
    ADD CONSTRAINT product_templates_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: products products_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: products products_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: products products_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: products products_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: project_tasks project_tasks_added_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_tasks
    ADD CONSTRAINT project_tasks_added_by_users_id_fk FOREIGN KEY (added_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: project_tasks project_tasks_project_id_projects_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_tasks
    ADD CONSTRAINT project_tasks_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_tasks project_tasks_task_id_tasks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_tasks
    ADD CONSTRAINT project_tasks_task_id_tasks_id_fk FOREIGN KEY (task_id) REFERENCES public.tasks(id) ON DELETE CASCADE;


--
-- Name: project_tasks project_tasks_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_tasks
    ADD CONSTRAINT project_tasks_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: projects projects_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: projects projects_owner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: projects projects_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: quote_line_items quote_line_items_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_line_items
    ADD CONSTRAINT quote_line_items_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: quote_line_items quote_line_items_quote_id_quotes_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quote_line_items
    ADD CONSTRAINT quote_line_items_quote_id_quotes_id_fk FOREIGN KEY (quote_id) REFERENCES public.quotes(id) ON DELETE CASCADE;


--
-- Name: quotes quotes_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: quotes quotes_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: quotes quotes_deal_id_deals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_deal_id_deals_id_fk FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;


--
-- Name: quotes quotes_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: quotes quotes_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: quotes quotes_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotes
    ADD CONSTRAINT quotes_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: record_permissions record_permissions_granted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_permissions
    ADD CONSTRAINT record_permissions_granted_by_users_id_fk FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: record_permissions record_permissions_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_permissions
    ADD CONSTRAINT record_permissions_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: record_permissions record_permissions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_permissions
    ADD CONSTRAINT record_permissions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: report_executions report_executions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_executions
    ADD CONSTRAINT report_executions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: report_executions report_executions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.report_executions
    ADD CONSTRAINT report_executions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: restore_snapshots restore_snapshots_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restore_snapshots
    ADD CONSTRAINT restore_snapshots_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: revenue_forecast_summary revenue_forecast_summary_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_forecast_summary
    ADD CONSTRAINT revenue_forecast_summary_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: revenue_opportunities revenue_opportunities_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_opportunities
    ADD CONSTRAINT revenue_opportunities_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: revenue_projections revenue_projections_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revenue_projections
    ADD CONSTRAINT revenue_projections_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: roles roles_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: saved_reports saved_reports_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports
    ADD CONSTRAINT saved_reports_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: saved_reports saved_reports_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports
    ADD CONSTRAINT saved_reports_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: saved_reports saved_reports_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports
    ADD CONSTRAINT saved_reports_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: saved_reports saved_reports_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_reports
    ADD CONSTRAINT saved_reports_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: saved_views saved_views_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: saved_views saved_views_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_views
    ADD CONSTRAINT saved_views_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: scheduled_reports scheduled_reports_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_reports
    ADD CONSTRAINT scheduled_reports_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: scheduled_reports scheduled_reports_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scheduled_reports
    ADD CONSTRAINT scheduled_reports_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: security_events security_events_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: security_events security_events_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: segment_members segment_members_segment_id_segments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segment_members
    ADD CONSTRAINT segment_members_segment_id_segments_id_fk FOREIGN KEY (segment_id) REFERENCES public.segments(id) ON DELETE CASCADE;


--
-- Name: segment_members segment_members_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segment_members
    ADD CONSTRAINT segment_members_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: segments segments_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segments
    ADD CONSTRAINT segments_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: segments segments_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segments
    ADD CONSTRAINT segments_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: segments segments_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segments
    ADD CONSTRAINT segments_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: segments segments_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.segments
    ADD CONSTRAINT segments_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: selective_restore_audit_log selective_restore_audit_log_performed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selective_restore_audit_log
    ADD CONSTRAINT selective_restore_audit_log_performed_by_users_id_fk FOREIGN KEY (performed_by) REFERENCES public.users(id);


--
-- Name: selective_restore_audit_log selective_restore_audit_log_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selective_restore_audit_log
    ADD CONSTRAINT selective_restore_audit_log_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: selective_restore_logs selective_restore_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.selective_restore_logs
    ADD CONSTRAINT selective_restore_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sequence_enrollments sequence_enrollments_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: sequence_enrollments sequence_enrollments_enrolled_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_enrolled_by_users_id_fk FOREIGN KEY (enrolled_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sequence_enrollments sequence_enrollments_sequence_id_sequences_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_sequence_id_sequences_id_fk FOREIGN KEY (sequence_id) REFERENCES public.sequences(id) ON DELETE CASCADE;


--
-- Name: sequence_enrollments sequence_enrollments_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sequence_step_logs sequence_step_logs_enrollment_id_sequence_enrollments_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_step_logs
    ADD CONSTRAINT sequence_step_logs_enrollment_id_sequence_enrollments_id_fk FOREIGN KEY (enrollment_id) REFERENCES public.sequence_enrollments(id) ON DELETE CASCADE;


--
-- Name: sequence_step_logs sequence_step_logs_step_id_sequence_steps_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_step_logs
    ADD CONSTRAINT sequence_step_logs_step_id_sequence_steps_id_fk FOREIGN KEY (step_id) REFERENCES public.sequence_steps(id) ON DELETE SET NULL;


--
-- Name: sequence_step_logs sequence_step_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_step_logs
    ADD CONSTRAINT sequence_step_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sequence_steps sequence_steps_sequence_id_sequences_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_steps
    ADD CONSTRAINT sequence_steps_sequence_id_sequences_id_fk FOREIGN KEY (sequence_id) REFERENCES public.sequences(id) ON DELETE CASCADE;


--
-- Name: sequence_steps sequence_steps_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_steps
    ADD CONSTRAINT sequence_steps_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sequences sequences_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequences
    ADD CONSTRAINT sequences_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sequences sequences_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequences
    ADD CONSTRAINT sequences_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sequences sequences_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequences
    ADD CONSTRAINT sequences_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sequences sequences_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequences
    ADD CONSTRAINT sequences_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: service_categories service_categories_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: service_categories service_categories_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: service_categories service_categories_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: service_categories service_categories_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_categories
    ADD CONSTRAINT service_categories_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: service_subscriptions service_subscriptions_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_subscriptions
    ADD CONSTRAINT service_subscriptions_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: service_subscriptions service_subscriptions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_subscriptions
    ADD CONSTRAINT service_subscriptions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: services services_company_id_companies_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: services services_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: services services_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: services services_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: services services_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: services services_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: signing_events signing_events_request_id_signing_requests_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signing_events
    ADD CONSTRAINT signing_events_request_id_signing_requests_id_fk FOREIGN KEY (request_id) REFERENCES public.signing_requests(id) ON DELETE CASCADE;


--
-- Name: signing_events signing_events_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signing_events
    ADD CONSTRAINT signing_events_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: signing_requests signing_requests_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signing_requests
    ADD CONSTRAINT signing_requests_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sla_breaches sla_breaches_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_breaches
    ADD CONSTRAINT sla_breaches_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sla_policies sla_policies_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sla_policies
    ADD CONSTRAINT sla_policies_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sms_messages sms_messages_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages
    ADD CONSTRAINT sms_messages_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: sms_messages sms_messages_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_messages
    ADD CONSTRAINT sms_messages_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sms_templates sms_templates_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sms_templates
    ADD CONSTRAINT sms_templates_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sso_providers sso_providers_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_providers
    ADD CONSTRAINT sso_providers_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sso_sessions sso_sessions_provider_id_sso_providers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_sessions
    ADD CONSTRAINT sso_sessions_provider_id_sso_providers_id_fk FOREIGN KEY (provider_id) REFERENCES public.sso_providers(id) ON DELETE SET NULL;


--
-- Name: sso_sessions sso_sessions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_sessions
    ADD CONSTRAINT sso_sessions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: sso_sessions sso_sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sso_sessions
    ADD CONSTRAINT sso_sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: storage_documents storage_documents_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_documents
    ADD CONSTRAINT storage_documents_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: storage_documents storage_documents_uploaded_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.storage_documents
    ADD CONSTRAINT storage_documents_uploaded_by_users_id_fk FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subscriptions subscriptions_plan_id_plans_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_plans_id_fk FOREIGN KEY (plan_id) REFERENCES public.plans(id);


--
-- Name: subscriptions subscriptions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_tickets support_tickets_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: support_tickets support_tickets_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_tickets support_tickets_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: support_tickets support_tickets_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tags tags_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_assigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_assigned_to_users_id_fk FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_deal_id_deals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_deal_id_deals_id_fk FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tax_exemptions tax_exemptions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_exemptions
    ADD CONSTRAINT tax_exemptions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tax_rates tax_rates_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tax_rates
    ADD CONSTRAINT tax_rates_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_ai_credentials tenant_ai_credentials_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_ai_credentials
    ADD CONSTRAINT tenant_ai_credentials_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tenant_ai_credentials tenant_ai_credentials_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_ai_credentials
    ADD CONSTRAINT tenant_ai_credentials_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tenant_ai_credentials tenant_ai_credentials_provider_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_ai_credentials
    ADD CONSTRAINT tenant_ai_credentials_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES public.ai_providers(id) ON DELETE CASCADE;


--
-- Name: tenant_ai_credentials tenant_ai_credentials_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_ai_credentials
    ADD CONSTRAINT tenant_ai_credentials_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_ai_credentials tenant_ai_credentials_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_ai_credentials
    ADD CONSTRAINT tenant_ai_credentials_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tenant_ai_credits tenant_ai_credits_allocated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_ai_credits
    ADD CONSTRAINT tenant_ai_credits_allocated_by_users_id_fk FOREIGN KEY (allocated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tenant_ai_credits tenant_ai_credits_set_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_ai_credits
    ADD CONSTRAINT tenant_ai_credits_set_by_users_id_fk FOREIGN KEY (set_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tenant_ai_credits tenant_ai_credits_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_ai_credits
    ADD CONSTRAINT tenant_ai_credits_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_backup_records tenant_backup_records_initiated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_backup_records
    ADD CONSTRAINT tenant_backup_records_initiated_by_users_id_fk FOREIGN KEY (initiated_by) REFERENCES public.users(id);


--
-- Name: tenant_backup_records tenant_backup_records_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_backup_records
    ADD CONSTRAINT tenant_backup_records_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_backups tenant_backups_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_backups
    ADD CONSTRAINT tenant_backups_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_members tenant_members_invited_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_invited_by_users_id_fk FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tenant_members tenant_members_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;


--
-- Name: tenant_members tenant_members_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_members tenant_members_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_members
    ADD CONSTRAINT tenant_members_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tenant_modules tenant_modules_installed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_modules
    ADD CONSTRAINT tenant_modules_installed_by_users_id_fk FOREIGN KEY (installed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tenant_modules tenant_modules_module_id_modules_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_modules
    ADD CONSTRAINT tenant_modules_module_id_modules_id_fk FOREIGN KEY (module_id) REFERENCES public.modules(id) ON DELETE CASCADE;


--
-- Name: tenant_modules tenant_modules_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_modules
    ADD CONSTRAINT tenant_modules_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_restore_records tenant_restore_records_backup_id_tenant_backup_records_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_restore_records
    ADD CONSTRAINT tenant_restore_records_backup_id_tenant_backup_records_id_fk FOREIGN KEY (backup_id) REFERENCES public.tenant_backup_records(id) ON DELETE CASCADE;


--
-- Name: tenant_restore_records tenant_restore_records_initiated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_restore_records
    ADD CONSTRAINT tenant_restore_records_initiated_by_users_id_fk FOREIGN KEY (initiated_by) REFERENCES public.users(id);


--
-- Name: tenant_restore_records tenant_restore_records_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_restore_records
    ADD CONSTRAINT tenant_restore_records_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_restores tenant_restores_backup_id_tenant_backups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_restores
    ADD CONSTRAINT tenant_restores_backup_id_tenant_backups_id_fk FOREIGN KEY (backup_id) REFERENCES public.tenant_backups(id);


--
-- Name: tenant_restores tenant_restores_initiated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_restores
    ADD CONSTRAINT tenant_restores_initiated_by_users_id_fk FOREIGN KEY (initiated_by) REFERENCES public.users(id);


--
-- Name: tenant_restores tenant_restores_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_restores
    ADD CONSTRAINT tenant_restores_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_templates tenant_templates_applied_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_templates
    ADD CONSTRAINT tenant_templates_applied_by_users_id_fk FOREIGN KEY (applied_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: tenant_templates tenant_templates_template_id_product_templates_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_templates
    ADD CONSTRAINT tenant_templates_template_id_product_templates_id_fk FOREIGN KEY (template_id) REFERENCES public.product_templates(id) ON DELETE CASCADE;


--
-- Name: tenant_templates tenant_templates_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_templates
    ADD CONSTRAINT tenant_templates_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_token_limits tenant_token_limits_set_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_token_limits
    ADD CONSTRAINT tenant_token_limits_set_by_users_id_fk FOREIGN KEY (set_by) REFERENCES public.users(id);


--
-- Name: tenant_token_limits tenant_token_limits_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_token_limits
    ADD CONSTRAINT tenant_token_limits_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenants tenants_owner_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: territories territories_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.territories
    ADD CONSTRAINT territories_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: territory_assignments territory_assignments_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.territory_assignments
    ADD CONSTRAINT territory_assignments_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ticket_replies ticket_replies_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_replies
    ADD CONSTRAINT ticket_replies_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: ticket_replies ticket_replies_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_replies
    ADD CONSTRAINT ticket_replies_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: ticket_replies ticket_replies_ticket_id_support_tickets_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_replies
    ADD CONSTRAINT ticket_replies_ticket_id_support_tickets_id_fk FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- Name: ticket_replies ticket_replies_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ticket_replies
    ADD CONSTRAINT ticket_replies_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: usage_alerts usage_alerts_acknowledged_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_alerts
    ADD CONSTRAINT usage_alerts_acknowledged_by_users_id_fk FOREIGN KEY (acknowledged_by) REFERENCES public.users(id);


--
-- Name: usage_snapshots usage_snapshots_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_snapshots
    ADD CONSTRAINT usage_snapshots_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: user_departures user_departures_contacts_reassigned_to_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departures
    ADD CONSTRAINT user_departures_contacts_reassigned_to_users_id_fk FOREIGN KEY (contacts_reassigned_to) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_departures user_departures_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departures
    ADD CONSTRAINT user_departures_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_departures user_departures_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departures
    ADD CONSTRAINT user_departures_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_departures user_departures_departed_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departures
    ADD CONSTRAINT user_departures_departed_by_users_id_fk FOREIGN KEY (departed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_departures user_departures_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departures
    ADD CONSTRAINT user_departures_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: user_departures user_departures_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departures
    ADD CONSTRAINT user_departures_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_departures user_departures_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_departures
    ADD CONSTRAINT user_departures_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_token_limits user_token_limits_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_token_limits
    ADD CONSTRAINT user_token_limits_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: user_token_limits user_token_limits_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_token_limits
    ADD CONSTRAINT user_token_limits_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_usage user_usage_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_usage
    ADD CONSTRAINT user_usage_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: user_usage user_usage_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_usage
    ADD CONSTRAINT user_usage_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: visitors visitors_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visitors
    ADD CONSTRAINT visitors_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: voice_calls voice_calls_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_calls
    ADD CONSTRAINT voice_calls_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: voice_calls voice_calls_deal_id_deals_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_calls
    ADD CONSTRAINT voice_calls_deal_id_deals_id_fk FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;


--
-- Name: voice_calls voice_calls_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_calls
    ADD CONSTRAINT voice_calls_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: webhook_deliveries webhook_deliveries_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: webhook_deliveries webhook_deliveries_webhook_id_webhooks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_webhook_id_webhooks_id_fk FOREIGN KEY (webhook_id) REFERENCES public.webhooks(id) ON DELETE CASCADE;


--
-- Name: webhook_inbound_logs webhook_inbound_logs_api_key_id_api_keys_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_inbound_logs
    ADD CONSTRAINT webhook_inbound_logs_api_key_id_api_keys_id_fk FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id);


--
-- Name: webhook_inbound_logs webhook_inbound_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_inbound_logs
    ADD CONSTRAINT webhook_inbound_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: webhook_inbound_logs webhook_inbound_logs_webhook_id_webhooks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_inbound_logs
    ADD CONSTRAINT webhook_inbound_logs_webhook_id_webhooks_id_fk FOREIGN KEY (webhook_id) REFERENCES public.webhooks(id);


--
-- Name: webhook_queue webhook_queue_webhook_id_webhooks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_queue
    ADD CONSTRAINT webhook_queue_webhook_id_webhooks_id_fk FOREIGN KEY (webhook_id) REFERENCES public.webhooks(id) ON DELETE CASCADE;


--
-- Name: webhooks webhooks_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: whatsapp_conversations whatsapp_conversations_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: whatsapp_conversations whatsapp_conversations_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_conversations
    ADD CONSTRAINT whatsapp_conversations_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: whatsapp_messages whatsapp_messages_conversation_id_whatsapp_conversations_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_conversation_id_whatsapp_conversations_id_fk FOREIGN KEY (conversation_id) REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE;


--
-- Name: whatsapp_messages whatsapp_messages_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: whatsapp_templates whatsapp_templates_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_templates
    ADD CONSTRAINT whatsapp_templates_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: workflow_action_logs workflow_action_logs_action_id_workflow_actions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_action_logs
    ADD CONSTRAINT workflow_action_logs_action_id_workflow_actions_id_fk FOREIGN KEY (action_id) REFERENCES public.workflow_actions(id) ON DELETE SET NULL;


--
-- Name: workflow_action_logs workflow_action_logs_execution_id_workflow_executions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_action_logs
    ADD CONSTRAINT workflow_action_logs_execution_id_workflow_executions_id_fk FOREIGN KEY (execution_id) REFERENCES public.workflow_executions(id) ON DELETE CASCADE;


--
-- Name: workflow_action_logs workflow_action_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_action_logs
    ADD CONSTRAINT workflow_action_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: workflow_actions workflow_actions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_actions
    ADD CONSTRAINT workflow_actions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: workflow_actions workflow_actions_workflow_id_workflows_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_actions
    ADD CONSTRAINT workflow_actions_workflow_id_workflows_id_fk FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflow_execution_logs workflow_execution_logs_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_execution_logs
    ADD CONSTRAINT workflow_execution_logs_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: workflow_execution_logs workflow_execution_logs_workflow_execution_id_workflow_executio; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_execution_logs
    ADD CONSTRAINT workflow_execution_logs_workflow_execution_id_workflow_executio FOREIGN KEY (workflow_execution_id) REFERENCES public.workflow_executions(id) ON DELETE CASCADE;


--
-- Name: workflow_executions workflow_executions_contact_id_contacts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_executions
    ADD CONSTRAINT workflow_executions_contact_id_contacts_id_fk FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: workflow_executions workflow_executions_lead_id_leads_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_executions
    ADD CONSTRAINT workflow_executions_lead_id_leads_id_fk FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;


--
-- Name: workflow_executions workflow_executions_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_executions
    ADD CONSTRAINT workflow_executions_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: workflow_executions workflow_executions_workflow_id_workflows_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflow_executions
    ADD CONSTRAINT workflow_executions_workflow_id_workflows_id_fk FOREIGN KEY (workflow_id) REFERENCES public.workflows(id) ON DELETE CASCADE;


--
-- Name: workflows workflows_created_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: workflows workflows_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: workflows workflows_tenant_id_tenants_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_tenant_id_tenants_id_fk FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: workflows workflows_updated_by_users_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workflows
    ADD CONSTRAINT workflows_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: automations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

--
-- Name: meetings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

--
-- Name: notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: activities tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.activities USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: api_keys tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.api_keys USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: audit_logs tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.audit_logs USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: automations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.automations USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: companies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.companies USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: contacts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.contacts USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: deals tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.deals USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: meetings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.meetings USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: notes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.notes USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: notifications tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.notifications USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: tasks tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.tasks USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: webhook_deliveries tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.webhook_deliveries USING ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)) WITH CHECK ((tenant_id = (current_setting('app.current_tenant'::text, true))::uuid));


--
-- Name: webhook_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict BAgfY31P0qQ72qAqzLf2e6bBnJReSFZJ3jzBrVtPvt9yBrMBnG35kQGBi1bifLp

