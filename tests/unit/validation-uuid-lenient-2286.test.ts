/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Issue #2286 — Zod v4's `z.string().uuid()` enforces RFC 9562 version/variant
 * nibbles, so it rejected the app's OWN seeded IDs (`50000000-0000-0000-0000-
 * 000000000001` stage ids, `60000000-…` company ids, …): GET handed them out,
 * POST/PATCH refused them with 400 "Invalid UUID".
 *
 * Evidence captured while reproducing (zod 4.6.5):
 *   z.string().uuid().safeParse('50000000-0000-0000-0000-000000000001') -> INVALID_UUID
 *   z.string().uuid().safeParse('50000000-0000-4000-0000-000000000001') -> INVALID_UUID (variant nibble 0)
 *   z.string().uuid().safeParse('50000000-0000-0000-8000-000000000001') -> INVALID_UUID (version nibble 0)
 * i.e. every seed id (groups 3 AND 4 are literal `0000`) violates BOTH the
 * version nibble (must be 1-8) and the variant nibble (must be 8/9/a/b).
 *
 * The fix routes every entity-ID field through `uuidIdSchema`
 * (`z.string().guid(...)`, Zod v4's built-in version-lenient 8-4-4-4-12 hex
 * shape check, matching what the Postgres `uuid` column and FKs accept), while
 * still rejecting garbage outright.
 */
import { describe, it, expect } from 'vitest';
import { uuidIdSchema, uuidIdSchemaWith } from '@/lib/validation/uuid';
import {
  createDealSchema,
  updateDealSchema,
  createContactSchema,
  contactQuerySchema,
  createCompanySchema,
  createTaskSchema,
  convertLeadSchema,
  bulkDeleteSchema,
  assignContactSchema,
  createDealStageSchema,
} from '@/lib/api/schemas';
import { IDS } from '@/scripts/seed/ids';

// ── IDs the live API hands back (exact shapes from scripts/seed/ids.ts) ──
const APP_GENERATED_IDS: Array<[string, string]> = [
  ['seed pipeline stage (5-prefix)', IDS.stages.lead], // 50000000-0000-0000-0000-000000000001
  ['seed pipeline stage 2', IDS.stages.closedWon],
  ['seed company (6-prefix)', IDS.companies[0]!], // 60000000-0000-0000-0000-000000000001
  ['seed company #16', IDS.companies[15]!], // 60000000-0000-0000-0000-000000000010 (issue repro)
  ['seed pipeline (4-prefix)', IDS.pipelines.sales],
  ['seed tenant (1-prefix)', IDS.tenant],
  ['seed user (2-prefix)', IDS.users.admin],
  ['seed role (3-prefix)', IDS.roles.superAdmin],
  ['seed contact (7-prefix)', IDS.contacts[0]!],
  ['seed lead (71-prefix)', IDS.leads[0]!],
  ['seed deal (8-prefix)', IDS.deals[0]!],
  ['seed task (81-prefix)', IDS.tasks[0]!],
  ['seed ticket (82-prefix)', IDS.tickets[0]!],
  ['seed quote (84-prefix)', IDS.quotes[0]!],
  ['seed form (85-prefix)', IDS.forms[0]!],
  ['seed webhook (87-prefix)', IDS.webhooks.wh1],
  ['nil uuid', '00000000-0000-0000-0000-000000000000'],
  ['RFC-4122 v1 uuid', '06fb09bb-4c1d-11ef-9a4a-0242ac110004'],
  ['RFC-4122 v4 uuid (gen_random_uuid)', 'b6287559-54c2-4394-a19f-0e8c8f2d1a3b'],
  ['RFC-9562 v6 uuid', '068e2e28-0d3e-6abc-b123-456789abcdef'],
  ['RFC-9562 v7 uuid', '019a7fc4-3b1e-7d2a-9f3c-12ab34cd56ef'],
  ['uppercase hex uuid', 'B6287559-54C2-4394-A19F-0E8C8F2D1A3B'],
];

const GARBAGE: Array<[string, string]> = [
  ['empty string', ''],
  ['space', ' '],
  ['plain word', 'not-a-uuid'],
  ['too short', '50000000-0000-0000-0000-00000000000'],
  ['too long', '50000000-0000-0000-0000-000000000001234'],
  ['non-hex characters', 'gggggggg-0000-0000-0000-000000000001'],
  ['wrong group lengths', '500000000-0000-0000-0000-00000000000'],
  ['missing dashes', '50000000000000000000000000000001'],
  ['path traversal', '../../../../etc/passwd'],
  ['sql fragment 1', "1' OR '1'='1"],
  ['sql fragment 2', '00000000-0000-0000-0000-000000000000; DROP TABLE deals; --'],
  ['script tag', '<script>alert(1)</script>'],
  ['uuid with braces', '{50000000-0000-0000-0000-000000000001}'],
  ['null byte injection', '50000000-0000-0000-0000-00000000000%00'],
];

describe('#2286 uuidIdSchema — accepts every ID shape the app itself generates', () => {
  it.each(APP_GENERATED_IDS)('accepts %s', (_label, id) => {
    expect(uuidIdSchema.safeParse(id).success, `${id} should be accepted`).toBe(true);
  });

  it('demonstrates the pre-fix regression: strict z.string().uuid() rejected these ids', async () => {
    const { z } = await import('zod');
    // Root-cause proof: both the version nibble (group 3 first digit) and the
    // variant nibble (group 4 first digit) independently trip Zod's RFC check.
    expect(z.string().uuid().safeParse(IDS.stages.lead).success).toBe(false); // 0000-0000 → both nibbles 0
    expect(z.string().uuid().safeParse('50000000-0000-4000-0000-000000000001').success).toBe(false); // variant nibble 0
    expect(z.string().uuid().safeParse('50000000-0000-0000-8000-000000000001').success).toBe(false); // version nibble 0
    // The lenient shared schema accepts all three.
    expect(uuidIdSchema.safeParse('50000000-0000-4000-0000-000000000001').success).toBe(true);
    expect(uuidIdSchema.safeParse('50000000-0000-0000-8000-000000000001').success).toBe(true);
  });
});

describe('#2286 uuidIdSchema — still rejects garbage', () => {
  it.each(GARBAGE)('rejects %s', (_label, value) => {
    expect(uuidIdSchema.safeParse(value).success, `${value} should be rejected`).toBe(false);
  });

  it('keeps the exact legacy error message ("Invalid UUID") in 400 details', () => {
    const res = uuidIdSchema.safeParse('bogus-id');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]!.message).toBe('Invalid UUID');
  });

  it('rejects non-string JSON values (null, number, object)', () => {
    // `.nullable()` variants stay explicit; the base schema is string-only.
    expect(uuidIdSchema.safeParse(123).success).toBe(false);
    expect(uuidIdSchema.safeParse({}).success).toBe(false);
  });
});

describe('#2286 entity-reference schemas accept echoed app-generated ids', () => {
  it('createDealSchema: POST /api/tenant/deals with issue-repro payload passes validation', () => {
    const parsed = createDealSchema.safeParse({
      title: 'probe-deal2',
      stage_id: '50000000-0000-0000-0000-000000000001',
      pipeline_id: '40000000-0000-0000-0000-000000000001',
    });
    expect(parsed.success).toBe(true);
  });

  it('updateDealSchema: PATCH existing deal to another seeded stage passes validation', () => {
    const parsed = updateDealSchema.safeParse({
      stage_id: '50000000-0000-0000-0000-000000000002',
    });
    expect(parsed.success).toBe(true);
  });

  it('createContactSchema: company_id echo from GET /api/tenant/companies passes validation', () => {
    const parsed = createContactSchema.safeParse({
      first_name: 'probe',
      last_name: 'co-ref',
      email: 'probe-coref@example.com',
      company_id: '60000000-0000-0000-0000-000000000010',
    });
    expect(parsed.success).toBe(true);
  });

  it('createCompanySchema / createTaskSchema: assigned_to + refs accept seed user/task ids', () => {
    expect(createCompanySchema.safeParse({ name: 'ACME', assigned_to: IDS.users.rep1 }).success).toBe(true);
    expect(createTaskSchema.safeParse({
      title: 'call',
      contact_id: IDS.contacts[0],
      deal_id: IDS.deals[0],
      company_id: IDS.companies[0],
      assigned_to: IDS.users.admin,
    }).success).toBe(true);
  });

  it('query filters (GET ?company_id=…) accept seeded ids too (read/write symmetry)', () => {
    expect(contactQuerySchema.safeParse({ company_id: IDS.companies[0] }).success).toBe(true);
  });

  it('convertLeadSchema: deal_stage/pipeline_id/assigned_to accept seeded ids', () => {
    expect(convertLeadSchema.safeParse({
      create_deal: true,
      deal_stage: IDS.stages.qualified,
      pipeline_id: IDS.pipelines.sales,
      assigned_to: IDS.users.manager,
    }).success).toBe(true);
  });

  it('bulk schemas: ids arrays accept seeded ids and still reject garbage', () => {
    expect(bulkDeleteSchema.safeParse({ ids: [IDS.deals[0], IDS.stages.lead] }).success).toBe(true);
    expect(bulkDeleteSchema.safeParse({ ids: ['../../etc/passwd'] }).success).toBe(false);
    expect(assignContactSchema.safeParse({
      contact_ids: IDS.contacts.slice(0, 2),
      assign_to: IDS.users.rep2,
    }).success).toBe(true);
  });

  it('createDealStageSchema: pipeline_id reference accepts the seeded pipeline', () => {
    expect(createDealStageSchema.safeParse({
      pipeline_id: IDS.pipelines.enterprise,
      name: 'Discovery',
    }).success).toBe(true);
  });

  it('schemas still enforce the other fields (leniency is uuid-shape only)', () => {
    expect(createDealSchema.safeParse({
      title: 'x',
      stage_id: "1' OR '1'='1",
    }).success).toBe(false);
    expect(createDealStageSchema.safeParse({
      pipeline_id: 'garbage',
      name: 'x',
    }).success).toBe(false);
  });
});

describe('#2286 uuidIdSchemaWith preserves per-route custom error wording', () => {
  it('carries the custom message on rejection', () => {
    const res = uuidIdSchemaWith('tenant_id is required').safeParse('nope');
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]!.message).toBe('tenant_id is required');
  });

  it('accepts app-generated ids just like the base schema', () => {
    expect(uuidIdSchemaWith('x').safeParse(IDS.tenant).success).toBe(true);
  });
});
