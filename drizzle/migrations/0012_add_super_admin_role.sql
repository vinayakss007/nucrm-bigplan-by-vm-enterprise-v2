ALTER TABLE users ADD COLUMN IF NOT EXISTS super_admin_role text DEFAULT 'super_admin_full';
