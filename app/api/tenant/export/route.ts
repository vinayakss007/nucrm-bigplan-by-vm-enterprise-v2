/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, deals, leads, tasks, activities } from '@/drizzle/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { escapeCSV } from '@/lib/export';

/**
 * POST /api/tenant/export
 * Exports tenant data as JSON or CSV format.
 *
 * Body: { entity: 'contacts'|'companies'|'deals'|'leads'|'tasks'|'activities', format?: 'json'|'csv' }
 * Returns the data immediately for small datasets.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await rateLimitMutating(request, 'export', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'settings.manage');
    if (deny) return deny;

    const body = await readJsonBody(request);
    const { entity, format = 'json' } = body as { entity: string; format?: string };

    if (!entity) {
      return NextResponse.json({ error: 'entity is required' }, { status: 400 });
    }

    const validEntities = ['contacts', 'companies', 'deals', 'leads', 'tasks', 'activities'];
    if (!validEntities.includes(entity)) {
      return NextResponse.json({ error: `Invalid entity. Must be one of: ${validEntities.join(', ')}` }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenantFilter = (table: { tenantId: any; deletedAt?: any }) =>
      and(eq(table.tenantId, ctx.tenantId), table.deletedAt ? isNull(table.deletedAt) : undefined);

    // #1048: select an explicit, business-meaningful column set per entity
    // instead of db.select() (which fetches ALL columns — 50+ on wide tables,
    // including large jsonb blobs like customFields/metadata — for up to 10k
    // rows, transferring hundreds of MB). These are the fields a user actually
    // wants in an export; heavy jsonb and internal columns are intentionally
    // omitted.
    switch (entity) {
      case 'contacts':
        data = await db.select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
          phone: contacts.phone,
          mobilePhone: contacts.mobilePhone,
          jobTitle: contacts.jobTitle,
          department: contacts.department,
          companyId: contacts.companyId,
          assignedTo: contacts.assignedTo,
          leadSource: contacts.leadSource,
          leadStatus: contacts.leadStatus,
          lifecycleStage: contacts.lifecycleStage,
          score: contacts.score,
          city: contacts.city,
          state: contacts.state,
          country: contacts.country,
          isCustomer: contacts.isCustomer,
          createdAt: contacts.createdAt,
          updatedAt: contacts.updatedAt,
        }).from(contacts).where(tenantFilter(contacts)).limit(10000);
        break;
      case 'companies':
        data = await db.select({
          id: companies.id,
          name: companies.name,
          domain: companies.domain,
          industry: companies.industry,
          companySize: companies.companySize,
          annualRevenue: companies.annualRevenue,
          website: companies.website,
          phone: companies.phone,
          city: companies.city,
          state: companies.state,
          country: companies.country,
          isCustomer: companies.isCustomer,
          createdAt: companies.createdAt,
          updatedAt: companies.updatedAt,
        }).from(companies).where(tenantFilter(companies)).limit(10000);
        break;
      case 'deals':
        data = await db.select({
          id: deals.id,
          title: deals.title,
          amount: deals.amount,
          stageId: deals.stageId,
          pipelineId: deals.pipelineId,
          contactId: deals.contactId,
          companyId: deals.companyId,
          assignedTo: deals.assignedTo,
          closeDate: deals.closeDate,
          createdAt: deals.createdAt,
          updatedAt: deals.updatedAt,
        }).from(deals).where(tenantFilter(deals)).limit(10000);
        break;
      case 'leads':
        data = await db.select({
          id: leads.id,
          firstName: leads.firstName,
          lastName: leads.lastName,
          email: leads.email,
          phone: leads.phone,
          companyName: leads.companyName,
          title: leads.title,
          source: leads.source,
          leadStatus: leads.leadStatus,
          score: leads.score,
          value: leads.value,
          assignedTo: leads.assignedTo,
          lifecycleStage: leads.lifecycleStage,
          city: leads.city,
          state: leads.state,
          country: leads.country,
          isConverted: leads.isConverted,
          createdAt: leads.createdAt,
          updatedAt: leads.updatedAt,
        }).from(leads).where(tenantFilter(leads)).limit(10000);
        break;
      case 'tasks':
        data = await db.select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          priority: tasks.priority,
          status: tasks.status,
          dueDate: tasks.dueDate,
          completed: tasks.completed,
          completedAt: tasks.completedAt,
          assignedTo: tasks.assignedTo,
          contactId: tasks.contactId,
          dealId: tasks.dealId,
          companyId: tasks.companyId,
          leadId: tasks.leadId,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
        }).from(tasks).where(tenantFilter(tasks)).limit(10000);
        break;
      case 'activities':
        data = await db.select({
          id: activities.id,
          entityType: activities.entityType,
          entityId: activities.entityId,
          eventType: activities.eventType,
          action: activities.action,
          description: activities.description,
          userId: activities.userId,
          contactId: activities.contactId,
          dealId: activities.dealId,
          companyId: activities.companyId,
          leadId: activities.leadId,
          createdAt: activities.createdAt,
        }).from(activities).where(eq(activities.tenantId, ctx.tenantId)).limit(10000);
        break;
    }

    if (format === 'csv') {
      if (data.length === 0) {
        return new NextResponse('', {
          status: 200,
          headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${entity}-export.csv"` },
        });
      }
      // Convert to CSV with formula injection protection via shared escapeCSV
      const headers = Object.keys(data[0]!);
      const csvRows = [
        headers.join(','),
        ...data.map(row =>
          headers.map(h => escapeCSV((row as Record<string, unknown>)[h])).join(',')
        ),
      ];
      const csv = csvRows.join('\n');

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${entity}-export.csv"`,
        },
      });
    }

    return NextResponse.json({
      data,
      meta: { entity, total: data.length, exported_at: new Date().toISOString(), format: 'json' },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
