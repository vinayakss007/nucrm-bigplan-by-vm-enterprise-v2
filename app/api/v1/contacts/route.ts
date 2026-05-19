/**
 * GET /api/v1/contacts - List contacts
 * POST /api/v1/contacts - Create contact
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { contacts, companies } from '@/drizzle/schema';
import { eq, and, or, ilike, sql, desc, count } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/require-auth';
import { limiters } from '@/lib/rate-limit';
import { handleError, ValidationError } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';
import { syncCalculatedFields } from '@/lib/formula/sync';
import { DEPRECATION_DATE, SUNSET_DATE, MIGRATION_GUIDE_URL } from '@/lib/api/deprecation';

function addDeprecationHeaders(response: NextResponse) {
  response.headers.set('Deprecation', 'true');
  response.headers.set('Sunset', SUNSET_DATE);
  response.headers.set('Link', `<${MIGRATION_GUIDE_URL}>; rel="deprecation"; title="Migration Guide"`);
  response.headers.set('X-API-Version', 'v1-deprecated');
  response.headers.set('X-API-V2-Path', '/api/tenant/contacts');
  return response;
}

/**
 * GET /api/v1/contacts
 * List all contacts for current tenant
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate and get tenant context
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    // Rate limiting
    const rateCheck = await limiters.contacts.check(`contacts:${ctx.tenantId}`);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.reset) } }
      );
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0'), 0);
    const search = searchParams.get('search') || '';

    // Build where clause
    let whereClause = and(
      eq(contacts.tenantId, ctx.tenantId),
      sql`${contacts.deletedAt} IS NULL`
    );

    if (search) {
      whereClause = and(whereClause, or(
        ilike(contacts.firstName, `%${search}%`),
        ilike(contacts.lastName, `%${search}%`),
        ilike(contacts.email, `%${search}%`)
      ));
    }

    // Execute query with explicit snake_case aliases for backward compatibility
    const results = await db.select({
      id: contacts.id,
      tenant_id: contacts.tenantId,
      company_id: contacts.companyId,
      first_name: contacts.firstName,
      last_name: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      title: contacts.jobTitle,
      lead_source: contacts.leadSource,
      lead_status: contacts.leadStatus,
      lifecycle_stage: contacts.lifecycleStage,
      score: contacts.score,
      company_name: companies.name,
      created_at: contacts.createdAt,
      updated_at: contacts.updatedAt,
      last_contacted_at: contacts.lastContactedAt,
    })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .where(whereClause)
    .orderBy(desc(contacts.createdAt))
    .limit(limit)
    .offset(offset);

    // Get total count
    const [countResult] = await db.select({
      total: count()
    })
    .from(contacts)
    .where(and(
      eq(contacts.tenantId, ctx.tenantId),
      sql`deleted_at IS NULL`
    ));

    const total = countResult?.total || 0;

    devLogger.request('GET', '/api/v1/contacts', 200, 0, undefined, ctx.userId);

    const response = NextResponse.json({
      data: results,
      pagination: {
        total,
        limit,
        offset,
        hasMore: total > offset + limit,
      },
    });
    return addDeprecationHeaders(response);
  } catch (error) {
    devLogger.error(error as Error, 'GET /api/v1/contacts');
    return handleError(error);
  }
}

/**
 * POST /api/v1/contacts
 * Create a new contact
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    // Rate limiting
    const rateCheck = await limiters.contacts.check(`contacts:${ctx.tenantId}`);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429 }
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.first_name || !body.last_name) {
      throw new ValidationError('first_name and last_name are required');
    }

    if (!body.email) {
      throw new ValidationError('email is required');
    }

    // Insert contact using Drizzle
    const [result] = await db.insert(contacts).values({
      tenantId: ctx.tenantId,
      createdBy: ctx.userId,
      firstName: body.first_name,
      lastName: body.last_name,
      email: body.email,
      phone: body.phone,
      companyId: body.company_id,
      jobTitle: body.title || body.job_title,
      assignedTo: body.owner_id || ctx.userId,
      originalOwnerId: body.owner_id || ctx.userId,
      leadSource: body.lead_source || body.source || 'manual',
      leadStatus: body.lead_status || body.status || 'new',
    }).returning();

    if (!result) {
      throw new Error('Failed to create contact');
    }

    // Trigger calculation of formula fields
    await syncCalculatedFields(ctx.tenantId, 'contact', result.id, result);

    devLogger.request('POST', '/api/v1/contacts', 201, 0, undefined, ctx.userId);

    // Map result back to snake_case for response
    const responseData = {
      ...result,
      tenant_id: result.tenantId,
      company_id: result.companyId,
      first_name: result.firstName,
      last_name: result.lastName,
      job_title: result.jobTitle,
      lead_source: result.leadSource,
      lead_status: result.leadStatus,
      created_at: result.createdAt,
      updated_at: result.updatedAt,
    };

    const response = NextResponse.json({ data: responseData }, { status: 201 });
    return addDeprecationHeaders(response);
  } catch (error) {
    devLogger.error(error as Error, 'POST /api/v1/contacts');
    return handleError(error);
  }
}
