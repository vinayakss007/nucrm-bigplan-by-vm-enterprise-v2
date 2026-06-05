import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, leads, deals, companies, tasks } from '@/drizzle/schema';
import { eq, and, or, ilike, gte, lte, desc, sql, inArray } from 'drizzle-orm';
import { checkRateLimit } from '@/lib/rate-limit';

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
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const limited = await checkRateLimit(request, { action: 'advanced-search', max: 30, windowMinutes: 1 });
    if (limited) return limited;

    const body = await request.json();
    const {
      query: q,
      type = 'contacts',
      filters = {},
      sort,
      page = 1,
      limit: rawLimit = 25,
    } = body;

    const limit = Math.min(100, Math.max(1, rawLimit));
    const offset = (Math.max(1, page) - 1) * limit;
    const tid = ctx.tenantId;
    const pattern = q ? `%${q}%` : null;

    let data: any[] = [];
    let total = 0;

    switch (type) {
      case 'contacts': {
        const conditions: any[] = [
          eq(contacts.tenantId, tid),
          sql`${contacts.deletedAt} IS NULL`,
        ];

        if (pattern) {
          conditions.push(or(
            ilike(contacts.firstName, pattern),
            ilike(contacts.lastName, pattern),
            ilike(contacts.email, pattern),
            ilike(contacts.phone, pattern),
            sql`(${contacts.firstName} || ' ' || ${contacts.lastName}) ILIKE ${pattern}`
          )!);
        }
        if (filters.status?.length) {
          conditions.push(inArray(contacts.leadStatus, filters.status));
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
        const conditions: any[] = [
          eq(deals.tenantId, tid),
          sql`${deals.deletedAt} IS NULL`,
        ];

        if (pattern) {
          conditions.push(ilike(deals.title, pattern));
        }
        if (filters.stage?.length) {
          conditions.push(inArray(deals.stageId, filters.stage));
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

      case 'companies': {
        const conditions: any[] = [
          eq(companies.tenantId, tid),
        ];

        if (pattern) {
          conditions.push(or(
            ilike(companies.name, pattern),
            ilike(companies.domain, pattern)
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
        const conditions: any[] = [
          eq(tasks.tenantId, tid),
        ];

        if (pattern) {
          conditions.push(ilike(tasks.title, pattern));
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
  } catch (err: any) {
    return apiError(err);
  }
}
