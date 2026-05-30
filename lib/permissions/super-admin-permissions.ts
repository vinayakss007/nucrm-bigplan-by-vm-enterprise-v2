/**
 * Super Admin Permission Definitions
 * ───────────────────────────────────
 * Granular permission system for super admin roles.
 * Format: category.action
 */

export interface SuperAdminPermission {
  id: string;
  label: string;
  description: string;
  category: string;
}

export const SUPER_ADMIN_PERMISSIONS: SuperAdminPermission[] = [
  // Tenants
  { id: 'tenants.view', label: 'View Tenants', description: 'View all tenant organizations', category: 'Tenants' },
  { id: 'tenants.manage', label: 'Manage Tenants', description: 'Create and update tenants', category: 'Tenants' },
  { id: 'tenants.delete', label: 'Delete Tenants', description: 'Delete or suspend tenants', category: 'Tenants' },

  // Users
  { id: 'users.view', label: 'View Users', description: 'View all platform users', category: 'Users' },
  { id: 'users.manage', label: 'Manage Users', description: 'Create and update users', category: 'Users' },

  // Plans
  { id: 'plans.view', label: 'View Plans', description: 'View subscription plans', category: 'Plans' },
  { id: 'plans.manage', label: 'Manage Plans', description: 'Create and update plans', category: 'Plans' },

  // Modules
  { id: 'modules.view', label: 'View Modules', description: 'View module registry', category: 'Modules' },
  { id: 'modules.manage', label: 'Manage Modules', description: 'Enable or disable modules', category: 'Modules' },

  // Settings
  { id: 'settings.view', label: 'View Settings', description: 'View platform settings', category: 'Settings' },
  { id: 'settings.manage', label: 'Manage Settings', description: 'Change platform settings', category: 'Settings' },

  // Audit
  { id: 'audit.view', label: 'View Audit Logs', description: 'View audit trail', category: 'Audit' },

  // Billing
  { id: 'billing.view', label: 'View Billing', description: 'View billing and revenue data', category: 'Billing' },
  { id: 'billing.manage', label: 'Manage Billing', description: 'Manage billing settings and invoices', category: 'Billing' },

  // Monitoring
  { id: 'monitoring.view', label: 'View Monitoring', description: 'View system health and monitoring', category: 'Monitoring' },

  // Backups
  { id: 'backups.view', label: 'View Backups', description: 'View backup records', category: 'Backups' },
  { id: 'backups.manage', label: 'Manage Backups', description: 'Create and restore backups', category: 'Backups' },
];

export const SUPER_ADMIN_PERMISSION_IDS = SUPER_ADMIN_PERMISSIONS.map(p => p.id);

export interface SuperAdminRole {
  slug: string;
  label: string;
  description: string;
  permissions: Record<string, boolean>;
}

export const SUPER_ADMIN_ROLES: Record<string, SuperAdminRole> = {
  super_admin_full: {
    slug: 'super_admin_full',
    label: 'Full Access',
    description: 'All super admin permissions',
    permissions: Object.fromEntries(SUPER_ADMIN_PERMISSIONS.map(p => [p.id, true])),
  },
  super_admin_readonly: {
    slug: 'super_admin_readonly',
    label: 'Read Only',
    description: 'View-only access to all sections',
    permissions: Object.fromEntries(
      SUPER_ADMIN_PERMISSIONS.map(p => [p.id, p.id.endsWith('.view')])
    ),
  },
  super_admin_tenant_manager: {
    slug: 'super_admin_tenant_manager',
    label: 'Tenant Manager',
    description: 'Manage tenants and users',
    permissions: Object.fromEntries(
      SUPER_ADMIN_PERMISSIONS.map(p => [
        p.id,
        p.category === 'Tenants' || p.category === 'Users' || p.id.endsWith('.view'),
      ])
    ),
  },
  super_admin_billing: {
    slug: 'super_admin_billing',
    label: 'Billing Manager',
    description: 'Manage billing and plans',
    permissions: Object.fromEntries(
      SUPER_ADMIN_PERMISSIONS.map(p => [
        p.id,
        p.category === 'Billing' || p.category === 'Plans' || p.id.endsWith('.view'),
      ])
    ),
  },
};

export const SUPER_ADMIN_ROLE_SLUGS = Object.keys(SUPER_ADMIN_ROLES);
