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
  /** Pricing model: 'per_user' means price is multiplied by number of users */
  pricingModel: 'per_user' | 'flat';
  /** Per-user monthly price (the actual billing unit) */
  pricePerUserMonthly: number;
  /** Per-user yearly price (the actual billing unit) */
  pricePerUserYearly: number;
  /** Kept for backward compat - set to 0 since actual billing is per-user */
  priceMonthly: number;
  /** Kept for backward compat - set to 0 since actual billing is per-user */
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
  /** Monthly AI token budget. -1 means unlimited. */
  maxAiTokensMonthly: number;
  features: string[];
  sortOrder: number;
}

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    id: 'free',
    name: 'Free',
    slug: 'free',
    description: 'For individuals getting started - $0/user/mo',
    pricingModel: 'per_user',
    pricePerUserMonthly: 0,
    pricePerUserYearly: 0,
    priceMonthly: 0,
    priceYearly: 0,
    maxUsers: 2,
    maxContacts: 500,
    maxDeals: 100,
    maxStorageGb: 1,
    maxAutomations: 0,
    maxForms: 1,
    maxApiCallsDay: 500,
    maxAiTokensMonthly: 10000,
    features: ['contacts', 'deals', 'tasks', 'calendar', 'reports'],
    sortOrder: 0,
  },
  {
    id: 'basic',
    name: 'Basic',
    slug: 'basic',
    description: 'For small teams - $12/user/mo',
    pricingModel: 'per_user',
    pricePerUserMonthly: 12,
    pricePerUserYearly: 120,
    priceMonthly: 0,
    priceYearly: 0,
    maxUsers: 10,
    maxContacts: 5000,
    maxDeals: 1000,
    maxStorageGb: 5,
    maxAutomations: 10,
    maxForms: 5,
    maxApiCallsDay: 5000,
    maxAiTokensMonthly: 100000,
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
    description: 'For growing businesses - $29/user/mo',
    pricingModel: 'per_user',
    pricePerUserMonthly: 29,
    pricePerUserYearly: 290,
    priceMonthly: 0,
    priceYearly: 0,
    maxUsers: 25,
    maxContacts: 25000,
    maxDeals: 5000,
    maxStorageGb: 25,
    maxAutomations: 50,
    maxForms: 20,
    maxApiCallsDay: 25000,
    maxAiTokensMonthly: 500000,
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
    description: 'For large organizations with advanced needs - $49/user/mo',
    pricingModel: 'per_user',
    pricePerUserMonthly: 49,
    pricePerUserYearly: 490,
    priceMonthly: 0,
    priceYearly: 0,
    maxUsers: -1,
    maxContacts: -1,
    maxDeals: -1,
    maxStorageGb: 100,
    maxAutomations: -1,
    maxForms: -1,
    maxApiCallsDay: -1,
    maxAiTokensMonthly: -1,
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
