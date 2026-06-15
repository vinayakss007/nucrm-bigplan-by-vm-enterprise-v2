import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { createNoteSchema } from '@/lib/api/schemas';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { activities, users, contacts } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { processMentions } from '@/lib/notifications';

export async function GET(
  request: NextRequest, 
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const { id } = await params;

    const data = await db.select({
      id: activities.id,
      tenantId: activities.tenantId,
      userId: activities.userId,
      contactId: activities.contactId,
      type: activities.eventType,
      description: activities.description,
      metadata: activities.metadata,
      createdAt: activities.createdAt,
      full_name: users.fullName,
      avatar_url: users.avatarUrl
    })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.userId))
    .where(and(eq(activities.contactId, id), eq(activities.tenantId, ctx.tenantId)))
    .orderBy(desc(activities.createdAt))
    .limit(50);

    return NextResponse.json({ data });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}

export async function POST(
  request: NextRequest, 
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const { id } = await params;
    const rawBody = await request.json();
    const validated = validateBody(createNoteSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const v = validated.data;
    const description = v.content;
    const type = 'note';
    const metadata = {};
    
    if (!description?.trim()) {
      return NextResponse.json({ error: 'description required' }, { status: 400 });
    }
    
    const VALID = ['note', 'call', 'email', 'meeting', 'task', 'deal_update'];
    if (!VALID.includes(type)) {
      return NextResponse.json({ error: `type must be one of: ${VALID.join(', ')}` }, { status: 400 });
    }

    const [row] = await db.insert(activities)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        contactId: id,
        eventType: type,
        description: description.trim(),
        metadata: metadata || {},
      } as typeof activities.$inferInsert)
      .returning();

    // Update contact last activity
    await db.update(contacts)
      .set({ updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.tenantId, ctx.tenantId)));

    // Process mentions for notifications
    await processMentions(description.trim(), ctx.tenantId, ctx.userId, `/tenant/contacts/${id}`);

    return NextResponse.json({ data: row }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}

export async function DELETE(
  request: NextRequest, 
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;

    const { id } = await params;
    const { noteId } = await request.json();

    if (!noteId) {
      return NextResponse.json({ error: 'noteId required' }, { status: 400 });
    }

    await db.delete(activities)
      .where(and(
        eq(activities.id, noteId),
        eq(activities.userId, ctx.userId),
        eq(activities.contactId, id),
        eq(activities.tenantId, ctx.tenantId)
      ));

    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}
