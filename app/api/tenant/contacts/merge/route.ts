import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, contactMergeHistory } from '@/drizzle/schema';
import { eq, and, sql, desc } from 'drizzle-orm';

/**
 * POST /api/tenant/contacts/merge
 * Merge duplicate contacts
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const {
      primary_contact_id,
      duplicate_contact_id,
      merge_strategy = {},
      reason,
    } = body;

    // Validate required fields
    if (!primary_contact_id || !duplicate_contact_id) {
      return NextResponse.json({ 
        error: 'primary_contact_id and duplicate_contact_id are required' 
      }, { status: 400 });
    }

    if (primary_contact_id === duplicate_contact_id) {
      return NextResponse.json({ 
        error: 'Cannot merge contact with itself' 
      }, { status: 400 });
    }

    // Verify contacts exist and get their data
    const [primary, duplicate] = await Promise.all([
      db.select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, primary_contact_id), eq(contacts.tenantId, ctx.tenantId)))
        .limit(1)
        .then(rows => rows[0]),
      db.select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, duplicate_contact_id), eq(contacts.tenantId, ctx.tenantId)))
        .limit(1)
        .then(rows => rows[0]),
    ]);

    if (!primary || !duplicate) {
      return NextResponse.json({ error: 'One or both contacts not found' }, { status: 404 });
    }

    // Perform merge using database function
    await db.execute(sql`
      SELECT public.merge_contacts(
        ${ctx.tenantId},
        ${primary_contact_id},
        ${duplicate_contact_id},
        ${ctx.userId},
        ${JSON.stringify(merge_strategy)},
        ${reason || null}
      )
    `);

    // Get updated primary contact
    const [updatedPrimary] = await db
      .select({
        id: contacts.id,
        tenantId: contacts.tenantId,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        jobTitle: contacts.jobTitle,
        tags: contacts.tags,
        leadStatus: contacts.leadStatus,
        score: contacts.score,
        lifecycleStage: contacts.lifecycleStage,
        leadSource: contacts.leadSource,
        customFields: contacts.customFields,
        createdAt: contacts.createdAt,
        updatedAt: contacts.updatedAt,
      })
      .from(contacts)
      .where(eq(contacts.id, primary_contact_id))
      .limit(1);

    return NextResponse.json({
      ok: true,
      message: 'Contacts merged successfully',
      data: {
        primary_contact: updatedPrimary,
        merged_contact_id: duplicate_contact_id,
        merge_strategy,
      },
    });
  } catch (error: any) {
    console.error('[Merge] POST error:', error);
    
    // Handle specific database errors
    if (error.message?.includes('not found')) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/tenant/contacts/merge/history
 * Get merge history
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Using contactMergeHistory table from schema
    const rows = await db
      .select()
      .from(contactMergeHistory)
      .where(eq(contactMergeHistory.tenantId, ctx.tenantId))
      .orderBy(desc(contactMergeHistory.mergedAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contactMergeHistory)
      .where(eq(contactMergeHistory.tenantId, ctx.tenantId));

    return NextResponse.json({
      data: rows,
      total: countResult?.count ?? 0,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[Merge History] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

