/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Fallback rate-limit ceilings for mutating (POST/PATCH/PUT/DELETE) endpoints,
 * per minute, keyed by entity. Each has separate post/patch/delete buckets
 * (DELETE is kept tighter than PATCH).
 *
 * DESIGN — cost-tiered, NOT blanket (paid CRM usage must never trip these):
 *
 *   • A CRM is read/write-heavy by nature — reps create/update contacts, deals,
 *     tasks, notes and activities continuously. Regular CRUD is therefore
 *     LIBERAL: the ceiling exists only to blunt scripted scraping/DoS, not to
 *     throttle a busy human (or a normal bulk import feeding single-record
 *     writes). These apply to everyone, free and paid alike.
 *   • COSTLY / EXTERNAL / AUTH surfaces stay STRICT because each call has real
 *     money cost (AI, SMS, WhatsApp, e-sign, email sends, plugin execution,
 *     report/analytics runs, billing) or is a brute-force target (2FA, invite).
 *
 * These are only FALLBACKS. Actual limits resolve DB-first via
 * getRateLimit(planId, endpoint): a plan's `rateLimitConfig` (or the global
 * defaults) override these, and a configured value of 0 disables limiting for
 * that endpoint. Super admins / unlimited users bypass entirely. So a higher
 * plan can raise or remove any of these without a code change.
 */

// Tier presets (requests/min). Tune the tier, not 60 individual entities.
const LIBERAL = { post: 300, patch: 600, delete: 120 }; // regular CRM CRUD — effectively unlimited for humans
const STANDARD = { post: 120, patch: 240, delete: 60 };  // frequent but less hot objects
const CONFIG = { post: 60, patch: 60, delete: 30 };      // settings-ish, change occasionally
const SENSITIVE = { post: 15, patch: 20, delete: 10 };   // security/admin config
const COSTLY = { post: 20, patch: 20, delete: 10 };      // AI / expensive compute / external cost
const STRICT = { post: 5, patch: 5, delete: 5 };         // financial / auth / session-minting

const MUTATING_LIMITS: Record<string, { post: number; patch: number; delete: number }> = {
  // ── Regular CRM CRUD — LIBERAL (paid + free; abuse-ceiling only) ──────────
  contacts: LIBERAL,
  deals: LIBERAL,
  companies: LIBERAL,
  leads: LIBERAL,
  tickets: LIBERAL,
  tasks: LIBERAL,
  activities: LIBERAL,
  notifications: LIBERAL,

  // ── Communication & everyday objects — STANDARD ──────────────────────────
  meetings: STANDARD,
  calls: STANDARD,
  followUps: STANDARD,
  documents: STANDARD,
  quotes: STANDARD,
  invoices: STANDARD,
  contracts: STANDARD,
  orders: STANDARD,
  projects: STANDARD,
  milestones: STANDARD,
  cannedResponses: STANDARD,
  segments: STANDARD,
  assignments: STANDARD,
  services: STANDARD,
  kbArticles: STANDARD,
  kbCategories: STANDARD,
  customEntities: STANDARD,
  partners: STANDARD,
  leadWarming: STANDARD,
  fieldSales: STANDARD,

  // ── Config / low-frequency setup — CONFIG ─────────────────────────────────
  forms: CONFIG,
  sequences: CONFIG,
  emailTemplates: CONFIG,
  views: CONFIG,
  reports: CONFIG,
  pipelines: CONFIG,
  customFields: CONFIG,
  webhookFieldMappings: CONFIG,
  hierarchy: CONFIG,
  branding: CONFIG,
  calendarSync: CONFIG,
  currency: CONFIG,
  industryTemplates: CONFIG,
  settings: CONFIG,
  trash: CONFIG,
  portalClients: CONFIG,
  smsTemplates: CONFIG,
  taxRates: CONFIG,
  territories: CONFIG,
  plugins: CONFIG,

  // ── Security / privileged config — SENSITIVE ──────────────────────────────
  roles: SENSITIVE,
  webhooks: SENSITIVE,
  workflows: SENSITIVE,
  automations: SENSITIVE,
  integrations: SENSITIVE,
  aiTemplates: SENSITIVE,
  modules: SENSITIVE,
  apiKeys: SENSITIVE,
  permissions: SENSITIVE,
  compliance: SENSITIVE,

  // ── Costly compute / external cost — COSTLY (strict on purpose) ───────────
  chat: COSTLY,          // AI/LLM inference
  reportRun: COSTLY,     // heavy aggregation
  analytics: COSTLY,     // heavy aggregation / scheduled reports
  pluginExec: COSTLY,    // arbitrary server-side work
  tax: COSTLY,           // external tax calc
  documentsUpload: COSTLY,
  sms: COSTLY,           // per-message cost + spam surface
  whatsapp: COSTLY,      // per-message cost + spam surface
  esignature: COSTLY,    // per-envelope cost
  send: COSTLY,          // outbound email/document sends
  telegramTest: COSTLY,

  // ── Bulk / financial / auth / superadmin — STRICT ─────────────────────────
  bulk: STRICT,
  bulkTransfer: { post: 3, patch: 3, delete: 3 },
  backup: { post: 3, patch: 3, delete: 3 },
  billing: STRICT,
  subscriptions: STRICT,
  ssoProviders: { post: 3, patch: 5, delete: 3 },
  twoFactor: STRICT,     // TOTP brute-force surface
  invite: { post: 10, patch: 10, delete: 10 },
  onboarding: STRICT,
  impersonate: STRICT,   // session minting
  joinTenant: STRICT,
  selectiveRestore: { post: 3, patch: 3, delete: 3 },

  // ── Expensive data movement — STRICT (whole-dataset scans / writes) ───────
  export: { post: 10, patch: 10, delete: 10 },   // full-dataset export (per hour-ish load)
  import: { post: 10, patch: 10, delete: 10 },   // bulk ingest
  restore: { post: 3, patch: 3, delete: 3 },     // superadmin dataset restore

  // ── Everyday CRUD / config not covered above ──────────────────────────────
  products: STANDARD,              // catalog CRUD — normal data
  teams: CONFIG,                   // team/membership management
  userPreferences: LIBERAL,        // per-user UI prefs, saved constantly
  dashboardLayout: LIBERAL,        // drag/drop layout saves fire often
  portalConfig: CONFIG,
  slaPolicies: SENSITIVE,          // support policy config
  retentionPolicies: SENSITIVE,    // data-retention/compliance config
};

// Fallback for any entity not listed. Generous by default — this is a CRM, and
// an unlisted mutating route is far more likely to be a normal data write than
// an expensive/abusable one. Costly/auth surfaces are enumerated explicitly
// above, so the safe default is to lean permissive rather than throttle real work.
const DEFAULT_LIMITS = STANDARD;

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
