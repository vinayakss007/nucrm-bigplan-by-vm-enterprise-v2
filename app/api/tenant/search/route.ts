/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { escapeLike } from '@/lib/api/sanitize-like';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, leads, deals, dealStages, companies } from '@/drizzle/schema';
import { tasks } from '@/drizzle/schema';
import { eq, and, or, ilike, desc, sql, asc } from 'drizzle-orm';
import { notArchived } from '@/lib/api/deals-archive-filter';
import { checkRateLimit } from '@/lib/rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';
import { parseLimitOffset } from '@/lib/api/query-params';
import { ownerScope } from '@/lib/api/owner-scope';

export const GET = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Rate limit: 60 searches per minute per IP
    const limited = await checkRateLimit(request, { action: 'search', max: 60, windowMinutes: 1 });
    if (limited) return limited;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const type = searchParams.get('type') ?? 'all'; // all | contacts | deals | companies | tasks
    const { limit } = parseLimitOffset(searchParams, { defaultLimit: 20, maxLimit: 50 });

    if (!q || q.length < 1) {
      return NextResponse.json({ contacts: [], leads: [], deals: [], companies: [], tasks: [], total: 0 });
    }

    const pattern = `%${escapeLike(q)}%`;
    const tid = ctx.tenantId;

    // #2686 — the four entity branches below were the only reads in the app with
    // no record-level narrowing: a caller who cannot open another rep's record
    // (list, [id] handler, bulk, export all refuse) could search for it, and the
    // header dropdown prints the email. Each branch now carries the same
    // ownerScope its own list route applies. `view_all` holders get `undefined`,
    // which `and()` skips, so their search stays tenant-wide.
    const contactScope = ownerScope(ctx, 'contacts.view_all', contacts);
    const leadScope = ownerScope(ctx, 'leads.view_all', leads);
    const dealScope = ownerScope(ctx, 'deals.view_all', deals);
    const taskScope = ownerScope(ctx, 'tasks.view_all', tasks);

    const [contactResults, leadResults, dealResults, companyResults, taskResults] = await Promise.all([
      (type === 'all' || type === 'contacts')
        ? db.select({
            id: contacts.id,
            first_name: contacts.firstName,
            last_name: contacts.lastName,
            email: contacts.email,
            phone: contacts.phone,
            lead_status: contacts.leadStatus,
            company_name: companies.name,
          })
          .from(contacts)
          .leftJoin(companies, eq(companies.id, contacts.companyId))
          .where(and(
            eq(contacts.tenantId, tid),
            sql`${contacts.deletedAt} IS NULL`,
            // An archived contact is out of the working set: the list hides it
            // (app/api/tenant/contacts/route.ts:54) and so does the export
            // (#2677). Search was the way back to it. (#2684)
            eq(contacts.isArchived, false),
            contactScope,
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
            first_name: leads.firstName,
            last_name: leads.lastName,
            email: leads.email,
            phone: leads.phone,
            lead_status: leads.leadStatus,
            company_name: leads.companyName,
          })
          .from(leads)
          .where(and(
            eq(leads.tenantId, tid),
            sql`${leads.deletedAt} IS NULL`,
            leadScope,
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
            value: deals.amount,
            stage: dealStages.name,
            first_name: contacts.firstName,
            last_name: contacts.lastName,
            company_name: companies.name
          })
          .from(deals)
          .leftJoin(contacts, eq(contacts.id, deals.contactId))
          .leftJoin(companies, eq(companies.id, deals.companyId))
          .leftJoin(dealStages, eq(dealStages.id, deals.stageId))
          .where(and(
            eq(deals.tenantId, tid),
            sql`${deals.deletedAt} IS NULL`,
            notArchived(),  // #2684 — deals are archived via metadata, not a column
            dealScope,
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
            contact_count: sql<number>`(SELECT count(*)::int FROM ${contacts} WHERE ${contacts.companyId} = ${companies.id} AND ${contacts.deletedAt} IS NULL AND ${contacts.isArchived} = false)`
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
            due_date: tasks.dueDate,
            status: tasks.status,
            completed: sql<boolean>`${tasks.status} = 'completed'`,
            first_name: contacts.firstName,
            last_name: contacts.lastName
          })
          .from(tasks)
          .leftJoin(contacts, eq(contacts.id, tasks.contactId))
          .where(and(
            eq(tasks.tenantId, tid),
            sql`${tasks.deletedAt} IS NULL`,
            taskScope,
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

 
 
    const total = [contactResults, leadResults, dealResults, companyResults, taskResults]
      .reduce((acc, r) => acc + (Array.isArray(r) ? r.length : 0), 0);
    return NextResponse.json({ 
      contacts: contactResults, 
      leads: leadResults, 
      deals: dealResults, 
      companies: companyResults, 
      tasks: taskResults, 
      total, 
      query: q 
    });
 
 
  } catch (err) {
    await logError({ error: err, context: 'search GET', requestMethod: 'GET' });
    return apiError(err);
  }
});
