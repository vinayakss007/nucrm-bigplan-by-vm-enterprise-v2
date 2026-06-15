import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, leads, deals, companies } from '@/drizzle/schema';
import { tasks } from '@/drizzle/schema';
import { eq, and, or, ilike, desc, sql, asc } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Rate limit: 60 searches per minute per IP
    const limited = await checkRateLimit(request, { action: 'search', max: 60, windowMinutes: 1 });
    if (limited) return limited;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const type = searchParams.get('type') ?? 'all'; // all | contacts | deals | companies | tasks
    const limit = Math.min(50, parseInt(searchParams.get('limit') ?? '20'));

    if (!q || q.length < 1) {
      return NextResponse.json({ contacts: [], leads: [], deals: [], companies: [], tasks: [], total: 0 });
    }

    const pattern = `%${q}%`;
    const tid = ctx.tenantId;

    const [contactResults, leadResults, dealResults, companyResults, taskResults] = await Promise.all([
      (type === 'all' || type === 'contacts')
        ? db.select({
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            phone: contacts.phone,
            leadStatus: contacts.leadStatus,
            companyName: companies.name,
            tags: contacts.metadata
          })
          .from(contacts)
          .leftJoin(companies, eq(companies.id, contacts.companyId))
          .where(and(
            eq(contacts.tenantId, tid),
            sql`${contacts.deletedAt} IS NULL`,
            or(
              ilike(contacts.firstName, pattern),
              ilike(contacts.lastName, pattern),
              ilike(contacts.email, pattern),
              ilike(contacts.phone, pattern),
              ilike(companies.name, pattern),
              sql`(${contacts.firstName} || ' ' || ${contacts.lastName}) ILIKE ${pattern}`
            )
          ))
          .orderBy(desc(contacts.updatedAt))
          .limit(limit)
        : Promise.resolve([] as unknown as Awaited<ReturnType<typeof db.select>>),

      (type === 'all' || type === 'leads')
        ? db.select({
            id: leads.id,
            firstName: leads.firstName,
            lastName: leads.lastName,
            email: leads.email,
            phone: leads.phone,
            leadStatus: leads.leadStatus,
            companyName: leads.companyName,
            tags: leads.metadata
          })
          .from(leads)
          .where(and(
            eq(leads.tenantId, tid),
            sql`${leads.deletedAt} IS NULL`,
            or(
              ilike(leads.firstName, pattern),
              ilike(leads.lastName, pattern),
              ilike(leads.email, pattern),
              ilike(leads.phone, pattern),
              ilike(leads.companyName, pattern),
              sql`(${leads.firstName} || ' ' || ${leads.lastName}) ILIKE ${pattern}`
            )
          ))
          .orderBy(desc(leads.updatedAt))
          .limit(limit)
        : Promise.resolve([] as unknown as Awaited<ReturnType<typeof db.select>>),

      (type === 'all' || type === 'deals')
        ? db.select({
            id: deals.id,
            title: deals.title,
            amount: deals.amount,
            closeDate: deals.closeDate,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            companyName: companies.name
          })
          .from(deals)
          .leftJoin(contacts, eq(contacts.id, deals.contactId))
          .leftJoin(companies, eq(companies.id, deals.companyId))
          .where(and(
            eq(deals.tenantId, tid),
            sql`${deals.deletedAt} IS NULL`,
            or(
              ilike(deals.title, pattern),
              ilike(contacts.firstName, pattern),
              ilike(contacts.lastName, pattern),
              sql`(${contacts.firstName} || ' ' || ${contacts.lastName}) ILIKE ${pattern}`,
              ilike(companies.name, pattern)
            )
          ))
          .orderBy(desc(deals.updatedAt))
          .limit(limit)
        : Promise.resolve([] as unknown as Awaited<ReturnType<typeof db.select>>),

      (type === 'all' || type === 'companies')
        ? db.select({
            id: companies.id,
            name: companies.name,
            industry: companies.industry,
            phone: companies.phone,
            website: companies.website,
            contactCount: sql<number>`(SELECT count(*)::int FROM ${contacts} WHERE ${contacts.companyId} = ${companies.id} AND ${contacts.deletedAt} IS NULL)`
          })
          .from(companies)
          .where(and(
            eq(companies.tenantId, tid),
            sql`${companies.deletedAt} IS NULL`,
            or(
              ilike(companies.name, pattern),
              ilike(companies.industry, pattern),
              ilike(companies.website, pattern),
              ilike(companies.phone, pattern)
            )
          ))
          .orderBy(desc(companies.updatedAt))
          .limit(limit)
        : Promise.resolve([] as unknown as Awaited<ReturnType<typeof db.select>>),

      (type === 'all' || type === 'tasks')
        ? db.select({
            id: tasks.id,
            title: tasks.title,
            description: tasks.description,
            priority: tasks.priority,
            dueDate: tasks.dueDate,
            status: tasks.status,
            firstName: contacts.firstName,
            lastName: contacts.lastName
          })
          .from(tasks)
          .leftJoin(contacts, eq(contacts.id, tasks.contactId))
          .where(and(
            eq(tasks.tenantId, tid),
            sql`${tasks.deletedAt} IS NULL`,
            or(
              ilike(tasks.title, pattern),
              ilike(tasks.description, pattern),
              ilike(contacts.firstName, pattern),
              ilike(contacts.lastName, pattern),
              sql`(${contacts.firstName} || ' ' || ${contacts.lastName}) ILIKE ${pattern}`
            )
          ))
          .orderBy(asc(tasks.dueDate))
          .limit(limit)
        : Promise.resolve([] as unknown as Awaited<ReturnType<typeof db.select>>),
    ]);

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const total = (contactResults as any[]).length + (leadResults as any[]).length + (dealResults as any[]).length + (companyResults as any[]).length + (taskResults as any[]).length;
    return NextResponse.json({ 
      contacts: contactResults, 
      leads: leadResults, 
      deals: dealResults, 
      companies: companyResults, 
      tasks: taskResults, 
      total, 
      query: q 
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('[search GET]', err);
    return apiError(err);
  }
}
