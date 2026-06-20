import { db } from '@/drizzle/db';
import { contacts, companies, deals } from '@/drizzle/schema/crm';
import { tenants, users } from '@/drizzle/schema/core';
import { eq } from 'drizzle-orm';
import { chat } from './gateway';

export type SummarizeEntityType = 'contact' | 'deal' | 'company';

export interface SummarizeResult {
  summary: string;
  provider: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  fallbacksUsed: number;
  activityId: string | null;
}

interface EntityContext {
  type: string;
  id: string;
  label: string;
  details: Record<string, unknown>;
}

async function fetchEntityContext(
  tenantId: string,
  entityType: SummarizeEntityType,
  entityId: string,
): Promise<EntityContext | null> {
  switch (entityType) {
    case 'contact': {
      const [c] = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
          phone: contacts.phone,
          jobTitle: contacts.jobTitle,
          lifecycleStage: contacts.lifecycleStage,
          leadStatus: contacts.leadStatus,
          notes: contacts.notes,
          companyId: contacts.companyId,
          assignedTo: contacts.assignedTo,
          createdAt: contacts.createdAt,
          updatedAt: contacts.updatedAt,
        })
        .from(contacts)
        .where(eq(contacts.id, entityId))
        .limit(1);
      if (!c || c.length === 0) return null;
      const contact = (Array.isArray(c) ? c[0] : c) as typeof c;
      let companyName: string | undefined;
      if (contact.companyId) {
        const [co] = await db
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, contact.companyId))
          .limit(1);
        if (co) companyName = co.name;
      }
      return {
        type: 'contact',
        id: contact.id,
        label: `${contact.firstName} ${contact.lastName ?? ''}`.trim(),
        details: {
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          phone: contact.phone,
          jobTitle: contact.jobTitle,
          lifecycleStage: contact.lifecycleStage,
          leadStatus: contact.leadStatus,
          notes: contact.notes,
          company: companyName,
          createdAt: contact.createdAt,
          updatedAt: contact.updatedAt,
        },
      };
    }
    case 'deal': {
      const [d] = await db
        .select({
          id: deals.id,
          title: deals.title,
          amount: deals.amount,
          stageId: deals.stageId,
          status: deals.status,
          closeDate: deals.closeDate,
          contactId: deals.contactId,
          companyId: deals.companyId,
          notes: deals.notes,
          createdAt: deals.createdAt,
          updatedAt: deals.updatedAt,
        })
        .from(deals)
        .where(eq(deals.id, entityId))
        .limit(1);
      if (!d || d.length === 0) return null;
      const deal = (Array.isArray(d) ? d[0] : d) as typeof d;
      let contactName: string | undefined;
      let companyName: string | undefined;
      if (deal.contactId) {
        const [c] = await db
          .select({ firstName: contacts.firstName, lastName: contacts.lastName })
          .from(contacts)
          .where(eq(contacts.id, deal.contactId))
          .limit(1);
        if (c) contactName = `${c.firstName} ${c.lastName ?? ''}`.trim();
      }
      if (deal.companyId) {
        const [co] = await db
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, deal.companyId))
          .limit(1);
        if (co) companyName = co.name;
      }
      return {
        type: 'deal',
        id: deal.id,
        label: deal.title ?? 'Untitled deal',
        details: {
          title: deal.title,
          amount: deal.amount,
          stageId: deal.stageId,
          status: deal.status,
          closeDate: deal.closeDate,
          contact: contactName,
          company: companyName,
          notes: deal.notes,
          createdAt: deal.createdAt,
          updatedAt: deal.updatedAt,
        },
      };
    }
    case 'company': {
      const [co] = await db
        .select({
          id: companies.id,
          name: companies.name,
          industry: companies.industry,
          website: companies.website,
          domain: companies.domain,
          description: companies.description,
          companySize: companies.companySize,
          annualRevenue: companies.annualRevenue,
          phone: companies.phone,
          city: companies.city,
          country: companies.country,
          notes: companies.notes,
          tags: companies.tags,
          createdAt: companies.createdAt,
          updatedAt: companies.updatedAt,
        })
        .from(companies)
        .where(eq(companies.id, entityId))
        .limit(1);
      if (!co || co.length === 0) return null;
      const company = (Array.isArray(co) ? co[0] : co) as typeof co;
      return {
        type: 'company',
        id: company.id,
        label: company.name,
        details: {
          name: company.name,
          industry: company.industry,
          website: company.website,
          domain: company.domain,
          description: company.description,
          companySize: company.companySize,
          annualRevenue: company.annualRevenue,
          phone: company.phone,
          city: company.city,
          country: company.country,
          notes: company.notes,
          tags: company.tags,
          createdAt: company.createdAt,
          updatedAt: company.updatedAt,
        },
      };
    }
  }
}

async function getTenant(tenantId: string) {
  const [t] = await db
    .select({ id: tenants.id, name: tenants.name, primaryColor: tenants.primaryColor })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return t ?? null;
}

async function getUser(userId: string) {
  const [u] = await db
    .select({ id: users.id, name: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u ?? null;
}

function buildPrompt(entity: EntityContext, tenantName: string, customInstructions?: string): string {
  const lines: string[] = [
    `You are a CRM assistant at ${tenantName}. Generate a concise TL;DR summary of the following ${entity.type} record.`,
    '',
    `Record type: ${entity.type}`,
    `Record label: ${entity.label}`,
    '',
    'Details:',
  ];

  for (const [key, value] of Object.entries(entity.details)) {
    if (value !== null && value !== undefined && value !== '') {
      if (key === 'notes' && typeof value === 'string' && value.length > 500) {
        lines.push(`  ${key}: ${(value as string).slice(0, 500)}...`);
      } else {
        lines.push(`  ${key}: ${value}`);
      }
    }
  }

  if (customInstructions) {
    lines.push('', `Additional instructions: ${customInstructions}`);
  }

  return lines.join('\n');
}

export async function summarizeEntity(
  tenantId: string,
  userId: string,
  entityType: SummarizeEntityType,
  entityId: string,
  customInstructions?: string,
): Promise<SummarizeResult> {
  const entity = await fetchEntityContext(tenantId, entityType, entityId);
  if (!entity) {
    throw new Error(`${entityType} not found`);
  }

  const tenant = await getTenant(tenantId);
  const tenantName = tenant?.name ?? 'the company';
  const user = await getUser(userId);

  const userCtx = user ? ` (requested by ${user.name})` : '';

  const systemPrompt = `You are a CRM assistant at ${tenantName}. Generate a concise TL;DR summary of the given record. Cover: what the record is about, current status, key details, and what to do next. Keep it under 150 words. Output plain text with short paragraphs.${userCtx}`;

  const userPrompt = buildPrompt(entity, tenantName, customInstructions);

  const resp = await chat({
    tenantId,
    userId,
    action: 'summarize',
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    entityType,
    entityId,
    temperature: 0.3,
    max_tokens: 500,
  });

  return {
    summary: resp.text,
    provider: resp.provider,
    model: resp.model,
    tokensUsed: resp.tokensIn + resp.tokensOut,
    latencyMs: resp.latencyMs,
    fallbacksUsed: resp.fallbacksUsed,
    activityId: resp.activityId,
  };
}
