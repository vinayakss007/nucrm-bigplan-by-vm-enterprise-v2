/**
 * Advanced Analytics API
 * Revenue forecast, conversion funnel, team performance, activity trends
 */
import { apiError } from '@/lib/api-error';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { 
  deals, 
  dealStages, 
  leads, 
  contacts, 
  tasks, 
  activities, 
  users, 
  tenantMembers, 
  companies 
} from '@/drizzle/schema';
import { sql, eq, and, gte, isNull, desc, asc, notInArray, isNotNull } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;
    const { searchParams } = new URL(request.url);
    const metric = searchParams.get('metric') || 'overview';

    switch (metric) {
      case 'forecast': {
        // Monthly revenue trend (last 6 months)
        const monthly = await db.select({
          month: sql<string>`to_char(${deals.createdAt}, 'YYYY-MM')`.as('month'),
          total_deals: sql<number>`count(*)::int`,
          won_revenue: sql<string>`COALESCE(sum(${deals.amount}) FILTER (WHERE ${dealStages.name} = 'won'), 0)::numeric`,
          pipeline: sql<string>`COALESCE(sum(${deals.amount}) FILTER (WHERE ${dealStages.name} IN ('proposal','negotiation')), 0)::numeric`,
          won_count: sql<number>`count(*) FILTER (WHERE ${dealStages.name} = 'won')::int`,
          lost_count: sql<number>`count(*) FILTER (WHERE ${dealStages.name} = 'lost')::int`
        })
        .from(deals)
        .leftJoin(dealStages, eq(deals.stageId, dealStages.id))
        .where(and(
          eq(deals.tenantId, tid),
          gte(deals.createdAt, sql`now() - interval '6 months'`),
          isNull(deals.deletedAt)
        ))
        .groupBy(sql`to_char(${deals.createdAt}, 'YYYY-MM')`)
        .orderBy(asc(sql`month`));

        // Simple forecast: average won revenue * 1.1 (10% growth)
        const avgMonthly = monthly.length > 0
          ? monthly.reduce((sum, m) => sum + parseFloat(m.won_revenue || '0'), 0) / monthly.length
          : 0;
        const forecast = Math.round(avgMonthly * 1.1);

        return NextResponse.json({ monthly, forecast, avgMonthly: Math.round(avgMonthly) });
      }

      case 'funnel': {
        // Lead to deal conversion funnel
        const [leadsTotal, contactsFromLeads, dealsCreated, dealsWon] = await Promise.all([
          db.select({ count: sql<string>`count(*)::text` })
            .from(leads)
            .where(and(eq(leads.tenantId, tid), isNull(leads.deletedAt))),
          db.select({ count: sql<string>`count(*)::text` })
            .from(leads)
            .where(and(eq(leads.tenantId, tid), isNotNull(leads.convertedContactId), isNull(leads.deletedAt))),
          db.select({ count: sql<string>`count(*)::text` })
            .from(deals)
            .where(and(eq(deals.tenantId, tid), isNull(deals.deletedAt))),
          db.select({ count: sql<string>`count(*)::text` })
            .from(deals)
            .leftJoin(dealStages, eq(deals.stageId, dealStages.id))
            .where(and(eq(deals.tenantId, tid), eq(dealStages.name, 'won'), isNull(deals.deletedAt))),
        ]);

        const funnel = [
          { stage: 'Leads Generated', count: parseInt(leadsTotal[0]?.count || '0'), color: '#7c3aed' },
          { stage: 'Converted to Contact', count: parseInt(contactsFromLeads[0]?.count || '0'), color: '#4f46e5' },
          { stage: 'Deals Created', count: parseInt(dealsCreated[0]?.count || '0'), color: '#0ea5e9' },
          { stage: 'Deals Won', count: parseInt(dealsWon[0]?.count || '0'), color: '#10b981' },
        ].filter(f => f.count > 0);

        return NextResponse.json({ funnel });
      }

      case 'team': {
        const leadsAgg = db.$with('leads_agg').as(
          db.select({
            assigned_to: leads.assignedTo,
            leads_assigned: sql<number>`count(*)::int`.as('leads_assigned')
          })
          .from(leads)
          .where(and(eq(leads.tenantId, tid), isNull(leads.deletedAt)))
          .groupBy(leads.assignedTo)
        );

        const contactsAgg = db.$with('contacts_agg').as(
          db.select({
            assigned_to: contacts.assignedTo,
            contacts_assigned: sql<number>`count(*)::int`.as('contacts_assigned')
          })
          .from(contacts)
          .where(and(eq(contacts.tenantId, tid), isNull(contacts.deletedAt), eq(contacts.isArchived, false)))
          .groupBy(contacts.assignedTo)
        );

        const dealsAgg = db.$with('deals_agg').as(
          db.select({
            assigned_to: deals.assignedTo,
            deals_won: sql<number>`count(*) FILTER (WHERE ${dealStages.name} = 'won')::int`.as('deals_won'),
            revenue_won: sql<string>`COALESCE(sum(${deals.amount}) FILTER (WHERE ${dealStages.name} = 'won'), 0)::numeric`.as('revenue_won')
          })
          .from(deals)
          .leftJoin(dealStages, eq(deals.stageId, dealStages.id))
          .where(and(eq(deals.tenantId, tid), isNull(deals.deletedAt)))
          .groupBy(deals.assignedTo)
        );

        const tasksAgg = db.$with('tasks_agg').as(
          db.select({
            assigned_to: tasks.assignedTo,
            tasks_completed: sql<number>`count(*)::int`.as('tasks_completed')
          })
          .from(tasks)
          .where(and(eq(tasks.tenantId, tid), isNull(tasks.deletedAt), eq(tasks.status, 'completed')))
          .groupBy(tasks.assignedTo)
        );

        const activitiesAgg = db.$with('activities_agg').as(
          db.select({
            user_id: activities.userId,
            activities_logged: sql<number>`count(*)::int`.as('activities_logged')
          })
          .from(activities)
          .where(eq(activities.tenantId, tid))
          .groupBy(activities.userId)
        );

        const teamPerformance = await db
          .with(leadsAgg, contactsAgg, dealsAgg, tasksAgg, activitiesAgg)
          .select({
            id: users.id,
            full_name: users.fullName,
            email: users.email,
            avatar_url: users.avatarUrl,
            leads_assigned: sql<number>`COALESCE(${leadsAgg.leads_assigned}, 0)`,
            contacts_assigned: sql<number>`COALESCE(${contactsAgg.contacts_assigned}, 0)`,
            deals_won: sql<number>`COALESCE(${dealsAgg.deals_won}, 0)`,
            revenue_won: sql<number>`COALESCE(${dealsAgg.revenue_won}, 0)`,
            tasks_completed: sql<number>`COALESCE(${tasksAgg.tasks_completed}, 0)`,
            activities_logged: sql<number>`COALESCE(${activitiesAgg.activities_logged}, 0)`,
          })
          .from(tenantMembers)
          .innerJoin(users, eq(users.id, tenantMembers.userId))
          .leftJoin(leadsAgg, eq(leadsAgg.assigned_to, users.id))
          .leftJoin(contactsAgg, eq(contactsAgg.assigned_to, users.id))
          .leftJoin(dealsAgg, eq(dealsAgg.assigned_to, users.id))
          .leftJoin(tasksAgg, eq(tasksAgg.assigned_to, users.id))
          .leftJoin(activitiesAgg, eq(activitiesAgg.user_id, users.id))
          .where(and(eq(tenantMembers.tenantId, tid), eq(tenantMembers.status, 'active')))
          .orderBy(sql`revenue_won DESC NULLS LAST`);

        return NextResponse.json({ team: teamPerformance });
      }

      case 'activity_trend': {
        // Daily activity for last 30 days
        const daily = await db.select({
          day: sql<string>`to_char(${activities.createdAt}, 'YYYY-MM-DD')`.as('day'),
          total: sql<number>`count(*)::int`,
          contact_actions: sql<number>`count(*) FILTER (WHERE ${activities.action} ILIKE '%contact%')::int`,
          deal_actions: sql<number>`count(*) FILTER (WHERE ${activities.action} ILIKE '%deal%')::int`,
          lead_actions: sql<number>`count(*) FILTER (WHERE ${activities.action} ILIKE '%lead%')::int`,
          task_actions: sql<number>`count(*) FILTER (WHERE ${activities.action} ILIKE '%task%')::int`
        })
        .from(activities)
        .where(and(
          eq(activities.tenantId, tid),
          gte(activities.createdAt, sql`now() - interval '30 days'`)
        ))
        .groupBy(sql`to_char(${activities.createdAt}, 'YYYY-MM-DD')`)
        .orderBy(asc(sql`day`));

        return NextResponse.json({ daily });
      }

      case 'top_deals': {
        const topDeals = await db.select({
          id: deals.id,
          title: deals.title,
          value: deals.amount,
          stage: dealStages.name,
          close_date: deals.closeDate,
          created_at: deals.createdAt,
          first_name: contacts.firstName,
          last_name: contacts.lastName,
          company_name: companies.name,
          assigned_name: users.fullName
        })
        .from(deals)
        .leftJoin(dealStages, eq(deals.stageId, dealStages.id))
        .leftJoin(contacts, eq(contacts.id, deals.contactId))
        .leftJoin(companies, eq(companies.id, contacts.companyId))
        .leftJoin(users, eq(users.id, deals.assignedTo))
        .where(and(
          eq(deals.tenantId, tid),
          isNull(deals.deletedAt),
          notInArray(dealStages.name, ['won', 'lost'])
        ))
        .orderBy(sql`${deals.amount} DESC NULLS LAST`)
        .limit(10);

        return NextResponse.json({ deals: topDeals });
      }

      case 'recent_activities': {
        const activitiesResult = await db.select({
          id: activities.id,
          action: activities.action,
          description: activities.description,
          metadata: activities.metadata,
          created_at: activities.createdAt,
          user_name: users.fullName,
          avatar_url: users.avatarUrl
        })
        .from(activities)
        .leftJoin(users, eq(users.id, activities.userId))
        .where(eq(activities.tenantId, tid))
        .orderBy(desc(activities.createdAt))
        .limit(50);

        return NextResponse.json({ activities: activitiesResult });
      }

      default:
        return NextResponse.json({ error: 'Unknown metric' }, { status: 400 });
    }
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('Analytics error:', err);
    return apiError(err);
  }
}
