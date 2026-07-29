-- Brute Force Protection Tables
-- Track failed login attempts and block attackers

-- Failed login attempts tracker
CREATE TABLE IF NOT EXISTS login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip_address text NOT NULL,
  user_agent text,
  success boolean NOT NULL DEFAULT false,
  failure_reason text,
  attempted_at timestamp with time zone DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address);
CREATE INDEX IF NOT EXISTS idx_login_attempts_time ON login_attempts(attempted_at DESC);

-- Blocked IPs/email combinations
CREATE TABLE IF NOT EXISTS login_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL, -- IP address or email
  identifier_type text NOT NULL CHECK (identifier_type IN ('ip', 'email')),
  blocked_until timestamp with time zone NOT NULL,
  block_reason text,
  attempts_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_blocks_identifier ON login_blocks(identifier);
CREATE INDEX IF NOT EXISTS idx_login_blocks_until ON login_blocks(blocked_until);

-- Security events for audit logging
CREATE TABLE IF NOT EXISTS security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  ip_address text,
  user_agent text,
  metadata jsonb,
  created_at timestamp with time zone DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_events_tenant ON security_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_time ON security_events(created_at DESC);

-- Trigger to auto-cleanup old login attempts (keep 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_login_attempts()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '30 days';
  DELETE FROM login_blocks WHERE blocked_until < NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER cleanup_login_data
AFTER INSERT ON login_attempts
FOR EACH STATEMENT
EXECUTE FUNCTION cleanup_old_login_attempts();