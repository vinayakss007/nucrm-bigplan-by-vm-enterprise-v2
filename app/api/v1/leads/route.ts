/**
 * GET /api/v1/leads - List leads
 * POST /api/v1/leads - Create lead
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { leads, contacts, companies } from '@/drizzle/schema';
import { eq, and, sql, desc, count } from 'drizzle-orm';
import { requireAuth } from '@/lib/auth/require-auth';
import { limiters } from '@/lib/rate-limit';
import { handleError, ValidationError } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';
import { syncCalculatedFields } from '@/lib/formula/sync';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rateCheck = await limiters.contacts.check(`leads:${ctx.tenantId}`);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.reset) } }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status') || '';

    const whereClauses = [
      eq(leads.tenantId, ctx.tenantId),
      sql`${leads.deletedAt} IS NULL`
    ];

    if (status) {
      whereClauses.push(eq(leads.leadStatus, status));
    }

    const [results, totalCount] = await Promise.all([
      db.select({
        id: leads.id,
        first_name: leads.firstName,
        last_name: leads.lastName,
        full_name: leads.fullName,
        email: leads.email,
        phone: leads.phone,
        company_name: leads.companyName,
        status: leads.leadStatus,
        source: leads.source,
        score: leads.score,
        created_at: leads.createdAt,
        assigned_to: leads.assignedTo,
        // Joined fields
        contact_first_name: contacts.firstName,
        contact_last_name: contacts.lastName,
        contact_email: contacts.email,
        linked_company_name: companies.name,
      })
      .from(leads)
      .leftJoin(contacts, eq(contacts.id, leads.convertedContactId))
      .leftJoin(companies, eq(companies.id, leads.companyId))
      .where(and(...whereClauses))
      .orderBy(desc(leads.createdAt))
      .limit(limit)
      .offset(offset),

      db.select({ total: count() })
        .from(leads)
        .where(and(eq(leads.tenantId, ctx.tenantId), sql`${leads.deletedAt} IS NULL`))
        .then(rows => rows?.[0]?.total ?? 0)
    ]);

    devLogger.request('GET', '/api/v1/leads', 200, 0, undefined, ctx.userId);

    return NextResponse.json({
      data: results,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: totalCount > offset + limit,
      },
    });
  } catch (error) {
    devLogger.error(error as Error, 'GET /api/v1/leads');
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const rateCheck = await limiters.contacts.check(`leads:${ctx.tenantId}`);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429 }
      );
    }

    const body = await request.json();

    if (!body.first_name || !body.last_name) {
      throw new ValidationError('first_name and last_name are required');
    }

    const [result] = await db.insert(leads)
      .values({
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        firstName: body.first_name,
        lastName: body.last_name,
        email: body.email || null,
        phone: body.phone || null,
        companyName: body.company_name || null,
        companyId: body.company_id || null,
        convertedContactId: body.contact_id || null,
        source: body.lead_source || body.source || 'manual',
        leadStatus: body.lead_status || body.status || 'new',
        score: body.score || 0,
        assignedTo: body.assigned_to || ctx.userId,
        notes: body.notes || null,
      })
      .returning();

    if (!result) {
      throw new Error('Failed to create lead');
    }

    // Trigger calculation of formula fields
    await syncCalculatedFields(ctx.tenantId, 'lead', result.id, result);

    // Map back to snake_case for response
    const responseData = {
      id: result.id,
      first_name: result.firstName,
      last_name: result.lastName,
      email: result.email,
      phone: result.phone,
      company_name: result.companyName,
      status: result.leadStatus,
      source: result.source,
      score: result.score,
      assigned_to: result.assignedTo,
      created_at: result.createdAt,
    };

    devLogger.request('POST', '/api/v1/leads', 201, 0, undefined, ctx.userId);

    return NextResponse.json({ data: responseData }, { status: 201 });
  } catch (error) {
    devLogger.error(error as Error, 'POST /api/v1/leads');
    return handleError(error);
  }
}
