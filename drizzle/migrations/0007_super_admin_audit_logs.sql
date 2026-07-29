-- Super Admin Audit Logging Table
-- Tracks all Super Admin actions for security and compliance

CREATE TABLE IF NOT EXISTS super_admin_audit_logs (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id text NOT NULL,
  admin_email text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  target_name text,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  tenant_name text,
  ip_address text,
  user_agent text,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sa_audit_admin ON super_admin_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_sa_audit_action ON super_admin_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_sa_audit_target ON super_admin_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_sa_audit_tenant ON super_admin_audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sa_audit_time ON super_admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sa_audit_admin_time ON super_admin_audit_logs(admin_id, created_at DESC);