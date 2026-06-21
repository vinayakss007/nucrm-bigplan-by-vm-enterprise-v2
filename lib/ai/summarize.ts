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
      const rows = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
          phone: contacts.phone,
          jobTitle: contacts.jobTitle,
          lifecycleStage: contacts.lifecycleStage,
          leadStatus: contacts.leadStatus,
          companyId: contacts.companyId,
          assignedTo: contacts.assignedTo,
          createdAt: contacts.createdAt,
          updatedAt: contacts.updatedAt,
        })
        .from(contacts)
        .where(eq(contacts.id, entityId))
        .limit(1);
      if (!rows || rows.length === 0) return null;
      const c = rows[0]!;
      let companyName: string | undefined;
      if (c.companyId) {
        const [co] = await db
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, c.companyId))
          .limit(1);
        if (co) companyName = co.name;
      }
      return {
        type: 'contact',
        id: c.id,
        label: `${c.firstName} ${c.lastName ?? ''}`.trim(),
        details: {
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone: c.phone,
          jobTitle: c.jobTitle,
          lifecycleStage: c.lifecycleStage,
          leadStatus: c.leadStatus,
          company: companyName,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        },
      };
    }
    case 'deal': {
      const rows = await db
        .select({
          id: deals.id,
          title: deals.title,
          amount: deals.amount,
          stageId: deals.stageId,
          closeDate: deals.closeDate,
          contactId: deals.contactId,
          companyId: deals.companyId,
          createdAt: deals.createdAt,
          updatedAt: deals.updatedAt,
        })
        .from(deals)
        .where(eq(deals.id, entityId))
        .limit(1);
      if (!rows || rows.length === 0) return null;
      const d = rows[0]!;
      let contactName: string | undefined;
      let companyName: string | undefined;
      if (d.contactId) {
        const cRows = await db
          .select({ firstName: contacts.firstName, lastName: contacts.lastName })
          .from(contacts)
          .where(eq(contacts.id, d.contactId))
          .limit(1);
        if (cRows && cRows.length > 0) contactName = `${cRows[0]!.firstName} ${cRows[0]!.lastName ?? ''}`.trim();
      }
      if (d.companyId) {
        const coRows = await db
          .select({ name: companies.name })
          .from(companies)
          .where(eq(companies.id, d.companyId))
          .limit(1);
        if (coRows && coRows.length > 0) companyName = coRows[0]!.name;
      }
      return {
        type: 'deal',
        id: d.id,
        label: d.title ?? 'Untitled deal',
        details: {
          title: d.title,
          amount: d.amount,
          stageId: d.stageId,
          closeDate: d.closeDate,
          contact: contactName,
          company: companyName,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        },
      };
    }
    case 'company': {
      const rows = await db
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
          createdAt: companies.createdAt,
          updatedAt: companies.updatedAt,
        })
        .from(companies)
        .where(eq(companies.id, entityId))
        .limit(1);
      if (!rows || rows.length === 0) return null;
      const co = rows[0]!;
      return {
        type: 'company',
        id: co.id,
        label: co.name,
        details: {
          name: co.name,
          industry: co.industry,
          website: co.website,
          domain: co.domain,
          description: co.description,
          companySize: co.companySize,
          annualRevenue: co.annualRevenue,
          phone: co.phone,
          city: co.city,
          country: co.country,
          createdAt: co.createdAt,
          updatedAt: co.updatedAt,
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
