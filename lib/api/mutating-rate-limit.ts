/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Rate limit configuration for mutating (PATCH/DELETE) endpoints.
 * Each entity has separate limits for updates and deletes.
 * DELETE limits are stricter than PATCH limits.
 */
const MUTATING_LIMITS: Record<string, { post: number; patch: number; delete: number }> = {
  // Core CRM entities — high volume
  contacts: { post: 30, patch: 60, delete: 15 },
  deals: { post: 30, patch: 60, delete: 15 },
  companies: { post: 30, patch: 60, delete: 15 },
  leads: { post: 30, patch: 60, delete: 15 },
  tickets: { post: 30, patch: 60, delete: 15 },
  tasks: { post: 30, patch: 60, delete: 15 },
  // Communication
  meetings: { post: 15, patch: 30, delete: 10 },
  calls: { post: 15, patch: 30, delete: 10 },
  followUps: { post: 15, patch: 30, delete: 10 },
  // Documents & files
  documents: { post: 15, patch: 30, delete: 10 },
  quotes: { post: 15, patch: 30, delete: 10 },
  invoices: { post: 15, patch: 30, delete: 10 },
  contracts: { post: 15, patch: 30, delete: 10 },
  orders: { post: 15, patch: 30, delete: 10 },
  // Config & admin
  roles: { post: 5, patch: 10, delete: 5 },
  forms: { post: 10, patch: 20, delete: 10 },
  sequences: { post: 10, patch: 20, delete: 10 },
  emailTemplates: { post: 10, patch: 20, delete: 10 },
  webhooks: { post: 5, patch: 10, delete: 5 },
  workflows: { post: 5, patch: 10, delete: 5 },
  automations: { post: 5, patch: 10, delete: 5 },
  views: { post: 10, patch: 20, delete: 10 },
  reports: { post: 10, patch: 20, delete: 10 },
  // AI & automation
  aiTemplates: { post: 5, patch: 10, delete: 5 },
  kbArticles: { post: 10, patch: 20, delete: 10 },
  kbCategories: { post: 10, patch: 20, delete: 10 },
  integrations: { post: 5, patch: 10, delete: 5 },
  ssoProviders: { post: 3, patch: 5, delete: 3 },
  // Projects
  projects: { post: 15, patch: 30, delete: 10 },
  milestones: { post: 10, patch: 20, delete: 10 },
  // Misc
  cannedResponses: { post: 10, patch: 20, delete: 10 },
  assignments: { post: 15, patch: 30, delete: 15 },
  services: { post: 10, patch: 20, delete: 10 },
  plugins: { post: 5, patch: 10, delete: 5 },
  trash: { post: 5, patch: 10, delete: 5 },
  portalClients: { post: 5, patch: 10, delete: 5 },
  subscriptions: { post: 5, patch: 10, delete: 5 },
  smsTemplates: { post: 5, patch: 10, delete: 5 },
  taxRates: { post: 5, patch: 10, delete: 5 },
  territories: { post: 5, patch: 10, delete: 5 },
  modules: { post: 3, patch: 5, delete: 3 },
  hierarchy: { post: 5, patch: 10, delete: 5 },
  customFields: { post: 10, patch: 10, delete: 5 },
  webhookFieldMappings: { post: 10, patch: 10, delete: 5 },
  notifications: { post: 5, patch: 10, delete: 5 },
  // Bulk operations — strict limits (expensive, high-impact)
  bulk: { post: 5, patch: 5, delete: 5 },
  // Billing & admin — strict limits (financial, irreversible)
  billing: { post: 5, patch: 5, delete: 5 },
  backup: { post: 3, patch: 3, delete: 3 },
  calendarSync: { post: 10, patch: 10, delete: 5 },
  branding: { post: 10, patch: 10, delete: 5 },
  pipelines: { post: 10, patch: 10, delete: 5 },
  activities: { post: 30, patch: 30, delete: 10 },
  apiKeys: { post: 5, patch: 5, delete: 5 },
  bulkTransfer: { post: 3, patch: 3, delete: 3 },
};

const DEFAULT_LIMITS = { post: 15, patch: 30, delete: 10 };

/**
 * Apply rate limiting to a mutating (PATCH/DELETE) route handler.
 * Returns null if allowed, or a NextResponse 429 if rate limited.
 *
 * Usage in route handlers:
 *   const limited = await rateLimitMutating(request, 'contacts', 'patch');
 *   if (limited) return limited;
 */
export async function rateLimitMutating(
  request: Request,
  entity: string,
  method: 'post' | 'patch' | 'put' | 'delete'
): Promise<import('next/server').NextResponse | null> {
  const limits = MUTATING_LIMITS[entity] || DEFAULT_LIMITS;
  const bucket = method === 'put' ? 'patch' : method;
  const action = `${entity}_${method}`;
  return checkRateLimit(request, { action, max: limits[bucket], windowMinutes: 1 });
}
