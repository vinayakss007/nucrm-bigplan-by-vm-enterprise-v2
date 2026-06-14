import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { updateFormSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { forms, formSubmissions, contacts } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;
    const raw = await req.json();
    const validated = validateBody(updateFormSchema, raw);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { updatedAt: new Date(), updatedBy: ctx.userId };
    if (v.name !== undefined) updateData.name = v.name;
    if (v.description !== undefined) updateData.description = v.description;
    if (v.fields !== undefined) updateData.fields = v.fields;
    if (v.is_active !== undefined) updateData.isActive = v.is_active;
    if (raw.settings !== undefined) updateData.settings = raw.settings;

    const [row] = await db
      .update(forms)
      .set(updateData)
      .where(and(eq(forms.id, id), eq(forms.tenantId, ctx.tenantId)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;

    await db.delete(forms).where(and(eq(forms.id, id), eq(forms.tenantId, ctx.tenantId)));
    return NextResponse.json({ ok: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { return apiError(err); }
}
