/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2819 — `lib/api/schemas.ts` and `lib/api/schemas/<domain>.ts` each defined 135
 * of the same schemas, so the rules a payload met depended on which path the route
 * imported. #1883 was filed for exactly that and fixed two of the copies
 * (`verify2faSchema` / `disable2faSchema` were dead *and* wrong here — their field
 * was `token` while the route and the client used `totp_code`), then stopped. The
 * residue stayed: all 93 routes importing `@/lib/api/schemas` validated against the
 * monolith's copy while the domain file sat unused next to it.
 *
 * After the collapse the domain module holds the one definition and the monolith
 * re-exports it, which makes two things provable here instead of in review:
 *
 *  1. the two import paths hand out the *same object*, not two equal-looking ones;
 *  2. no name is *defined* on both sides any more — including the `…Input` type
 *     aliases, which have no runtime presence, so (1) cannot see them.
 *
 * Both are generic over the domain modules, so re-adding a second copy of anything
 * in either place fails here rather than in whichever route picked the other path.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as barrel from '@/lib/api/schemas';
import * as admin from '@/lib/api/schemas/admin';
import * as ai from '@/lib/api/schemas/ai';
import * as auth from '@/lib/api/schemas/auth';
import * as automation from '@/lib/api/schemas/automation';
import * as billing from '@/lib/api/schemas/billing';
import * as common from '@/lib/api/schemas/common';
import * as crm from '@/lib/api/schemas/crm';
import * as importExport from '@/lib/api/schemas/import-export';
import * as projects from '@/lib/api/schemas/projects';
import * as pub from '@/lib/api/schemas/public';
import * as superadmin from '@/lib/api/schemas/superadmin';
import * as support from '@/lib/api/schemas/support';
import * as user from '@/lib/api/schemas/user';

const DOMAINS: Record<string, Record<string, unknown>> = {
  admin, ai, auth, automation, billing, common, crm,
  'import-export': importExport, projects, public: pub, superadmin, support, user,
};

const SCHEMAS_TS = fileURLToPath(new URL('../../lib/api/schemas.ts', import.meta.url));
const DOMAIN_DIR = fileURLToPath(new URL('../../lib/api/schemas', import.meta.url));

/** Every name `lib/api/schemas.ts` exported at origin/main, before the collapse (#2819).
 *  A name may only leave this list the way #1883 removed the two dead 2FA copies: on purpose.
 */
const BEFORE_NAMES: readonly string[] = [
  'AiAssistantInput', 'AssignContactInput', 'BackupConfigInput', 'BulkDeleteInput',
  'BulkUpdateInput', 'ChangePasswordInput', 'CheckoutSessionInput', 'ConvertLeadInput',
  'CreateApiKeyInput', 'CreateAutomationInput', 'CreateBackupInput', 'CreateCompanyInput',
  'CreateContactInput', 'CreateContractInput', 'CreateCustomFieldInput', 'CreateDealInput',
  'CreateDealStageInput', 'CreateEmailTemplateInput', 'CreateFollowUpInput', 'CreateFormInput',
  'CreateIntegrationInput', 'CreateInvoiceInput', 'CreateKbArticleInput',
  'CreateKbCategoryInput', 'CreateLeadInput', 'CreateMeetingInput', 'CreateMilestoneInput',
  'CreateNoteInput', 'CreateOrderInput', 'CreatePipelineInput', 'CreatePlanInput',
  'CreateProductInput', 'CreateProjectInput', 'CreateQuoteInput', 'CreateRoleInput',
  'CreateScheduledReportInput', 'CreateSequenceInput', 'CreateServiceInput',
  'CreateSubscriptionInput', 'CreateTaskInput', 'CreateTenantInput', 'CreateWebhookInput',
  'CreateWorkflowInput', 'EmailWarmupConfigInput', 'ExportInput', 'ImportInput',
  'InviteMemberInput', 'IpWhitelistInput', 'LEAD_STATUS_VALUES', 'LinkTaskInput',
  'MergeContactInput', 'OnboardingStepInput', 'PublicFormSubmitInput',
  'PublicLeadCaptureInput', 'SearchInput', 'SendWhatsAppInput', 'TestEmailInput',
  'TriggerWorkflowInput', 'UpdateCompanyInput', 'UpdateContactInput', 'UpdateCustomFieldInput',
  'UpdateDealInput', 'UpdateFollowUpInput', 'UpdateInvoiceInput', 'UpdateLeadInput',
  'UpdateMemberInput', 'UpdatePlanInput', 'UpdateProfileInput', 'UpdateProjectInput',
  'UpdateTaskInput', 'UpdateTelegramInput', 'UpdateTenantInput', 'UpdateTenantSettingsInput',
  'aiAssistantSchema', 'assignContactSchema', 'atRiskRuleSchema', 'backupConfigSchema',
  'bulkDeleteSchema', 'bulkUpdateSchema', 'changePasswordSchema', 'checkoutSessionSchema',
  'companyQuerySchema', 'contactQuerySchema', 'convertLeadSchema', 'createApiKeySchema',
  'createAutomationSchema', 'createBackupSchema', 'createCompanySchema', 'createContactSchema',
  'createContractSchema', 'createCustomFieldSchema', 'createDealSchema',
  'createDealStageSchema', 'createEmailTemplateSchema', 'createFollowUpSchema',
  'createFormSchema', 'createIntegrationSchema', 'createInvoiceSchema',
  'createKbArticleSchema', 'createKbCategorySchema', 'createLeadSchema', 'createMeetingSchema',
  'createMilestoneSchema', 'createNoteSchema', 'createOrderSchema', 'createPipelineSchema',
  'createPlanSchema', 'createProductSchema', 'createProjectSchema', 'createQuoteSchema',
  'createRoleSchema', 'createScheduledReportSchema', 'createSequenceSchema',
  'createServiceSchema', 'createSubscriptionSchema', 'createTaskSchema', 'createTenantSchema',
  'createWebhookFieldMappingSchema', 'createWebhookSchema', 'createWorkflowSchema',
  'dealQuerySchema', 'emailWarmupConfigSchema', 'exportSchema', 'followUpQuerySchema',
  'forgotPasswordSchema', 'importSchema', 'inviteMemberSchema', 'invoiceQuerySchema',
  'ipWhitelistSchema', 'leadQuerySchema', 'linkTaskSchema', 'loginSchema',
  'mergeContactSchema', 'onboardingStepSchema', 'platformSettingsSchema',
  'preferencesPatchSchema', 'publicFormSubmitSchema', 'publicLeadCaptureSchema',
  'resetPasswordSchema', 'searchSchema', 'sendWhatsAppSchema', 'setup2faSchema',
  'signupSchema', 'tagActionSchema', 'taskQuerySchema', 'testEmailSchema', 'ticketReplySchema',
  'triggerWorkflowSchema', 'updateApiKeySchema', 'updateAtRiskRuleSchema',
  'updateAutomationSchema', 'updateCompanySchema', 'updateContactSchema',
  'updateContractSchema', 'updateCustomFieldSchema', 'updateDealSchema',
  'updateDealStageSchema', 'updateEmailTemplateSchema', 'updateFollowUpSchema',
  'updateFormSchema', 'updateIntegrationSchema', 'updateInvoiceSchema',
  'updateKbArticleSchema', 'updateKbCategorySchema', 'updateLeadSchema', 'updateMeetingSchema',
  'updateMemberSchema', 'updateNoteSchema', 'updateNotificationPrefsSchema',
  'updateOrderSchema', 'updatePipelineSchema', 'updatePlanSchema', 'updateProductSchema',
  'updateProfileSchema', 'updateProjectSchema', 'updateQuoteSchema', 'updateRoleSchema',
  'updateScheduledReportSchema', 'updateSequenceSchema', 'updateServiceSchema',
  'updateSubscriptionSchema', 'updateSuperadminUserSchema', 'updateTaskSchema',
  'updateTelegramSchema', 'updateTenantSchema', 'updateTenantSettingsSchema',
  'updateWebhookFieldMappingSchema', 'updateWebhookSchema', 'updateWorkflowSchema',
  'upsertPicklistSchema'
];

/** `export const|type|interface|enum|class|function X` — a definition, not a re-export. */
function definedNames(src: string): Set<string> {
  return new Set(
    [...src.matchAll(/^export\s+(?:const|type|interface|enum|class|function)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]),
  );
}

/** Names brought in by an `export { … }` / `export type { … }` block. */
function reExportedNames(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/^export(?: type)? \{([^}]*)\}/gm)) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim().replace(/^type /, '').split(' as ')[0].trim();
      if (n) out.add(n);
    }
  }
  return out;
}

const barrelSrc = readFileSync(SCHEMAS_TS, 'utf8');
const barrelDefs = definedNames(barrelSrc);
const domainDefs = new Map<string, string[]>();
for (const file of readdirSync(DOMAIN_DIR)) {
  if (!file.endsWith('.ts') || file === 'index.ts') continue;
  for (const name of definedNames(readFileSync(`${DOMAIN_DIR}/${file}`, 'utf8'))) {
    domainDefs.set(name, [...(domainDefs.get(name) ?? []), file]);
  }
}

describe('one definition per request schema (#2819)', () => {
  it('no name is defined on both sides any more', () => {
    const both = [...barrelDefs].filter((n) => domainDefs.has(n));
    expect(both, `defined in lib/api/schemas.ts AND a domain module: ${both.join(', ')}`).toEqual([]);
  });

  it('no schema is defined twice across the domain modules themselves', () => {
    const dupes = [...domainDefs.entries()].filter(([, files]) => files.length > 1);
    expect(dupes.map(([n]) => n)).toEqual([]);
  });

  it('the two import paths resolve the same object, not two look-alikes', () => {
    const checked: string[] = [];
    const diverging: string[] = [];
    for (const [mod, domainExports] of Object.entries(DOMAINS)) {
      for (const [name, value] of Object.entries(domainExports)) {
        const viaBarrel = (barrel as Record<string, unknown>)[name];
        if (viaBarrel === undefined) continue; // domain-only export, never surfaced by the barrel
        checked.push(`${mod}/${name}`);
        if (viaBarrel !== value) diverging.push(`${mod} > ${name}`);
      }
    }
    expect(diverging, `same name, different schema object: ${diverging.join(', ')}`).toEqual([]);
    // 85 of the collapsed names are runtime values. Without this, a guard that
    // silently compared nothing would pass both assertions above just as happily.
    expect(checked.length, `expected >= 85 shared runtime values, saw ${checked.length}`).toBeGreaterThanOrEqual(85);
  });
});

describe('the barrel did not lose an export (#2819)', () => {
  it('still reaches all 190 names it exported at origin/main', () => {
    const reachable = new Set([...barrelDefs, ...reExportedNames(barrelSrc)]);
    const missing = BEFORE_NAMES.filter((n) => !reachable.has(n));
    expect(missing, `no longer reachable from @/lib/api/schemas: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps the two dead 2FA copies #1883 removed out for good', () => {
    // They were deleted because they were dead AND wrong; a re-export must not
    // quietly bring them back.
    expect(barrelDefs.has('verify2faSchema')).toBe(false);
    expect(barrelDefs.has('disable2faSchema')).toBe(false);
  });
});

describe('the collapse changed no validation rule', () => {
  type Parser = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };

  it('parses a real invoice identically through either path', () => {
    const payload = {
      contact_id: null,
      line_items: [{ description: 'x', quantity: '1', unit_price: '2.50' }],
    };
    const viaBarrel = (barrel as Record<string, Parser>).createInvoiceSchema.safeParse(payload);
    const viaDomain = (billing as Record<string, Parser>).createInvoiceSchema.safeParse(payload);
    expect(viaBarrel.success).toBe(true);
    expect(viaDomain.success).toBe(viaBarrel.success);
    expect(viaDomain.data).toEqual(viaBarrel.data);
  });

  it('still rejects what the monolith rejected: an invoice with no line items', () => {
    const bad = { contact_id: null, line_items: [] };
    expect((barrel as Record<string, Parser>).createInvoiceSchema.safeParse(bad).success).toBe(false);
    expect((billing as Record<string, Parser>).createInvoiceSchema.safeParse(bad).success).toBe(false);
  });

  it('is the same object for the schemas the live routes validate with', () => {
    // app/api/tenant/invoices, /workflows and /superadmin/tenants each import one
    // of these from the barrel; the domain module is now the only definition.
    expect((barrel as Record<string, unknown>).createInvoiceSchema)
      .toBe((billing as Record<string, unknown>).createInvoiceSchema);
    expect((barrel as Record<string, unknown>).createWorkflowSchema)
      .toBe((automation as Record<string, unknown>).createWorkflowSchema);
    expect((barrel as Record<string, unknown>).createTenantSchema)
      .toBe((superadmin as Record<string, unknown>).createTenantSchema);
  });
});
