import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { cannedResponses } from '@/drizzle/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { z } from 'zod';

const createCannedSchema = z.object({
  category: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  shortcut: z.string().max(50).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const permErr = requirePerm(ctx, 'settings.manage');
    if (permErr) return permErr;

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const search = searchParams.get('search');

    const conditions = [eq(cannedResponses.tenantId, ctx.tenantId)];
    if (category) conditions.push(eq(cannedResponses.category, category));
    if (search) conditions.push(sql`${cannedResponses.title} ilike ${'%' + search + '%'}`);

    const data = await db.select()
      .from(cannedResponses)
      .where(and(...conditions))
      .orderBy(desc(cannedResponses.createdAt));

    return NextResponse.json({ data });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const permErr = requirePerm(ctx, 'settings.manage');
    if (permErr) return permErr;

    const body = await request.json();
    const validated = createCannedSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json({ error: validated.error.flatten().fieldErrors }, { status: 400 });
    }

    const [row] = await db.insert(cannedResponses).values({
      tenantId: ctx.tenantId,
      category: validated.data.category,
      title: validated.data.title,
      content: validated.data.content,
      shortcut: validated.data.shortcut || null,
      createdBy: ctx.userId,
    }).returning();

    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: unknown) {
    return apiError(err);
  }
}
