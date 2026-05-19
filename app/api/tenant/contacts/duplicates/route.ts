import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { sql } from 'drizzle-orm';

/**
 * POST /api/tenant/contacts/duplicates
 * Find duplicate contacts
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { email, phone, exclude_contact_id } = body || {};

    if (!email && !phone) {
      return NextResponse.json({ 
        error: 'Either email or phone is required' 
      }, { status: 400 });
    }

    // Find duplicates using database function
    const res = await db.execute(sql`
      SELECT id, contact_id, duplicate_id, match_score, match_fields 
      FROM public.find_duplicate_contacts(${ctx.tenantId}, ${email || null}, ${phone || null}, ${exclude_contact_id || null})
    `);

    const rows = res.rows || [];

    return NextResponse.json({
      data: rows,
      count: rows.length,
    });
  } catch (error: any) {
    console.error('[Duplicates] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/tenant/contacts/duplicates/potential
 * Get all potential duplicates for tenant
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');

    // Group by contact pairs
    const res = await db.execute(sql`
      SELECT id, contact_id, duplicate_id, match_score, match_fields 
      FROM public.potential_duplicates
      WHERE tenant_id = ${ctx.tenantId}
      LIMIT ${limit}
    `);

    const rows = (res.rows as any[]) || [];

    // The original code had a different mapping logic in the comments vs actual code.
    // Let's stick to the mapping logic that makes sense for the returned rows.
    const duplicates = rows.map(row => ({
      contact1: {
        id: row.contact_1_id || row.contact_id,
        first_name: row.contact_1_first_name || row.first_name,
        last_name: row.contact_1_last_name || row.last_name,
        email: row.contact_1_email || row.email,
        phone: row.contact_1_phone || row.phone,
      },
      contact2: {
        id: row.contact_2_id || row.duplicate_id,
        first_name: row.contact_2_first_name || row.dup_first_name,
        last_name: row.contact_2_last_name || row.dup_last_name,
        email: row.contact_2_email || row.dup_email,
        phone: row.contact_2_phone || row.dup_phone,
      },
      matchType: row.match_type || row.match_fields,
    }));

    return NextResponse.json({
      data: duplicates,
      count: duplicates.length,
    });
  } catch (error: any) {
    console.error('[Duplicates] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

