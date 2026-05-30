/**
 * Canonical Plan Definitions
 * ──────────────────────────
 * 4 standard plan tiers with complete feature matrices.
 * Used for seeding and as a single source of truth.
 */

export interface PlanDefinition {
  id: string;
  name: string;
  slug: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  maxUsers: number;
  maxContacts: number;
  maxDeals: number;
  // Note: maxStorageGb is declared as number here for convenience, but the DB column
  // is numeric(6,2). The seed endpoint converts this to string via .toString() before insert.
  maxStorageGb: number;
  maxAutomations: number;
  maxForms: number;
  maxApiCallsDay: number;
  features: string[];
  sortOrder: number;
}

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    slug: 'free',
    description: 'For individuals getting started',
    priceMonthly: 0,
    priceYearly: 0,
    maxUsers: 2,
    maxContacts: 500,
    maxDeals: 100,
    maxStorageGb: 1,
    maxAutomations: 0,
    maxForms: 1,
    maxApiCallsDay: 500,
    features: ['contacts', 'deals', 'tasks', 'calendar', 'reports'],
    sortOrder: 0,
  },
  {
    id: 'basic',
    name: 'Basic',
    slug: 'basic',
    description: 'For small teams',
    priceMonthly: 29,
    priceYearly: 290,
    maxUsers: 10,
    maxContacts: 5000,
    maxDeals: 1000,
    maxStorageGb: 5,
    maxAutomations: 10,
    maxForms: 5,
    maxApiCallsDay: 5000,
    features: [
      'contacts', 'deals', 'tasks', 'calendar', 'reports',
      'automations', 'forms', 'quotes', 'invoices', 'orders', 'products', 'custom_roles',
    ],
    sortOrder: 1,
  },
  {
    id: 'pro',
    name: 'Pro',
    slug: 'pro',
    description: 'For growing businesses',
    priceMonthly: 79,
    priceYearly: 790,
    maxUsers: 25,
    maxContacts: 25000,
    maxDeals: 5000,
    maxStorageGb: 25,
    maxAutomations: 50,
    maxForms: 20,
    maxApiCallsDay: 25000,
    features: [
      'contacts', 'deals', 'tasks', 'calendar', 'reports',
      'automations', 'forms', 'quotes', 'invoices', 'orders', 'products', 'custom_roles',
      'sequences', 'ai', 'api_access', 'contracts', 'subscriptions', 'audit_logs', 'dedicated_support',
    ],
    sortOrder: 2,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'For large organizations with advanced needs',
    priceMonthly: 199,
    priceYearly: 1990,
    maxUsers: -1,
    maxContacts: -1,
    maxDeals: -1,
    maxStorageGb: 100,
    maxAutomations: -1,
    maxForms: -1,
    maxApiCallsDay: -1,
    features: [
      'contacts', 'deals', 'tasks', 'calendar', 'reports',
      'automations', 'forms', 'quotes', 'invoices', 'orders', 'products', 'custom_roles',
      'sequences', 'ai', 'api_access', 'contracts', 'subscriptions', 'audit_logs', 'dedicated_support',
      'sso', 'custom_domain', 'advanced_security', 'white_label', 'priority_support', 'compliance', 'data_export',
    ],
    sortOrder: 3,
  },
];

/** Lookup map by plan ID */
export const PLAN_MAP: Record<string, PlanDefinition> = Object.fromEntries(
  PLAN_DEFINITIONS.map(p => [p.id, p])
);

/** All unique features across all plans */
export const ALL_PLAN_FEATURES = [...new Set(PLAN_DEFINITIONS.flatMap(p => p.features))];
