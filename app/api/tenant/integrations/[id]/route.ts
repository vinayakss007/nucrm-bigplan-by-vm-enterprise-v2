import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { integrations } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    
    const { is_active } = await request.json();
    const { id } = await params;

    const [row] = await db.update(integrations)
      .set({ 
        isActive: is_active,
        updatedAt: new Date()
      })
      .where(and(
        eq(integrations.id, id), 
        eq(integrations.tenantId, ctx.tenantId)
      ))
      .returning({ 
        id: integrations.id, 
        is_active: integrations.isActive 
      });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) { 
    return apiError(err); 
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    
    const { id } = await params;
    const result = await db.delete(integrations)
      .where(and(
        eq(integrations.id, id), 
        eq(integrations.tenantId, ctx.tenantId)
      ));

    if (result.rowCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) { 
    return apiError(err); 
  }
}
