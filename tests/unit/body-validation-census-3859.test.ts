/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function routeFiles(dir: string): string[] {
  if (!existsSync(path.join(ROOT, dir))) return [];
  const base = path.join(ROOT, dir);
  return readdirSync(base, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) return routeFiles(path.join(dir, entry.name));
    return entry.name === 'route.ts' ? [full] : [];
  });
}

function unvalidatedPostRoutes(): string[] {
  return [...routeFiles('app/api/tenant'), ...routeFiles('app/api/portal')]
    .filter((file) => {
      const src = readFileSync(file, 'utf8');
      return src.includes('export const POST')
        && /readJsonBody\(|await (?:request|req)\.json\(\)/.test(src)
        && !/validateBody\(|withValidation\(|validateQuery\(/.test(src);
    })
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .sort();
}

/** Shrink-only debt ledger from #3859 (measured 2026-11-26). */
const BASELINE = [
  'app/api/tenant/admin/bulk-transfer/route.ts',
  'app/api/tenant/ai/draft/route.ts',
  'app/api/tenant/ai/email-draft/route.ts',
  'app/api/tenant/ai/insights/route.ts',
  'app/api/tenant/ai/score/route.ts',
  'app/api/tenant/ai/sentiment/route.ts',
  'app/api/tenant/analytics/scheduled-reports/route.ts',
  'app/api/tenant/assignment-rules/route.ts',
  'app/api/tenant/calendar-sync/route.ts',
  'app/api/tenant/calendar-sync/sync/route.ts',
  'app/api/tenant/canned-responses/route.ts',
  'app/api/tenant/companies/bulk/route.ts',
  'app/api/tenant/companies/import/route.ts',
  'app/api/tenant/compliance/gdpr/route.ts',
  'app/api/tenant/compliance/soc2/route.ts',
  'app/api/tenant/contacts/merge/route.ts',
  'app/api/tenant/contacts/scan/route.ts',
  'app/api/tenant/deals/bulk/route.ts',
  'app/api/tenant/documents/route.ts',
  'app/api/tenant/email/bulk/route.ts',
  'app/api/tenant/email/templates/bulk-send/route.ts',
  'app/api/tenant/esignature/route.ts',
  'app/api/tenant/export/route.ts',
  'app/api/tenant/forms/[id]/analytics/route.ts',
  'app/api/tenant/import/route.ts',
  'app/api/tenant/industry-templates/route.ts',
  'app/api/tenant/integrations/telegram/test/route.ts',
  'app/api/tenant/invoices/[id]/send/route.ts',
  'app/api/tenant/kb/articles/[id]/route.ts',
  'app/api/tenant/lead-warming/campaigns/route.ts',
  'app/api/tenant/lead-warming/events/route.ts',
  'app/api/tenant/lead-warming/replies/route.ts',
  'app/api/tenant/leads/bulk/route.ts',
  'app/api/tenant/modules/route.ts',
  'app/api/tenant/modules/setup/route.ts',
  'app/api/tenant/notes/bulk/route.ts',
  'app/api/tenant/offers/[quoteId]/send/route.ts',
  'app/api/tenant/onboarding/complete/route.ts',
  'app/api/tenant/partners/[id]/deals/route.ts',
  'app/api/tenant/plugin-engine/actions/route.ts',
  'app/api/tenant/plugin-engine/route.ts',
  'app/api/tenant/plugins/[id]/execute/route.ts',
  'app/api/tenant/plugins/route.ts',
  'app/api/tenant/quotes/[id]/convert-to-invoice/route.ts',
  'app/api/tenant/reports/[id]/route.ts',
  'app/api/tenant/reports/builder/route.ts',
  'app/api/tenant/reports/custom/route.ts',
  'app/api/tenant/reports/run/route.ts',
  'app/api/tenant/search/advanced/route.ts',
  'app/api/tenant/segments/[id]/enroll/route.ts',
  'app/api/tenant/segments/route.ts',
  'app/api/tenant/sla/route.ts',
  'app/api/tenant/sso/providers/route.ts',
  'app/api/tenant/tasks/bulk/route.ts',
  'app/api/tenant/teams/[id]/members/route.ts',
  'app/api/tenant/tickets/[id]/replies/route.ts',
  'app/api/tenant/tickets/bulk/route.ts',
  'app/api/tenant/views/route.ts',
  'app/api/tenant/webhooks/dlq/route.ts',
  'app/api/tenant/webhooks/retry/route.ts',
  'app/api/tenant/workspace/route.ts',
] as const;

describe('tenant mutation body-validation census (#3859)', () => {
  it('never admits a new unvalidated POST body', () => {
    const added = unvalidatedPostRoutes().filter((file) => !(BASELINE as readonly string[]).includes(file));
    expect(added).toEqual([]);
  });

  it('counts the four routes fixed here as validated', () => {
    const unvalidated = unvalidatedPostRoutes();
    for (const file of [
      'app/api/tenant/teams/route.ts',
      'app/api/tenant/tax/calculate/route.ts',
      'app/api/tenant/permissions/check/route.ts',
      'app/api/tenant/ai/summarize/route.ts',
    ]) {
      expect(unvalidated).not.toContain(file);
    }
  });
});
