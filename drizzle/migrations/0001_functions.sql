-- ─────────────────────────────────────────────────────────────
-- NuCRM — Database Functions & Triggers
-- Centralized logic for automation and integrity
-- ─────────────────────────────────────────────────────────────

-- 1. Updated At Helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Purge Trash Function
CREATE OR REPLACE FUNCTION public.purge_trash()
RETURNS integer AS $$
DECLARE
  purged integer := 0;
  n integer;
BEGIN
  DELETE FROM public.contacts WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS n = ROW_COUNT; purged := purged + n;

  DELETE FROM public.deals WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS n = ROW_COUNT; purged := purged + n;

  DELETE FROM public.leads WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS n = ROW_COUNT; purged := purged + n;

  DELETE FROM public.tasks WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS n = ROW_COUNT; purged := purged + n;

  RETURN purged;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Platform Stats Function
CREATE OR REPLACE FUNCTION public.platform_stats()
RETURNS jsonb AS $$
BEGIN
  RETURN jsonb_build_object(
    'total_tenants', (SELECT count(*) FROM public.tenants),
    'active_tenants', (SELECT count(*) FROM public.tenants WHERE status = 'active'),
    'trialing', (SELECT count(*) FROM public.tenants WHERE status = 'trialing'),
    'total_users', (SELECT count(*) FROM public.users),
    'total_contacts', (SELECT count(*) FROM public.contacts WHERE deleted_at IS NULL),
    'unresolved_errors', (SELECT count(*) FROM public.error_logs WHERE resolved = false),
    'mrr', (SELECT COALESCE(SUM(p.price_monthly), 0) FROM public.tenants t JOIN public.plans p ON p.id = t.plan_id WHERE t.status IN ('active', 'trialing'))
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Tenant Usage Tracking Functions
CREATE OR REPLACE FUNCTION public.on_contact_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.tenants SET current_contacts = current_contacts + 1 WHERE id = NEW.tenant_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.tenants SET current_contacts = GREATEST(0, current_contacts - 1) WHERE id = OLD.tenant_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.on_deal_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.tenants SET current_deals = current_deals + 1 WHERE id = NEW.tenant_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.tenants SET current_deals = GREATEST(0, current_deals - 1) WHERE id = OLD.tenant_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Automatic Role Creation
CREATE OR REPLACE FUNCTION public.create_default_roles(p_tenant_id uuid)
RETURNS void AS $$
BEGIN
  INSERT INTO public.roles (tenant_id, name, slug, description, is_system, permissions, sort_order)
  VALUES
  (p_tenant_id, 'Admin', 'admin', 'Full access', true, '{"all": true}'::jsonb, 0),
  (p_tenant_id, 'Manager', 'manager', 'Team management', true, '{"contacts.view_all":true,"deals.view_all":true}'::jsonb, 1),
  (p_tenant_id, 'Sales Rep', 'sales_rep', 'Personal records', true, '{"contacts.create":true,"deals.create":true}'::jsonb, 2),
  (p_tenant_id, 'Viewer', 'viewer', 'Read-only', true, '{"contacts.view_all":true,"deals.view_all":true}'::jsonb, 3)
  ON CONFLICT (tenant_id, slug) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.on_tenant_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.create_default_roles(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Apply Triggers
DO $$
DECLARE
  tbl text;
BEGIN
  -- Updated At Triggers
  FOREACH tbl IN ARRAY ARRAY['users','tenants','companies','contacts','deals','tasks','support_tickets'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_updated_at ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', tbl);
  END LOOP;

  -- Usage Tracking Triggers
  DROP TRIGGER IF EXISTS trg_contact_count ON public.contacts;
  CREATE TRIGGER trg_contact_count AFTER INSERT OR DELETE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.on_contact_change();

  DROP TRIGGER IF EXISTS trg_deal_count ON public.deals;
  CREATE TRIGGER trg_deal_count AFTER INSERT OR DELETE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.on_deal_change();

  -- Tenant Setup Triggers
  DROP TRIGGER IF EXISTS trg_tenant_created ON public.tenants;
  CREATE TRIGGER trg_tenant_created AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.on_tenant_created();
END $$;

-- 7. Sequence Automation Functions
CREATE OR REPLACE FUNCTION public.calculate_sequence_step_date(
  p_enrolled_at TIMESTAMPTZ,
  p_sequence_id UUID,
  p_step_number INTEGER
)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_scheduled_at TIMESTAMPTZ;
BEGIN
  SELECT 
    p_enrolled_at + 
    (COALESCE(delay_days, 0) || ' days')::INTERVAL +
    (COALESCE(delay_hours, 0) || ' hours')::INTERVAL +
    (COALESCE(delay_minutes, 0) || ' minutes')::INTERVAL
  INTO v_scheduled_at
  FROM public.sequence_steps
  WHERE sequence_id = p_sequence_id AND step_number = p_step_number
  LIMIT 1;
  
  RETURN v_scheduled_at;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.enroll_contact_in_sequence(
  p_tenant_id UUID,
  p_sequence_id UUID,
  p_contact_id UUID,
  p_user_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_enrollment_id UUID;
  v_first_step_date TIMESTAMPTZ;
  v_step_id UUID;
BEGIN
  -- Check if already enrolled
  IF EXISTS (
    SELECT 1 FROM public.sequence_enrollments 
    WHERE sequence_id = p_sequence_id AND contact_id = p_contact_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Contact already enrolled in this sequence';
  END IF;

  -- Create enrollment
  INSERT INTO public.sequence_enrollments (
    sequence_id,
    contact_id,
    tenant_id,
    enrolled_by,
    current_step,
    status
  ) VALUES (
    p_sequence_id,
    p_contact_id,
    p_tenant_id,
    p_user_id,
    1,
    'active'
  ) RETURNING id INTO v_enrollment_id;

  -- Schedule first step
  SELECT public.calculate_sequence_step_date(now(), p_sequence_id, 1) INTO v_first_step_date;
  SELECT id INTO v_step_id FROM public.sequence_steps WHERE sequence_id = p_sequence_id AND step_number = 1;

  IF v_step_id IS NOT NULL THEN
    INSERT INTO public.sequence_step_logs (
      enrollment_id,
      step_id,
      tenant_id,
      status,
      scheduled_at
    ) VALUES (
      v_enrollment_id,
      v_step_id,
      p_tenant_id,
      'pending',
      COALESCE(v_first_step_date, now())
    );
    
    -- Update next_step_at in enrollment
    UPDATE public.sequence_enrollments 
    SET next_step_at = COALESCE(v_first_step_date, now())
    WHERE id = v_enrollment_id;
  END IF;

  -- Increment enrollment count
  UPDATE public.sequences SET enroll_count = COALESCE(enroll_count, 0) + 1 WHERE id = p_sequence_id;

  RETURN v_enrollment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
