import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { cannedResponses } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { concurrencyGuard } from '@/lib/api/concurrency';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';

const updateCannedSchema = z.object({
  category: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  shortcut: z.string().max(50).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
  const limited = await rateLimitMutating(request, 'cannedResponses', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const permErr = requirePerm(ctx, 'settings.manage');
    if (permErr) return permErr;

    const { id } = await params;
    const body = await readJsonBody(request);
    const validated = updateCannedSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json({ error: validated.error.flatten().fieldErrors }, { status: 400 });
    }

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = (body as Record<string, unknown>).expectedUpdatedAt ? new Date((body as Record<string, unknown>).expectedUpdatedAt as string) : null;
    const guard = await concurrencyGuard(db, cannedResponses, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const [row] = await db.update(cannedResponses)
      .set({ ...validated.data, updatedAt: new Date() })
      .where(and(eq(cannedResponses.id, id), eq(cannedResponses.tenantId, ctx.tenantId)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ data: row });
  } catch (err: unknown) {
    return apiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
  const limited = await rateLimitMutating(request, 'cannedResponses', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const permErr = requirePerm(ctx, 'settings.manage');
    if (permErr) return permErr;

    const { id } = await params;

    await db.delete(cannedResponses)
      .where(and(eq(cannedResponses.id, id), eq(cannedResponses.tenantId, ctx.tenantId)));

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return apiError(err);
  }
}
