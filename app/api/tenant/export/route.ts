import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, deals } from '@/drizzle/schema';
import { tasks, activities } from '@/drizzle/schema';
import { users, tenantMembers } from '@/drizzle/schema';
import { eq, asc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const tid = ctx.tenantId;

    const [contactResults, companyResults, dealResults, taskResults, activityResults, memberResults] = await Promise.all([
      db.query.contacts.findMany({
        where: eq(contacts.tenantId, tid),
        orderBy: [asc(contacts.createdAt)]
      }),
      db.query.companies.findMany({
        where: eq(companies.tenantId, tid),
        orderBy: [asc(companies.createdAt)]
      }),
      db.query.deals.findMany({
        where: eq(deals.tenantId, tid),
        orderBy: [asc(deals.createdAt)]
      }),
      db.query.tasks.findMany({
        where: eq(tasks.tenantId, tid),
        orderBy: [asc(tasks.createdAt)]
      }),
      db.query.activities.findMany({
        where: eq(activities.tenantId, tid),
        orderBy: [asc(activities.createdAt)]
      }),
      db.select({
        email: users.email,
        firstName: users.fullName,
        lastName: users.fullName,
        roleSlug: tenantMembers.roleSlug,
        joinedAt: tenantMembers.createdAt
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(eq(tenantMembers.tenantId, tid))
    ]);

    const export_data = {
      exported_at: new Date().toISOString(),
      tenant_id: ctx.tenantId,
      contacts: contactResults,
      companies: companyResults,
      deals: dealResults,
      tasks: taskResults,
      activities: activityResults,
      members: memberResults,
    };

    return new NextResponse(JSON.stringify(export_data, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="nucrm_export_${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (err: any) {
    console.error('[export GET]', err);
    return apiError(err);
  }
}
