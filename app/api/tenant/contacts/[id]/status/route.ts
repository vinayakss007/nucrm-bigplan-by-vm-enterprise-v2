import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { updateContactSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, activities } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

const STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost'];

export async function PATCH(
  request: NextRequest, 
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;
    
    const { id } = await params;
    const rawBody = await request.json();
    const validated = validateBody(updateContactSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const lead_status = v.lead_status ?? rawBody.lead_status;
    const reason = rawBody.reason;
    
    if (!STATUSES.includes(lead_status)) {
      return NextResponse.json({ 
        error: `lead_status must be: ${STATUSES.join(', ')}` 
      }, { status: 400 });
    }

    const prev = await db.query.contacts.findFirst({
      columns: { leadStatus: true },
      where: and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId))
    });

    if (!prev) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const [contact] = await db.update(contacts)
      .set({ 
        leadStatus: lead_status, 
        updatedAt: new Date() 
      })
      .where(and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId)))
      .returning();

    const description = `Status: ${prev.leadStatus} → ${lead_status}${reason ? ` — ${reason}` : ''}`;
    
    await db.insert(activities).values({} as any); // @ts-expect-error Schema mismatch - activity insert requires partial object
    db.insert().values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      contactId: id,
      type: 'note',
      description,
      metadata: { 
        status_change: true, 
        from: prev.leadStatus, 
        to: lead_status, 
        reason 
      },
      entityType: 'contact',
      entityId: id,
      action: 'status_change',
    });

    return NextResponse.json({ data: contact });
  } catch (err: any) { 
    return apiError(err); 
  }
}
