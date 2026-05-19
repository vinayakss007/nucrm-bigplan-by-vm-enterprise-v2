import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { forms, formSubmissions, contacts } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

export async function GET(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const form = await db.query.forms.findFirst({
      where: and(eq(forms.id, id), eq(forms.tenantId, ctx.tenantId))
    });

    if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const submissions = await db.select({
      id: formSubmissions.id,
      data: formSubmissions.data,
      contactId: formSubmissions.contactId,
      submittedBy: formSubmissions.submittedBy,
      sourceUrl: formSubmissions.sourceUrl,
      createdAt: formSubmissions.createdAt,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      contactEmail: contacts.email
    })
    .from(formSubmissions)
    .leftJoin(contacts, eq(contacts.id, formSubmissions.contactId))
    .where(eq(formSubmissions.formId, id))
    .orderBy(desc(formSubmissions.createdAt))
    .limit(50);

    return NextResponse.json({ data: { ...form, submissions } });
  } catch (err: any) { return apiError(err); }
}

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;
    const body = await req.json();
    
    const allowed = ['name','description','fields','settings','isActive'];
    const updateData: any = { updatedAt: new Date(), updatedBy: ctx.userId };
    
    let hasValidFields = false;
    for (const key of allowed) {
      if (body[key] !== undefined) {
        // Handle mapping from is_active to isActive if needed
        const apiKey = key === 'isActive' && body.is_active !== undefined ? 'is_active' : key;
        updateData[key] = body[apiKey] ?? body[key];
        hasValidFields = true;
      }
    }
    // Also check for is_active directly for legacy compatibility
    if (body.is_active !== undefined) {
      updateData.isActive = body.is_active;
      hasValidFields = true;
    }

    if (!hasValidFields) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

    const [row] = await db
      .update(forms)
      .set(updateData)
      .where(and(eq(forms.id, id), eq(forms.tenantId, ctx.tenantId)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) { return apiError(err); }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;

    await db.delete(forms).where(and(eq(forms.id, id), eq(forms.tenantId, ctx.tenantId)));
    return NextResponse.json({ ok: true });
  } catch (err: any) { return apiError(err); }
}
