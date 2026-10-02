/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, deals, companies, tasks, leads } from '@/drizzle/schema';
import { eq, and, or, gte, lte, desc, sql, inArray, type SQLWrapper } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

// Postgres' default LIKE escape character is a backslash, and this database runs
// with standard_conforming_strings=on, so the `ESCAPE '\\'` clause every ILIKE
// here used to carry was a *two*-character string and Postgres rejected it with
// 22019 "invalid escape string". Any advanced search that included a `query`
// threw — which is to say advanced search did not work at all. The clause is
// gone (the default backslash does the same job) and the wildcards the user
// typed are escaped here, so a search for "50%" means "50%" rather than
// "everything starting with 50".
function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * Advanced Search API — Multi-field filtering with pagination
 *
 * Body: {
 *   query?: string,          // Free text (searches across name, email, phone)
 *   type: 'contacts' | 'leads' | 'deals' | 'companies' | 'tasks',
 *   filters: {
 *     status?: string[],     // lead_status values
 *     stage?: string[],      // deal stages
 *     source?: string[],     // lead source
 *     industry?: string[],   // company industry
 *     priority?: string[],   // task priority
 *     dateFrom?: string,     // ISO date (created_at >=)
 *     dateTo?: string,       // ISO date (created_at <=)
 *     valueMin?: number,     // deal value min
 *     valueMax?: number,     // deal value max
 *     assignedTo?: string,   // user ID
 *     tags?: string[],       // tag names
 *     companyId?: string,    // filter contacts by company
 *   },
 *   sort?: { field: string, dir: 'asc' | 'desc' },
 *   page?: number,
 *   limit?: number,
 * }
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await checkRateLimit(request, { action: 'advanced-search', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    const body = await readJsonBody(request);
    const {
      query: q,
      type = 'contacts',
      filters = {},
      _sort,
      page = 1,
      limit: rawLimit = 25,
    } = body;

    const limit = Math.min(100, Math.max(1, rawLimit));
    const offset = (Math.max(1, page) - 1) * limit;
    const tid = ctx.tenantId;
    const pattern = q ? likePattern(String(q)) : null;

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any[] = [];
    let total = 0;

    switch (type) {
      case 'contacts': {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conditions: any[] = [
          eq(contacts.tenantId, tid),
          sql`${contacts.deletedAt} IS NULL`,
        ];

        if (pattern) {
          conditions.push(or(
            sql`${contacts.firstName} ILIKE ${pattern}`,
            sql`${contacts.lastName} ILIKE ${pattern}`,
            sql`${contacts.email} ILIKE ${pattern}`,
            sql`${contacts.phone} ILIKE ${pattern}`,
            sql`(${contacts.firstName} || ' ' || ${contacts.lastName}) ILIKE ${pattern}`
          )!);
        }
        if (filters.status?.length) {
          conditions.push(inArray(contacts.leadStatus, filters.status));
        }
        // `source` is one of the two pickers this type offers, and the route
        // never read it — selecting a source narrowed the result list on screen
        // and then returned the unfiltered set.
        if (filters.source?.length) {
          conditions.push(inArray(contacts.leadSource, filters.source));
        }
        if (filters.dateFrom) {
          conditions.push(gte(contacts.createdAt, new Date(filters.dateFrom)));
        }
        if (filters.dateTo) {
          conditions.push(lte(contacts.createdAt, new Date(filters.dateTo)));
        }
        if (filters.companyId) {
          conditions.push(eq(contacts.companyId, filters.companyId));
        }

        const where = and(...conditions);

        const [rows, countResult] = await Promise.all([
          db.select({
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            phone: contacts.phone,
            leadStatus: contacts.leadStatus,
            leadSource: contacts.leadSource,
            companyId: contacts.companyId,
            createdAt: contacts.createdAt,
          })
            .from(contacts)
            .where(where)
            .orderBy(desc(contacts.updatedAt))
            .limit(limit)
            .offset(offset),
          db.select({ count: sql<number>`count(*)::int` })
            .from(contacts)
            .where(where),
        ]);

        data = rows.map(r => ({
          id: r.id,
          first_name: r.firstName,
          last_name: r.lastName,
          email: r.email,
          phone: r.phone,
          lead_status: r.leadStatus,
          lead_source: r.leadSource,
          company_id: r.companyId,
          created_at: r.createdAt,
        }));
        total = countResult[0]?.count ?? 0;
        break;
      }

      case 'deals': {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conditions: any[] = [
          eq(deals.tenantId, tid),
          sql`${deals.deletedAt} IS NULL`,
        ];

        if (pattern) {
          conditions.push(sql`${deals.title} ILIKE ${pattern}`);
        }
        if (filters.stage?.length) {
          // deals.stage_id is a uuid; the stage picker sends stage *names*.
          // Binding those names to stage_id made Postgres throw 22P02
          // ("invalid input syntax for type uuid") on every stage filter, so
          // resolve them through this tenant's deal_stages. The comparison is
          // case-insensitive because the provisioned rows are capitalised
          // ("Won") while the option values are lowercase ("won"); an exact
          // match would quietly return nothing.
          const names: string[] = (filters.stage as unknown[]).map((s) => String(s).toLowerCase());
          conditions.push(sql`${deals.stageId} in (
            select ds.id from deal_stages ds
            where ds.tenant_id = ${tid}
              and lower(ds.name) in (${sql.join(names.map((n: string) => sql`${n}`), sql`, `)})
          )`);
        }
        if (filters.valueMin !== undefined) {
          conditions.push(gte(deals.amount, String(filters.valueMin)));
        }
        if (filters.valueMax !== undefined) {
          conditions.push(lte(deals.amount, String(filters.valueMax)));
        }
        if (filters.dateFrom) {
          conditions.push(gte(deals.createdAt, new Date(filters.dateFrom)));
        }
        if (filters.dateTo) {
          conditions.push(lte(deals.createdAt, new Date(filters.dateTo)));
        }

        const where = and(...conditions);

        const [rows, countResult] = await Promise.all([
          db.select({
            id: deals.id,
            title: deals.title,
            amount: deals.amount,
            stageId: deals.stageId,
            metadata: deals.metadata,
            closeDate: deals.closeDate,
            createdAt: deals.createdAt,
          })
            .from(deals)
            .where(where)
            .orderBy(desc(deals.updatedAt))
            .limit(limit)
            .offset(offset),
          db.select({ count: sql<number>`count(*)::int` })
            .from(deals)
            .where(where),
        ]);

        data = rows.map(r => ({
          id: r.id,
          title: r.title,
          value: r.amount,
          stage: r.stageId,
          probability: null,
          close_date: r.closeDate,
          created_at: r.createdAt,
        }));
        total = countResult[0]?.count ?? 0;
        break;
      }

      case 'leads': {
        // The type picker offers Leads and its own docblock listed it, but this
        // switch had no leads case, so leads fell through to `default` and
        // every leads search answered 400 "Invalid type".
        const conditions: SQLWrapper[] = [
          eq(leads.tenantId, tid),
          sql`${leads.deletedAt} IS NULL`,
        ];

        if (pattern) {
          conditions.push(or(
            sql`${leads.firstName} ILIKE ${pattern}`,
            sql`${leads.lastName} ILIKE ${pattern}`,
            sql`${leads.email} ILIKE ${pattern}`,
            sql`${leads.phone} ILIKE ${pattern}`,
            sql`${leads.companyName} ILIKE ${pattern}`
          )!);
        }
        if (filters.status?.length) {
          conditions.push(inArray(leads.leadStatus, filters.status));
        }
        if (filters.source?.length) {
          conditions.push(inArray(leads.source, filters.source));
        }
        if (filters.dateFrom) {
          conditions.push(gte(leads.createdAt, new Date(filters.dateFrom)));
        }
        if (filters.dateTo) {
          conditions.push(lte(leads.createdAt, new Date(filters.dateTo)));
        }

        const where = and(...conditions);

        const [rows, countResult] = await Promise.all([
          db.select({
            id: leads.id,
            firstName: leads.firstName,
            lastName: leads.lastName,
            email: leads.email,
            phone: leads.phone,
            companyName: leads.companyName,
            leadStatus: leads.leadStatus,
            leadSource: leads.source,
            score: leads.score,
            createdAt: leads.createdAt,
          })
            .from(leads)
            .where(where)
            .orderBy(desc(leads.updatedAt))
            .limit(limit)
            .offset(offset),
          db.select({ count: sql<number>`count(*)::int` })
            .from(leads)
            .where(where),
        ]);

        data = rows.map(r => ({
          id: r.id,
          first_name: r.firstName,
          last_name: r.lastName,
          email: r.email,
          phone: r.phone,
          company_name: r.companyName,
          lead_status: r.leadStatus,
          lead_source: r.leadSource,
          score: r.score,
          created_at: r.createdAt,
        }));
        total = countResult[0]?.count ?? 0;
        break;
      }

      case 'companies': {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conditions: any[] = [
          eq(companies.tenantId, tid),
        ];

        if (pattern) {
          conditions.push(or(
            sql`${companies.name} ILIKE ${pattern}`,
            sql`${companies.domain} ILIKE ${pattern}`
          )!);
        }
        if (filters.industry?.length) {
          conditions.push(inArray(companies.industry, filters.industry));
        }
        if (filters.dateFrom) {
          conditions.push(gte(companies.createdAt, new Date(filters.dateFrom)));
        }
        if (filters.dateTo) {
          conditions.push(lte(companies.createdAt, new Date(filters.dateTo)));
        }

        const where = and(...conditions);

        const [rows, countResult] = await Promise.all([
          db.select({
            id: companies.id,
            name: companies.name,
            domain: companies.domain,
            industry: companies.industry,
            size: companies.companySize,
            createdAt: companies.createdAt,
          })
            .from(companies)
            .where(where)
            .orderBy(desc(companies.updatedAt))
            .limit(limit)
            .offset(offset),
          db.select({ count: sql<number>`count(*)::int` })
            .from(companies)
            .where(where),
        ]);

        data = rows.map(r => ({
          id: r.id,
          name: r.name,
          domain: r.domain,
          industry: r.industry,
          size: r.size,
          created_at: r.createdAt,
        }));
        total = countResult[0]?.count ?? 0;
        break;
      }

      case 'tasks': {
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        const conditions: any[] = [
          eq(tasks.tenantId, tid),
        ];

        if (pattern) {
          conditions.push(sql`${tasks.title} ILIKE ${pattern}`);
        }
        if (filters.priority?.length) {
          conditions.push(inArray(tasks.priority, filters.priority));
        }
        if (filters.dateFrom) {
          conditions.push(gte(tasks.createdAt, new Date(filters.dateFrom)));
        }
        if (filters.dateTo) {
          conditions.push(lte(tasks.createdAt, new Date(filters.dateTo)));
        }

        const where = and(...conditions);

        const [rows, countResult] = await Promise.all([
          db.select({
            id: tasks.id,
            title: tasks.title,
            priority: tasks.priority,
            completed: tasks.completed,
            dueDate: tasks.dueDate,
            createdAt: tasks.createdAt,
          })
            .from(tasks)
            .where(where)
            .orderBy(desc(tasks.createdAt))
            .limit(limit)
            .offset(offset),
          db.select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(where),
        ]);

        data = rows.map(r => ({
          id: r.id,
          title: r.title,
          priority: r.priority,
          completed: r.completed,
          due_date: r.dueDate,
          created_at: r.createdAt,
        }));
        total = countResult[0]?.count ?? 0;
        break;
      }

      default:
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    return NextResponse.json({
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + data.length < total,
      },
    });
 
 
  } catch (err) {
    return apiError(err);
  }
});
