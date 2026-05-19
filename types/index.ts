// ── Auth / Users ───────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  timezone: string;
  is_super_admin: boolean;
  last_tenant_id: string | null;
  default_tenant_id: string | null;
  email_verified: boolean;
  totp_enabled: boolean;
  totp_secret: string | null;
  oauth_provider: string | null;
  oauth_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── Plans ──────────────────────────────────────────────────────
export interface Plan {
  id: string;
  name: string;
  price_monthly: number;
  price_yearly: number;
  max_users: number;
  max_contacts: number;
  max_deals: number;
  max_storage_gb: number;
  max_automations: number;
  max_forms: number;
  max_api_calls_day: number;
  features: string[];
  is_active: boolean;
  sort_order: number;
}

// ── Tenants / Organizations ────────────────────────────────────
export type TenantStatus = 'trialing' | 'active' | 'suspended' | 'cancelled' | 'past_due' | 'trial_expired';

export interface TenantSettings {
  timezone: string;
  date_format: string;
  currency: string;
  language: string;
  allow_signups: boolean;
  require_2fa: boolean;
  email_notifications: boolean;
  data_retention_days: number;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan_id: string;
  owner_id: string | null;
  logo_url: string | null;
  primary_color: string;
  favicon_url: string | null;
  custom_domain: string | null;
  subdomain: string | null;
  status: TenantStatus;
  trial_ends_at: string | null;
  subscription_id: string | null;
  billing_email: string | null;
  current_users: number;
  current_contacts: number;
  current_deals: number;
  storage_used_bytes: number;
  settings: TenantSettings;
  industry: string | null;
  company_size: string | null;
  country: string | null;
  created_at: string;
  updated_at: string;
  plan?: Plan;
}

// ── Three-Level Hierarchy ──────────────────────────────────────
// Level 1: Super Admin  — owns the platform, sees all orgs
// Level 2: Org Admin    — owns ONE org, controls everything in it
// Level 3: Org User     — employee/member, restricted by role

export type SystemRoleSlug = 'admin' | 'manager' | 'sales_rep' | 'viewer' | 'lead_manager';

export interface Role {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_system: boolean;
  permissions: Record<string, boolean>;
  sort_order: number;
  created_at: string;
}

export type MemberStatus = 'invited' | 'active' | 'suspended' | 'removed';

export interface TenantMember {
  id: string;
  tenant_id: string;
  user_id: string;
  role_id: string | null;
  role_slug: string;
  status: MemberStatus;
  invited_by: string | null;
  joined_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  user?: Pick<User, 'id' | 'email' | 'full_name' | 'avatar_url'>;
  role?: Role;
}

// ── Auth Context ───────────────────────────────────────────────
export interface AuthContext {
  userId: string;
  tenantId: string;
  roleSlug: string;
  permissions: Record<string, boolean>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

export interface TenantContext {
  userId: string;
  tenantId: string;
  roleSlug: string;
  permissions: Record<string, boolean>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  tenant: Pick<Tenant, 'id' | 'name' | 'plan_id' | 'primary_color' | 'settings' | 'current_users' | 'current_contacts' | 'status' | 'trial_ends_at'>;
  plan: Pick<Plan, 'id' | 'name' | 'max_users' | 'max_contacts' | 'max_deals' | 'max_automations' | 'features'>;
}

// ── Module System ──────────────────────────────────────────────
export type ModuleStatus = 'available' | 'installed' | 'active' | 'disabled' | 'error';

export interface ModuleManifest {
  id: string;           // unique slug: 'automation-pro', 'whatsapp-bot', 'ai-assistant'
  name: string;
  version: string;
  description: string;
  author: string;
  category: 'messaging' | 'automation' | 'ai' | 'analytics' | 'integration' | 'utility';
  icon: string;         // emoji or URL
  minCrmVersion: string;
  pricing: Record<string, { enabled: boolean; price?: number; [key: string]: any }>;
  features: string[];
  permissions: string[];       // permissions this module needs
  database?: { migrations: string[] };
  api?: { routes: string[] };
  pages?: string[];
  webhooks?: string[];          // events this module emits
  settings_schema?: ModuleSettingField[];
}

export interface ModuleSettingField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select' | 'boolean' | 'number';
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
}

export interface TenantModule {
  id: string;
  tenant_id: string;
  module_id: string;
  status: ModuleStatus;
  settings: Record<string, any>;
  installed_at: string;
  installed_by: string;
  last_used_at: string | null;
  error_message: string | null;
}

// ── Automation ─────────────────────────────────────────────────
export type TriggerType =
  | 'contact.created' | 'contact.updated' | 'contact.status_changed'
  | 'deal.created' | 'deal.stage_changed' | 'deal.won' | 'deal.lost'
  | 'task.created' | 'task.completed' | 'task.overdue'
  | 'company.created'
  | 'form.submitted' | 'tag.added'
  | 'schedule.daily' | 'schedule.weekly';

export type ActionType =
  | 'send_email' | 'send_whatsapp' | 'send_sms'
  | 'create_task' | 'create_deal' | 'update_contact'
  | 'assign_contact' | 'add_tag' | 'remove_tag'
  | 'send_notification' | 'fire_webhook'
  | 'add_to_sequence' | 'wait';

export interface AutomationTrigger {
  type: TriggerType;
  conditions?: { field: string; operator: string; value: any }[];
}

export interface AutomationAction {
  type: ActionType;
  config: Record<string, any>;
  delay_minutes?: number;
}

export interface Automation {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  run_count: number;
  last_run_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ── Integrations / Webhooks ───────────────────────────────────
export interface Integration {
  id: string;
  tenant_id: string;
  user_id: string;
  type: string;
  name: string;
  config: Record<string, any>;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  tenant_id: string;
  integration_id: string;
  event: string;
  payload: Record<string, any>;
  status: 'pending' | 'delivered' | 'failed';
  response_code: number | null;
  response_body: string | null;
  attempts: number;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

// ── CRM Entities ───────────────────────────────────────────────
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted' | 'lost';
export type DealStage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type TaskPriority = 'low' | 'medium' | 'high';
export type ActivityType = 'note' | 'call' | 'email' | 'meeting' | 'task' | 'deal_update' | 'contact_created';
export type MeetingStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';

export interface Company {
  id: string; tenant_id: string; created_by: string | null;
  name: string; industry: string | null; website: string | null;
  phone: string | null; notes: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string; updated_at: string;
  contact_count?: number;
}

export interface Contact {
  id: string; tenant_id: string; created_by: string | null; assigned_to: string | null;
  company_id: string | null; first_name: string; last_name: string;
  email: string | null; phone: string | null; city: string | null; country: string | null;
  tags: string[]; notes: string | null; lead_source: string | null;
  lead_status: LeadStatus; score: number; lifecycle_stage: string | null;
  custom_fields: Record<string, unknown>; is_archived: boolean;
  do_not_contact: boolean;
  created_at: string; updated_at: string;
  company_name?: string; assigned_name?: string;
}

export interface Deal {
  id: string; tenant_id: string; created_by: string | null; assigned_to: string | null;
  contact_id: string | null; company_id: string | null;
  title: string; value: number; stage: DealStage; probability: number;
  close_date: string | null; notes: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string; updated_at: string;
  first_name?: string; last_name?: string; company_name?: string; assigned_name?: string;
}

export interface Task {
  id: string; tenant_id: string; created_by: string | null; assigned_to: string | null;
  contact_id: string | null; deal_id: string | null;
  title: string; description: string | null; due_date: string | null;
  priority: TaskPriority; completed: boolean; completed_at: string | null;
  created_at: string; updated_at: string;
  first_name?: string; last_name?: string; deal_title?: string; assignee_name?: string;
}

export interface Activity {
  id: string; tenant_id: string; user_id: string | null;
  contact_id: string | null; deal_id: string | null;
  type: ActivityType; description: string; metadata: Record<string, unknown> | null;
  created_at: string; full_name?: string;
}

export interface Meeting {
  id: string; tenant_id: string; user_id: string;
  contact_id: string | null; deal_id: string | null;
  title: string; description: string | null;
  start_time: string; end_time: string;
  location: string | null; meeting_url: string | null;
  status: MeetingStatus; notes: string | null;
  created_at: string; updated_at: string;
  contact_name?: string;
}

export interface CustomFieldDef {
  id: string;
  tenant_id: string;
  entity_type: 'contact' | 'deal' | 'company' | 'lead' | 'task';
  field_key: string;
  field_label: string;
  field_type: string;
  field_options: string[] | null;
  is_required: boolean;
  is_searchable: boolean;
  is_calculated: boolean;
  formula: string | null;
  default_value: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string; tenant_id: string; user_id: string;
  type: string; title: string; body: string | null;
  link: string | null; is_read: boolean;
  metadata: Record<string, unknown>; created_at: string;
}

export interface AuditLog {
  id: string; tenant_id: string | null; user_id: string | null;
  action: string; resource_type: string; resource_id: string | null;
  old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null;
  ip_address: string | null; metadata: Record<string, unknown>;
  created_at: string;
}

export interface ApiKey {
  id: string; tenant_id: string; user_id: string;
  name: string; key_hash: string; key_prefix: string;
  scopes: string[]; is_active: boolean;
  last_used_at: string | null; expires_at: string | null; created_at: string;
}

// ── API Response types ─────────────────────────────────────────
export interface PaginatedResponse<T> { data: T[]; total: number; offset: number; limit: number; }
export interface SingleResponse<T> { data: T; }
export interface ErrorResponse { error: string; code?: string; }
