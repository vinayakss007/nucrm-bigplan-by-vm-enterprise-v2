/**
 * Auto-Draft helpers
 *
 * Context hydration + template interpolation for `/tenant/ai/draft`.
 *
 * The template author can put `{{contact.first_name}}`, `{{deal.title}}`,
 * `{{deal.amount}}`, `{{company.name}}`, `{{user.name}}`, `{{tenant.name}}`
 * etc. into either the system prompt or the user prompt. We pull the
 * relevant rows once, build a flat key/value bag, then run a regex
 * substitution.
 *
 * A handful of seed templates are exposed so that tenants who never open
 * the admin page still see useful options out of the box.
 */
import { db } from '@/drizzle/db';
import { contacts, companies, deals } from '@/drizzle/schema/crm';
import { tenants, users } from '@/drizzle/schema/core';
import { eq } from 'drizzle-orm';

export type EntityType = 'contact' | 'deal' | 'company' | 'lead' | 'ticket';

export interface DraftContext {
  tenant?:  Record<string, unknown>;
  user?:    Record<string, unknown>;
  contact?: Record<string, unknown>;
  deal?:    Record<string, unknown>;
  company?: Record<string, unknown>;
}

/** Pull just enough context to power a draft. Tenant-scoped; never returns rows belonging to another tenant. */
export async function hydrateDraftContext(
  tenantId: string,
  userId: string,
  ref: { entityType: EntityType; entityId: string },
): Promise<DraftContext> {
  const ctx: DraftContext = {};

  // Tenant + user — always available
  const [t] = await db
    .select({ id: tenants.id, name: tenants.name, primary_color: tenants.primaryColor })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (t) ctx.tenant = t;

  const [u] = await db
    .select({ id: users.id, name: users.fullName, email: users.email })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (u) ctx.user = u;

  switch (ref.entityType) {
    case 'contact': {
      const [c] = await db
        .select({
          id: contacts.id,
          first_name: contacts.firstName,
          last_name: contacts.lastName,
          email: contacts.email,
          lead_status: contacts.leadStatus,
          lifecycle_stage: contacts.lifecycleStage,
          notes: contacts.notes,
          company_id: contacts.companyId,
        })
        .from(contacts)
        .where(eq(contacts.id, ref.entityId))
        .limit(1);
      if (c && (await belongsToTenant('contact', c.id, tenantId))) {
        ctx.contact = c;
        if (c.company_id) {
          const [co] = await db
            .select({ id: companies.id, name: companies.name, industry: companies.industry, website: companies.website })
            .from(companies).where(eq(companies.id, c.company_id)).limit(1);
          if (co) ctx.company = co;
        }
      }
      break;
    }
    case 'deal': {
      const [d] = await db
        .select({
          id: deals.id,
          title: deals.title,
          amount: deals.amount,
          stage_id: deals.stageId,
          contact_id: deals.contactId,
          company_id: deals.companyId,
          close_date: deals.closeDate,
        })
        .from(deals)
        .where(eq(deals.id, ref.entityId))
        .limit(1);
      if (d && (await belongsToTenant('deal', d.id, tenantId))) {
        ctx.deal = d;
        if (d.contact_id) {
          const [c] = await db
            .select({
              id: contacts.id,
              first_name: contacts.firstName,
              last_name: contacts.lastName,
              email: contacts.email,
            })
            .from(contacts).where(eq(contacts.id, d.contact_id)).limit(1);
          if (c) ctx.contact = c;
        }
        if (d.company_id) {
          const [co] = await db
            .select({ id: companies.id, name: companies.name, industry: companies.industry })
            .from(companies).where(eq(companies.id, d.company_id)).limit(1);
          if (co) ctx.company = co;
        }
      }
      break;
    }
    case 'company': {
      const [co] = await db
        .select({ id: companies.id, name: companies.name, industry: companies.industry, website: companies.website })
        .from(companies)
        .where(eq(companies.id, ref.entityId))
        .limit(1);
      if (co && (await belongsToTenant('company', co.id, tenantId))) {
        ctx.company = co;
      }
      break;
    }
    default:
      // Other entity types (lead, ticket) can be added here later — for now
      // we just skip hydration so the draft still runs with tenant + user context.
      break;
  }

  return ctx;
}

/** Cheap row-belongs-to-tenant guard — used only as a defence-in-depth check. */
async function belongsToTenant(kind: 'contact' | 'deal' | 'company', id: string, tenantId: string): Promise<boolean> {
  if (kind === 'contact') {
    const [r] = await db.select({ tenantId: contacts.tenantId }).from(contacts).where(eq(contacts.id, id)).limit(1);
    return r?.tenantId === tenantId;
  }
  if (kind === 'deal') {
    const [r] = await db.select({ tenantId: deals.tenantId }).from(deals).where(eq(deals.id, id)).limit(1);
    return r?.tenantId === tenantId;
  }
  const [r] = await db.select({ tenantId: companies.tenantId }).from(companies).where(eq(companies.id, id)).limit(1);
  return r?.tenantId === tenantId;
}

/**
 * Replace {{a.b}} tokens in a template against a hydrated context.
 * Missing values become an empty string (so a half-populated template
 * doesn't dump literal `undefined` into the buyer's email).
 */
export function interpolate(template: string, ctx: DraftContext): string {
  return template.replace(/{{\s*([a-z_]+)\.([a-z_]+)\s*}}/gi, (_match, scope: string, key: string) => {
    const bag = (ctx as unknown as Record<string, Record<string, unknown> | undefined>)[scope.toLowerCase()];
    if (!bag) return '';
    const value = bag[key.toLowerCase()];
    if (value === null || value === undefined) return '';
    return String(value);
  });
}

/**
 * Built-in starter templates. The admin can clone these into the
 * tenants' own ai_draft_templates rows, but they're also returned by
 * the picker if the tenant has zero rows so the surface is never empty.
 */
export const SEED_DRAFT_TEMPLATES: Array<{
  slug: string;
  name: string;
  description: string;
  kind: 'email' | 'note' | 'reply' | 'call_prep';
  entityTypes: string;
  tone: string;
  defaultSubject?: string;
  systemPrompt: string;
  userPrompt: string;
}> = [
  {
    slug: 'follow-up-after-meeting',
    name: 'Follow-up after meeting',
    description: 'Recaps the meeting, restates next steps, asks a small commitment.',
    kind: 'email',
    entityTypes: 'contact,deal',
    tone: 'professional',
    defaultSubject: 'Following up on our conversation',
    systemPrompt:
      'You are a sales rep writing a short follow-up email after a meeting. Keep it under 120 words. Open with the buyer\'s first name, restate the most important thing they said, propose a single concrete next step, and end with one question that\'s easy to say yes to. No fluff.',
    userPrompt:
      'Buyer: {{contact.first_name}} {{contact.last_name}} at {{company.name}}.\nDeal: {{deal.title}} (${{deal.amount}}).\nWrite the email body only, no subject line.',
  },
  {
    slug: 'reply-stalled-deal',
    name: 'Reply to a stalled deal',
    description: 'Re-opens a thread that has gone cold, offers two specific times.',
    kind: 'email',
    entityTypes: 'contact,deal',
    tone: 'warm',
    defaultSubject: 'Quick check-in',
    systemPrompt:
      'You are a sales rep restarting a stalled deal thread. The buyer has not responded in 7+ days. Be empathetic, do NOT shame them. Offer two specific time windows for a 15-minute call. Keep it under 90 words.',
    userPrompt:
      'Buyer: {{contact.first_name}} {{contact.last_name}}. Deal: {{deal.title}}. Write the email body.',
  },
  {
    slug: 'cold-outbound-personalised',
    name: 'Cold outbound (personalised)',
    description: 'First-touch outbound that uses the buyer\'s industry and a relevant hook.',
    kind: 'email',
    entityTypes: 'contact',
    tone: 'casual',
    defaultSubject: 'A specific idea for {{company.name}}',
    systemPrompt:
      'Write a 60-90 word cold outbound email. Lead with one concrete observation about the buyer\'s industry that\'s specific, NOT generic. Make one short ask: 15 minutes next week. Avoid superlatives.',
    userPrompt:
      'Buyer: {{contact.first_name}} at {{company.name}} ({{company.industry}}). Goal: book a 15-minute intro call.',
  },
  {
    slug: 'call-prep-notes',
    name: 'Call-prep notes',
    description: 'Pre-call brief so the rep walks in with the right talking points.',
    kind: 'call_prep',
    entityTypes: 'contact,deal',
    tone: 'concise',
    systemPrompt:
      'You are an SDR coach. Produce 5 bullet talking points for a call. Each bullet must be specific, observation-based, and end with a single question. Output bullets only — no preamble.',
    userPrompt:
      'Contact: {{contact.first_name}} {{contact.last_name}} at {{company.name}} ({{company.industry}}).\nDeal: {{deal.title}}.\nNotes so far: {{contact.notes}}',
  },
  {
    slug: 'meeting-summary',
    name: 'Internal meeting summary',
    description: 'Summarise notes into a clean recap your team can scan.',
    kind: 'note',
    entityTypes: 'contact,deal',
    tone: 'concise',
    systemPrompt:
      'Summarise the supplied raw meeting notes into: (1) what was agreed, (2) blockers, (3) next steps with owners. Output bullets only.',
    userPrompt:
      'Notes: {{contact.notes}}\nDeal: {{deal.title}}',
  },
];
