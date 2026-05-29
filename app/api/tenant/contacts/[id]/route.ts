import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { updateContactSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, users, activities, tenants } from '@/drizzle/schema';
import { eq, and, sql, ne } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import { trackFieldChange } from '@/lib/history';
import { fireWebhooks } from '@/lib/webhooks';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'contacts.view');
    if (deny) return deny;
    
    const contactId = (await params).id;

    const [row] = await db
      .select({
        // Select all fields from contact
        id: contacts.id,
        tenantId: contacts.tenantId,
        companyId: contacts.companyId,
        assignedTo: contacts.assignedTo,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        jobTitle: contacts.jobTitle,
        leadStatus: contacts.leadStatus,
        lifecycleStage: contacts.lifecycleStage,
        score: contacts.score,
        notes: contacts.notes,
        tags: contacts.tags,
        customFields: contacts.customFields,
        metadata: contacts.metadata,
        createdAt: contacts.createdAt,
        updatedAt: contacts.updatedAt,
        deletedAt: contacts.deletedAt,
        // Joined fields
        companyName: companies.name,
        assignedName: users.fullName,
      })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .leftJoin(users, eq(users.id, contacts.assignedTo))
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.tenantId, ctx.tenantId),
          sql`${contacts.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Map fields to match legacy expectations if necessary (e.g., snake_case in JSON response)
    // The select object already uses camelCase keys which Next.js will preserve.
    // If the frontend expects snake_case, we might need to map them back.
    // However, the original SELECT c.* would return snake_case from DB.
    // Drizzle select with object keys will return those keys.

    return NextResponse.json({ data: row });
  } catch (err: any) {
    console.error('[contacts [id] GET]', err);
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;

    const contactId = (await params).id;
    const body = await req.json();

    const validated = validateBody(updateContactSchema, body);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;

    const email = v.email?.trim();
    if (email) {
      const [dup] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.tenantId, ctx.tenantId),
            eq(sql`lower(${contacts.email})`, email.toLowerCase()),
            ne(contacts.id, contactId),
            sql`${contacts.deletedAt} IS NULL`
          )
        )
        .limit(1);

      if (dup) {
        return NextResponse.json(
          { error: 'Another contact with this email already exists', is_duplicate: true, duplicate_id: dup.id },
          { status: 409 }
        );
      }
    }

    // Map snake_case to camelCase for Drizzle
    const updateData: any = {};
    if (v.first_name !== undefined) updateData.firstName = v.first_name;
    if (v.last_name !== undefined) updateData.lastName = v.last_name;
    if (v.email !== undefined) updateData.email = v.email;
    if (v.phone !== undefined) updateData.phone = v.phone;
    if (v.job_title !== undefined) updateData.jobTitle = v.job_title;
    else if (v.title !== undefined) updateData.jobTitle = v.title;
    if (v.company_id !== undefined) updateData.companyId = v.company_id;
    if (v.assigned_to !== undefined) updateData.assignedTo = v.assigned_to;
    if (v.lead_status !== undefined) updateData.leadStatus = v.lead_status;
    if (v.lead_source !== undefined) updateData.leadSource = v.lead_source;
    if (v.notes !== undefined) updateData.notes = v.notes;
    if (v.tags !== undefined) updateData.tags = v.tags;
    if (v.score !== undefined) updateData.score = v.score;
    if (v.city !== undefined) updateData.city = v.city;
    if (v.country !== undefined) updateData.country = v.country;
    if (v.website !== undefined) updateData.website = v.website;
    if (v.linkedin_url !== undefined) updateData.linkedinUrl = v.linkedin_url;
    if (v.twitter_url !== undefined) updateData.twitterUrl = v.twitter_url;
    if (v.custom_fields !== undefined) updateData.customFields = v.custom_fields;

    const [existing] = await db
      .select({
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        jobTitle: contacts.jobTitle,
        leadStatus: contacts.leadStatus,
        lifecycleStage: contacts.lifecycleStage,
        notes: contacts.notes,
        companyId: contacts.companyId,
        assignedTo: contacts.assignedTo,
      })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, ctx.tenantId)))
      .limit(1);

    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [row] = await db
      .update(contacts)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, ctx.tenantId)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined;
    const userAgent = req.headers.get('user-agent') || undefined;

    const fieldsToTrack: Record<string, string> = {
      firstName: 'First Name',
      lastName: 'Last Name',
      email: 'Email',
      phone: 'Phone',
      jobTitle: 'Job Title',
      leadStatus: 'Lead Status',
      lifecycleStage: 'Lifecycle Stage',
      notes: 'Notes',
      companyId: 'Company',
      assignedTo: 'Assigned To',
    };

    for (const [field, label] of Object.entries(fieldsToTrack)) {
      if (updateData[field] !== undefined) {
        await trackFieldChange(
          ctx.tenantId,
          ctx.userId,
          (ctx.user as any)?.fullName || null,
          ctx.user?.email || null,
          'contact',
          contactId,
          field,
          label,
          existing[field as keyof typeof existing],
          updateData[field],
          ipAddress,
          userAgent
        );
      }
    }

    // Activity log
    await db.insert(activities).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      contactId: contactId,
      entityId: contactId,
      entityType: 'contact',
      eventType: 'note',
      description: `Updated contact ${row.firstName} ${row.lastName || ''}`.trim(),
      action: 'update',
    }).catch(err => console.error('[contacts PATCH] activity log failed:', err));

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update',
      entityType: 'contact',
      entityId: contactId
    });

    fireWebhooks(ctx.tenantId, 'contact.updated', { id: contactId }).catch(() => {});

    return NextResponse.json({ data: row });
  } catch (err: any) {
    console.error('[contacts [id] PATCH]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'contacts.delete');
    if (deny) return deny;

    const contactId = (await params).id;

    // SOFT DELETE
    const [row] = await db
      .update(contacts)
      .set({
        deletedAt: new Date(),
        deletedBy: ctx.userId,
        isArchived: true,
      })
      .where(
        and(
          eq(contacts.id, contactId),
          eq(contacts.tenantId, ctx.tenantId),
          sql`${contacts.deletedAt} IS NULL`
        )
      )
      .returning({ id: contacts.id });

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await db.update(tenants)
      .set({ currentContacts: sql`greatest(0, ${tenants.currentContacts} - 1)` })
      .where(eq(tenants.id, ctx.tenantId))
      .catch(() => {});

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete',
      entityType: 'contact',
      entityId: contactId
    });

    fireWebhooks(ctx.tenantId, 'contact.deleted', { id: contactId }).catch(() => {});

    return NextResponse.json({ ok: true, message: 'Moved to trash. Restore within 30 days.' });
  } catch (err: any) {
    console.error('[contacts [id] DELETE]', err);
    return apiError(err);
  }
}

