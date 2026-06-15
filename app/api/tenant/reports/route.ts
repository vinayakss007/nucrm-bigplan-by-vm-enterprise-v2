/**
 * Reports & Export API
 * Generates report data for various CRM entities
 */
import { apiError } from '@/lib/api-error';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { 
  contacts, 
  deals, 
  tasks, 
  activities, 
  leads, 
  companies, 
  dealStages, 
  users 
} from '@/drizzle/schema';
import { eq, and, isNull, gte, desc, sql, count, sum } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'contacts';
    const days = parseInt(searchParams.get('days') || '30');
    
    const dateLimit = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

    switch (type) {
      case 'contacts': {
        const filters = [
          eq(contacts.tenantId, ctx.tenantId),
          isNull(contacts.deletedAt),
          eq(contacts.isArchived, false)
        ];
        if (dateLimit) filters.push(gte(contacts.createdAt, dateLimit));

        const data = await db
          .select({
            id: contacts.id,
            first_name: contacts.firstName,
            last_name: contacts.lastName,
            email: contacts.email,
            phone: contacts.phone,
            job_title: contacts.jobTitle,
            lead_status: contacts.leadStatus,
            lead_source: contacts.leadSource,
            score: contacts.score,
            lifecycle_stage: contacts.lifecycleStage,
            company_name: companies.name,
            city: contacts.city,
            country: contacts.country,
            created_at: contacts.createdAt,
          })
          .from(contacts)
          .leftJoin(companies, eq(companies.id, contacts.companyId))
          .where(and(...filters))
          .orderBy(desc(contacts.createdAt))
          .limit(500);

        return NextResponse.json({ data });
      }

      case 'deals': {
        const filters = [
          eq(deals.tenantId, ctx.tenantId),
          isNull(deals.deletedAt)
        ];
        if (dateLimit) filters.push(gte(deals.createdAt, dateLimit));

        const data = await db
          .select({
            id: deals.id,
            title: deals.title,
            value: deals.amount,
            stage: dealStages.name,
            probability: sql<number>`0`, // Probability not directly in deals table in new schema
            close_date: deals.closeDate,
            created_at: deals.createdAt,
            first_name: contacts.firstName,
            last_name: contacts.lastName,
            company_name: companies.name,
          })
          .from(deals)
          .leftJoin(contacts, eq(contacts.id, deals.contactId))
          .leftJoin(companies, eq(companies.id, deals.companyId))
          .leftJoin(dealStages, eq(dealStages.id, deals.stageId))
          .where(and(...filters))
          .orderBy(desc(deals.createdAt))
          .limit(500);

        return NextResponse.json({ data });
      }

      case 'tasks': {
        const filters = [
          eq(tasks.tenantId, ctx.tenantId),
          isNull(tasks.deletedAt)
        ];
        if (dateLimit) filters.push(gte(tasks.createdAt, dateLimit));

        const data = await db
          .select({
            id: tasks.id,
            title: tasks.title,
            description: tasks.description,
            priority: tasks.priority,
            due_date: tasks.dueDate,
            completed: sql<boolean>`${tasks.status} = 'completed'`,
            created_at: tasks.createdAt,
            first_name: contacts.firstName,
            last_name: contacts.lastName,
            assigned_to: users.fullName,
          })
          .from(tasks)
          .leftJoin(contacts, eq(contacts.id, tasks.contactId))
          .leftJoin(users, eq(users.id, tasks.assignedTo))
          .where(and(...filters))
          .orderBy(desc(tasks.createdAt))
          .limit(500);

        return NextResponse.json({ data });
      }

      case 'activities': {
        const filters = [
          eq(activities.tenantId, ctx.tenantId)
        ];
        if (dateLimit) filters.push(gte(activities.createdAt, dateLimit));

        const data = await db
          .select({
            id: activities.id,
            action: activities.action,
            description: activities.description,
            created_at: activities.createdAt,
            user_name: users.fullName,
          })
          .from(activities)
          .leftJoin(users, eq(users.id, activities.userId))
          .where(and(...filters))
          .orderBy(desc(activities.createdAt))
          .limit(500);

        return NextResponse.json({ data });
      }

      case 'leads': {
        const filters = [
          eq(leads.tenantId, ctx.tenantId),
          isNull(leads.deletedAt)
        ];
        if (dateLimit) filters.push(gte(leads.createdAt, dateLimit));

        const data = await db
          .select({
            id: leads.id,
            first_name: leads.firstName,
            last_name: leads.lastName,
            email: leads.email,
            phone: leads.phone,
            title: leads.title,
            company_name: leads.companyName,
            lead_status: leads.leadStatus,
            lead_source: leads.source,
            score: leads.score,
            created_at: leads.createdAt,
          })
          .from(leads)
          .where(and(...filters))
          .orderBy(desc(leads.createdAt))
          .limit(500);

        return NextResponse.json({ data });
      }

      case 'companies': {
        const filters = [
          eq(companies.tenantId, ctx.tenantId),
          isNull(companies.deletedAt)
        ];
        if (dateLimit) filters.push(gte(companies.createdAt, dateLimit));

        const data = await db
          .select({
            id: companies.id,
            name: companies.name,
            industry: companies.industry,
            size: companies.companySize,
            phone: companies.phone,
            website: companies.website,
            address: companies.address,
            created_at: companies.createdAt,
          })
          .from(companies)
          .where(and(...filters))
          .orderBy(desc(companies.createdAt))
          .limit(500);

        return NextResponse.json({ data });
      }

      case 'summary': {
        const [
          contactsRes,
          leadsRes,
          dealsRes,
          tasksRes,
          companiesRes,
          activitiesRes
        ] = await Promise.all([
          db.select({ count: count() }).from(contacts).where(and(
            eq(contacts.tenantId, ctx.tenantId),
            isNull(contacts.deletedAt),
            eq(contacts.isArchived, false),
            dateLimit ? gte(contacts.createdAt, dateLimit) : sql`true`
          )),
          db.select({ count: count() }).from(leads).where(and(
            eq(leads.tenantId, ctx.tenantId),
            isNull(leads.deletedAt),
            dateLimit ? gte(leads.createdAt, dateLimit) : sql`true`
          )),
          db.select({ count: count(), totalValue: sum(sql`CAST(${deals.amount} AS NUMERIC)`) })
            .from(deals)
            .where(and(
              eq(deals.tenantId, ctx.tenantId),
              isNull(deals.deletedAt),
              dateLimit ? gte(deals.createdAt, dateLimit) : sql`true`
            )),
          db.select({ count: count() }).from(tasks).where(and(
            eq(tasks.tenantId, ctx.tenantId),
            isNull(tasks.deletedAt),
            dateLimit ? gte(tasks.createdAt, dateLimit) : sql`true`
          )),
          db.select({ count: count() }).from(companies).where(and(
            eq(companies.tenantId, ctx.tenantId),
            isNull(companies.deletedAt),
            dateLimit ? gte(companies.createdAt, dateLimit) : sql`true`
          )),
          db.select({ count: count() }).from(activities).where(and(
            eq(activities.tenantId, ctx.tenantId),
            dateLimit ? gte(activities.createdAt, dateLimit) : sql`true`
          )),
        ]);

        const summary = {
          contacts: contactsRes[0]?.count ?? 0,
          leads: leadsRes[0]?.count ?? 0,
          deals: dealsRes[0]?.count ?? 0,
          deal_value: parseFloat(dealsRes[0]?.totalValue ?? '0'),
          tasks: tasksRes[0]?.count ?? 0,
          companies: companiesRes[0]?.count ?? 0,
          activities: activitiesRes[0]?.count ?? 0,
        };
        return NextResponse.json({ data: [summary] });
      }

      default:
        return NextResponse.json({ error: 'Unknown report type' }, { status: 400 });
    }
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[reports GET]', err);
    return apiError(err);
  }
}
