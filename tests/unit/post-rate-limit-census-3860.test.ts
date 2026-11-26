/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const TENANT_API = path.join(ROOT, 'app', 'api', 'tenant');

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

function unthrottledPostRoutes(): string[] {
  return routeFiles(TENANT_API)
    .filter((file) => {
      const src = readFileSync(file, 'utf8');
      return src.includes('export const POST')
        && !/rateLimitMutating\(|checkRateLimit\(/.test(src);
    })
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .sort();
}

/** Shrink-only debt ledger from #3860 (measured 2026-11-25). */
const BASELINE = [
  'app/api/tenant/2fa/disable/route.ts',
  'app/api/tenant/2fa/setup/route.ts',
  'app/api/tenant/admin/ai-templates/route.ts',
  'app/api/tenant/admin/at-risk/route.ts',
  'app/api/tenant/admin/lead-scoring/recompute/route.ts',
  'app/api/tenant/admin/tags/route.ts',
  'app/api/tenant/analytics/forecast/route.ts',
  'app/api/tenant/analytics/scheduled-reports/route.ts',
  'app/api/tenant/billing/dunning/retry/route.ts',
  'app/api/tenant/billing/dunning/route.ts',
  'app/api/tenant/billing/modules/route.ts',
  'app/api/tenant/billing/portal/route.ts',
  'app/api/tenant/billing/razorpay/route.ts',
  'app/api/tenant/billing/stripe/route.ts',
  'app/api/tenant/chat/[sessionId]/messages/route.ts',
  'app/api/tenant/chat/route.ts',
  'app/api/tenant/compliance/gdpr/route.ts',
  'app/api/tenant/compliance/soc2/route.ts',
  'app/api/tenant/contacts/[id]/lifecycle/route.ts',
  'app/api/tenant/contacts/[id]/timeline/route.ts',
  'app/api/tenant/currency/route.ts',
  'app/api/tenant/custom-entities/route.ts',
  'app/api/tenant/documents/upload-url/route.ts',
  'app/api/tenant/esignature/route.ts',
  'app/api/tenant/field-sales/checkin/route.ts',
  'app/api/tenant/field-sales/checkout/route.ts',
  'app/api/tenant/forms/route.ts',
  'app/api/tenant/industry-templates/route.ts',
  'app/api/tenant/integrations/telegram/test/route.ts',
  'app/api/tenant/invoices/[id]/send/route.ts',
  'app/api/tenant/lead-warming/campaigns/route.ts',
  'app/api/tenant/lead-warming/events/route.ts',
  'app/api/tenant/lead-warming/replies/route.ts',
  'app/api/tenant/leads/[id]/assign/route.ts',
  'app/api/tenant/leads/[id]/convert/route.ts',
  'app/api/tenant/modules/setup/route.ts',
  'app/api/tenant/offers/[quoteId]/cancel/route.ts',
  'app/api/tenant/offers/[quoteId]/send/route.ts',
  'app/api/tenant/onboarding/complete/route.ts',
  'app/api/tenant/partners/[id]/deals/route.ts',
  'app/api/tenant/partners/route.ts',
  'app/api/tenant/permissions/approvals/route.ts',
  'app/api/tenant/permissions/check/route.ts',
  'app/api/tenant/permissions/fields/route.ts',
  'app/api/tenant/plugin-engine/actions/route.ts',
  'app/api/tenant/plugins/[id]/execute/route.ts',
  'app/api/tenant/plugins/[id]/test/route.ts',
  'app/api/tenant/plugins/route.ts',
  'app/api/tenant/quotes/[id]/convert-to-invoice/route.ts',
  'app/api/tenant/rbac/approval-rules/route.ts',
  'app/api/tenant/rbac/record-permissions/route.ts',
  'app/api/tenant/reports/run/route.ts',
  'app/api/tenant/sms/route.ts',
  'app/api/tenant/tax/calculate/route.ts',
  'app/api/tenant/tickets/[id]/replies/route.ts',
  'app/api/tenant/trash/auto-cleanup/route.ts',
  'app/api/tenant/webhooks/dlq/route.ts',
  'app/api/tenant/whatsapp/send/route.ts',
  'app/api/tenant/whatsapp/templates/route.ts',
  'app/api/tenant/workflows/[id]/run/route.ts',
  'app/api/tenant/workflows/[id]/test/route.ts',
] as const;

describe('tenant POST rate-limit census (#3860)', () => {
  it('never admits a new unthrottled POST route (the ledger may only shrink)', () => {
    const unthrottled = unthrottledPostRoutes();
    const added = unthrottled.filter((file) => !(BASELINE as readonly string[]).includes(file));
    expect(added).toEqual([]);
  });

  it('counts the sensitive routes fixed in this PR as throttled', () => {
    const unthrottled = unthrottledPostRoutes();
    for (const file of [
      'app/api/tenant/2fa/verify/route.ts',
      'app/api/tenant/invite/send/route.ts',
      'app/api/tenant/custom-entities/[id]/rows/route.ts',
      'app/api/tenant/forms/[id]/analytics/route.ts',
    ]) {
      expect(unthrottled).not.toContain(file);
    }
  });
});
