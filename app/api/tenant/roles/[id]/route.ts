import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { roles } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { updateRoleSchema } from '@/lib/api/schemas';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuard } from '@/lib/api/concurrency';

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function PATCH(request: NextRequest, { params }: any) {
  try {
  const limited = await rateLimitMutating(request, 'roles', 'patch');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { id } = await params;
    const rawBody = await readJsonBody(request);
    const validated = validateBody(updateRoleSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { name, description, permissions } = validated.data;

    // Optimistic concurrency: reject if another update happened since client read
    const expectedUpdatedAt = rawBody.expectedUpdatedAt ? new Date(rawBody.expectedUpdatedAt) : null;
    const guard = await concurrencyGuard(db, roles, id, ctx.tenantId, expectedUpdatedAt);
    if (guard) return guard;

    const [row] = await db.update(roles)
      .set({
        name,
        description: description || null,
        permissions: permissions || {},
        updatedAt: new Date(),
      })
      .where(and(eq(roles.id, id), eq(roles.tenantId, ctx.tenantId)))
      .returning();

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function DELETE(request: NextRequest, { params }: any) {
  try {
  const limited = await rateLimitMutating(request, 'roles', 'delete');
  if (limited) return limited;
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    
    const { id } = await params;

    // Cannot delete default system roles
    const role = await db.query.roles.findFirst({
      where: and(eq(roles.id, id), eq(roles.tenantId, ctx.tenantId)),
      columns: { slug: true }
    });

    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (['admin', 'manager', 'sales', 'viewer'].includes(role.slug!)) {
      return NextResponse.json({ error: 'Cannot delete system roles' }, { status: 400 });
    }

    await db.update(roles).set({ deletedAt: new Date() }).where(and(eq(roles.id, id), eq(roles.tenantId, ctx.tenantId)));
    
    return NextResponse.json({ ok: true });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) { 
    return apiError(err); 
  }
}
