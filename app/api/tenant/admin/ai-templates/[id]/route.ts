/**
 * GET    /api/tenant/admin/ai-templates/[id]
 * PATCH  /api/tenant/admin/ai-templates/[id]
 * DELETE /api/tenant/admin/ai-templates/[id]    (soft-delete)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { aiDraftTemplates } from '@/drizzle/schema/ai';
import { eq, and, isNull } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

const VALID_KINDS = new Set(['email', 'note', 'reply', 'call_prep']);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { id } = await params;
    const row = await db.query.aiDraftTemplates.findFirst({
      where: and(eq(aiDraftTemplates.id, id), eq(aiDraftTemplates.tenantId, ctx.tenantId), isNull(aiDraftTemplates.deletedAt)),
    });
    if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json({ template: row });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { id } = await params;
    const existing = await db.query.aiDraftTemplates.findFirst({
      where: and(eq(aiDraftTemplates.id, id), eq(aiDraftTemplates.tenantId, ctx.tenantId), isNull(aiDraftTemplates.deletedAt)),
    });
    if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    const body = await req.json().catch(() => ({}));

    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: ctx.userId };
    if (typeof body.name === 'string' && body.name.trim()) patch['name'] = body.name.trim().slice(0, 120);
    if (typeof body.description === 'string') patch['description'] = body.description.slice(0, 500);
    if (typeof body.kind === 'string') {
      if (!VALID_KINDS.has(body.kind)) return NextResponse.json({ error: 'invalid kind' }, { status: 400 });
      patch['kind'] = body.kind;
    }
    if (body.entity_types !== undefined) {
      patch['entityTypes'] = Array.isArray(body.entity_types) ? body.entity_types.join(',') : String(body.entity_types);
    }
    if (typeof body.system_prompt === 'string' && body.system_prompt.trim()) {
      patch['systemPrompt'] = body.system_prompt.slice(0, 8000);
    }
    if (typeof body.user_prompt === 'string' && body.user_prompt.trim()) {
      patch['userPrompt'] = body.user_prompt.slice(0, 8000);
    }
    if (typeof body.tone === 'string') patch['tone'] = body.tone.slice(0, 50);
    if (typeof body.default_subject === 'string') patch['defaultSubject'] = body.default_subject.slice(0, 200);
    if (typeof body.active === 'boolean') patch['active'] = body.active;

    const [row] = await db.update(aiDraftTemplates).set(patch).where(eq(aiDraftTemplates.id, id)).returning();

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'update_ai_draft_template', entityType: 'ai_draft_template',
      entityId: id, newData: { fields: Object.keys(patch) },
    });

    return NextResponse.json({ template: row });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { id } = await params;
    const existing = await db.query.aiDraftTemplates.findFirst({
      where: and(eq(aiDraftTemplates.id, id), eq(aiDraftTemplates.tenantId, ctx.tenantId), isNull(aiDraftTemplates.deletedAt)),
    });
    if (!existing) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

    await db.update(aiDraftTemplates)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(aiDraftTemplates.id, id));

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'delete_ai_draft_template', entityType: 'ai_draft_template',
      entityId: id, newData: { slug: existing.slug },
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return apiError(err);
  }
}
