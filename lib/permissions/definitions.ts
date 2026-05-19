/**
 * Permission Definitions
 * ─────────────────────
 * Format: resource.action
 * These are checked via has_permission() DB function.
 */

export interface Permission {
  id: string;
  label: string;
  description: string;
  category: string;
  dangerLevel: 'safe' | 'moderate' | 'danger';
}

export const PERMISSIONS: Permission[] = [
  // ── Contacts ─────────────────────────────────────────────
  { id: 'contacts.view_all',   label: 'View All Contacts',   description: 'See contacts created by others', category: 'Contacts', dangerLevel: 'safe' },
  { id: 'contacts.create',     label: 'Create Contacts',     description: 'Add new contacts',               category: 'Contacts', dangerLevel: 'safe' },
  { id: 'contacts.edit',       label: 'Edit Contacts',       description: 'Modify existing contacts',       category: 'Contacts', dangerLevel: 'moderate' },
  { id: 'contacts.delete',     label: 'Delete Contacts',     description: 'Permanently remove contacts',    category: 'Contacts', dangerLevel: 'danger' },
  { id: 'contacts.import',     label: 'Import Contacts',     description: 'Bulk import via CSV',            category: 'Contacts', dangerLevel: 'moderate' },
  { id: 'contacts.export',     label: 'Export Contacts',     description: 'Download contact data',          category: 'Contacts', dangerLevel: 'moderate' },
  { id: 'contacts.merge',      label: 'Merge Contacts',      description: 'Merge duplicate contacts',       category: 'Contacts', dangerLevel: 'danger' },
  { id: 'contacts.assign',     label: 'Assign Contacts',     description: 'Change contact owner',           category: 'Contacts', dangerLevel: 'moderate' },

  // ── Leads ────────────────────────────────────────────────
  { id: 'leads.view',        label: 'View Own Leads',      description: 'See leads assigned to you',      category: 'Leads',    dangerLevel: 'safe' },
  { id: 'leads.view_all',      label: 'View All Leads',      description: 'See leads created by others',    category: 'Leads',    dangerLevel: 'safe' },
  { id: 'leads.create',        label: 'Create Leads',        description: 'Add new leads',                  category: 'Leads',    dangerLevel: 'safe' },
  { id: 'leads.edit',          label: 'Edit Leads',          description: 'Modify existing leads',          category: 'Leads',    dangerLevel: 'moderate' },
  { id: 'leads.delete',        label: 'Delete Leads',        description: 'Permanently remove leads',       category: 'Leads',    dangerLevel: 'moderate' },
  { id: 'leads.import',        label: 'Import Leads',        description: 'Bulk import via CSV',            category: 'Leads',    dangerLevel: 'moderate' },
  { id: 'leads.export',        label: 'Export Leads',        description: 'Download lead data',             category: 'Leads',    dangerLevel: 'moderate' },
  { id: 'leads.assign',        label: 'Assign Leads',        description: 'Change lead owner',              category: 'Leads',    dangerLevel: 'moderate' },

  // ── Companies ────────────────────────────────────────────
  { id: 'companies.view_all',  label: 'View All Companies',  description: 'See all companies',              category: 'Companies', dangerLevel: 'safe' },
  { id: 'companies.create',    label: 'Create Companies',    description: 'Add new companies',              category: 'Companies', dangerLevel: 'safe' },
  { id: 'companies.edit',      label: 'Edit Companies',      description: 'Modify companies',               category: 'Companies', dangerLevel: 'moderate' },
  { id: 'companies.delete',    label: 'Delete Companies',    description: 'Remove companies',               category: 'Companies', dangerLevel: 'danger' },

  // ── Deals ────────────────────────────────────────────────
  { id: 'deals.view',        label: 'View Own Deals',      description: 'See your own deals',            category: 'Deals', dangerLevel: 'safe' },
  { id: 'deals.view_all',      label: 'View All Deals',      description: 'See deals assigned to others',  category: 'Deals', dangerLevel: 'safe' },
  { id: 'deals.create',        label: 'Create Deals',        description: 'Add new deals',                 category: 'Deals', dangerLevel: 'safe' },
  { id: 'deals.edit',          label: 'Edit Deals',          description: 'Update deal info/stage',        category: 'Deals', dangerLevel: 'moderate' },
  { id: 'deals.delete',        label: 'Delete Deals',        description: 'Remove deals permanently',      category: 'Deals', dangerLevel: 'danger' },
  { id: 'deals.assign',        label: 'Assign Deals',        description: 'Change deal owner',             category: 'Deals', dangerLevel: 'moderate' },
  { id: 'deals.view_value',    label: 'View Deal Values',    description: 'See financial amounts',         category: 'Deals', dangerLevel: 'safe' },

  // ── Tasks ────────────────────────────────────────────────
  { id: 'tasks.view_all',      label: 'View All Tasks',      description: 'See tasks of all team members', category: 'Tasks', dangerLevel: 'safe' },
  { id: 'tasks.create',        label: 'Create Tasks',        description: 'Create new tasks',              category: 'Tasks', dangerLevel: 'safe' },
  { id: 'tasks.edit',          label: 'Edit Tasks',          description: 'Update tasks',                  category: 'Tasks', dangerLevel: 'moderate' },
  { id: 'tasks.delete',        label: 'Delete Tasks',        description: 'Remove tasks',                  category: 'Tasks', dangerLevel: 'danger' },
  { id: 'tasks.assign',        label: 'Assign Tasks',        description: 'Assign tasks to team members',  category: 'Tasks', dangerLevel: 'moderate' },

  // ── Reports ──────────────────────────────────────────────
  { id: 'reports.view',        label: 'View Reports',        description: 'Access analytics & reports',    category: 'Reports', dangerLevel: 'safe' },
  { id: 'reports.export',      label: 'Export Reports',      description: 'Download report data',          category: 'Reports', dangerLevel: 'moderate' },

  // ── Settings ─────────────────────────────────────────────
  { id: 'settings.view',       label: 'View Settings',       description: 'See workspace settings',        category: 'Settings', dangerLevel: 'safe' },
  { id: 'settings.manage',     label: 'Manage Settings',     description: 'Change workspace settings',     category: 'Settings', dangerLevel: 'danger' },

  // ── Team ─────────────────────────────────────────────────
  { id: 'team.view',           label: 'View Team',           description: 'See team members',              category: 'Team', dangerLevel: 'safe' },
  { id: 'team.invite',         label: 'Invite Members',      description: 'Send team invitations',         category: 'Team', dangerLevel: 'moderate' },
  { id: 'team.remove',         label: 'Remove Members',      description: 'Remove users from workspace',   category: 'Team', dangerLevel: 'danger' },
  { id: 'team.manage_roles',   label: 'Manage Roles',        description: 'Create/edit roles & permissions', category: 'Team', dangerLevel: 'danger' },

  // ── Automations ──────────────────────────────────────────
  { id: 'automations.view',    label: 'View Automations',    description: 'See automations',               category: 'Automations', dangerLevel: 'safe' },
  { id: 'automations.manage',  label: 'Manage Automations',  description: 'Create/edit/delete automations', category: 'Automations', dangerLevel: 'moderate' },

  // ── Billing ──────────────────────────────────────────────
  { id: 'billing.view',        label: 'View Billing',        description: 'See subscription info',         category: 'Billing', dangerLevel: 'safe' },
  { id: 'billing.manage',      label: 'Manage Billing',      description: 'Change plan, billing details',  category: 'Billing', dangerLevel: 'danger' },

  // ── Tickets ──────────────────────────────────────────────
  { id: 'tickets.view',        label: 'View Tickets',        description: 'Access helpdesk tickets',       category: 'Service', dangerLevel: 'safe' },
  { id: 'tickets.manage',      label: 'Manage Tickets',      description: 'Reply/resolve tickets',         category: 'Service', dangerLevel: 'moderate' },

  // ── Quotes ──────────────────────────────────────────────
  { id: 'quotes.view',         label: 'View Quotes',         description: 'Access quotes & proposals',     category: 'Sales',   dangerLevel: 'safe' },
  { id: 'quotes.manage',       label: 'Manage Quotes',        description: 'Create/edit/send quotes',       category: 'Sales',   dangerLevel: 'moderate' },

  // ── Invoices ──────────────────────────────────────────────
  { id: 'invoices.view',        label: 'View Invoices',       description: 'Access invoices & billing',       category: 'Sales',   dangerLevel: 'safe' },
  { id: 'invoices.create',      label: 'Create Invoices',     description: 'Create new invoices',            category: 'Sales',   dangerLevel: 'moderate' },
  { id: 'invoices.edit',        label: 'Edit Invoices',       description: 'Edit/update invoices',           category: 'Sales',   dangerLevel: 'moderate' },
  { id: 'invoices.delete',      label: 'Delete Invoices',     description: 'Remove invoices permanently',  category: 'Sales',   dangerLevel: 'danger' },
  { id: 'invoices.send',        label: 'Send Invoices',      description: 'Send invoices to clients',      category: 'Sales',   dangerLevel: 'moderate' },

  // ── Orders ────────────────────────────────────────────────
  { id: 'orders.view',          label: 'View Orders',         description: 'Access orders & shipments',     category: 'Sales',   dangerLevel: 'safe' },
  { id: 'orders.create',        label: 'Create Orders',      description: 'Create new orders',             category: 'Sales',   dangerLevel: 'moderate' },
  { id: 'orders.edit',          label: 'Edit Orders',         description: 'Edit/update orders',           category: 'Sales',   dangerLevel: 'moderate' },
  { id: 'orders.delete',        label: 'Delete Orders',       description: 'Remove orders permanently',    category: 'Sales',   dangerLevel: 'danger' },

  // ── Contracts ─────────────────────────────────────────────
  { id: 'contracts.view',       label: 'View Contracts',      description: 'Access contracts & agreements', category: 'Sales',   dangerLevel: 'safe' },
  { id: 'contracts.create',     label: 'Create Contracts',   description: 'Create new contracts',          category: 'Sales',   dangerLevel: 'moderate' },
  { id: 'contracts.edit',        label: 'Edit Contracts',     description: 'Edit/update contracts',        category: 'Sales',   dangerLevel: 'moderate' },
  { id: 'contracts.delete',     label: 'Delete Contracts',   description: 'Remove contracts permanently', category: 'Sales',   dangerLevel: 'danger' },
  { id: 'contracts.sign',       label: 'Sign Contracts',     description: 'Digitally sign contracts',     category: 'Sales',   dangerLevel: 'danger' },

  // ── Subscriptions ─────────────────────────────────────────
  { id: 'subscriptions.view',   label: 'View Subscriptions',  description: 'Access subscriptions',          category: 'Sales',   dangerLevel: 'safe' },
  { id: 'subscriptions.manage',label: 'Manage Subscriptions',description: 'Create/manage subscriptions', category: 'Sales',   dangerLevel: 'moderate' },

  // ── Segments ──────────────────────────────────────────────
  { id: 'segments.view',       label: 'View Segments',       description: 'Access contact segments',       category: 'Marketing', dangerLevel: 'safe' },
  { id: 'segments.manage',     label: 'Manage Segments',     description: 'Create/edit segments',          category: 'Marketing', dangerLevel: 'moderate' },
];

export const PERMISSION_CATEGORIES = [...new Set(PERMISSIONS.map(p => p.category))];

// ── Default permission sets per role ─────────────────────────
export const DEFAULT_ROLE_PERMISSIONS: Record<string, Record<string, boolean>> = {
  admin: Object.fromEntries(PERMISSIONS.map(p => [p.id, true])),
  manager: Object.fromEntries(PERMISSIONS.filter(p =>
    p.dangerLevel !== 'danger' ||
    ['contacts.delete', 'companies.delete', 'invoices.delete', 'orders.delete', 'contracts.delete', 'contracts.sign', 'billing.manage'].includes(p.id) === false
  ).map(p => [p.id, p.dangerLevel !== 'danger'])),
  sales_rep: {
    'contacts.create': true, 'contacts.edit': true, 'contacts.view_all': false,
    'leads.view': true, 'leads.create': true, 'leads.edit': true, 'leads.view_all': false,
    'deals.view': true, 'deals.create': true, 'deals.edit': true, 'deals.view_all': false, 'deals.view_value': true,
    'tasks.create': true, 'tasks.edit': true,
    'companies.create': true, 'companies.edit': true,
    'quotes.view': true, 'quotes.manage': true,
    'invoices.view': true, 'invoices.create': true,
    'orders.view': true, 'orders.create': true,
    'contracts.view': true, 'contracts.create': true,
    'subscriptions.view': true,
    'team.view': true, 'reports.view': false,
  },
  viewer: Object.fromEntries(PERMISSIONS.map(p => [p.id, p.id.endsWith('.view') || p.id.endsWith('.view_all')])),
};

// ── Check if a permissions object allows a given permission ──
export function checkPermission(permissions: Record<string, boolean>, permission: string): boolean {
  if (permissions['all'] === true) return true;
  return permissions[permission] === true;
}

// ── Get permissions diff between two roles ────────────────────
export function getPermissionsDiff(base: Record<string, boolean>, override: Record<string, boolean>) {
  const added: string[] = [];
  const removed: string[] = [];
  for (const perm of PERMISSIONS.map(p => p.id)) {
    const baseHas = checkPermission(base, perm);
    const overrideHas = checkPermission(override, perm);
    if (!baseHas && overrideHas) added.push(perm);
    if (baseHas && !overrideHas) removed.push(perm);
  }
  return { added, removed };
}
