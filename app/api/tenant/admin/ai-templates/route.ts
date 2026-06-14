/**
 * Auto-Draft Templates (admin only)
 *
 *   GET    /api/tenant/admin/ai-templates           — list templates + seeds
 *   POST   /api/tenant/admin/ai-templates           — create new
 *   GET    /api/tenant/admin/ai-templates/[id]      — read one
 *   PATCH  /api/tenant/admin/ai-templates/[id]      — update
 *   DELETE /api/tenant/admin/ai-templates/[id]      — soft-delete
 *
 * Persists to ai_draft_templates. Seed templates from lib/ai/draft.ts
 * are returned alongside saved rows on GET (so the picker is never empty),
 * but POSTing a seed slug saves it as a real row that the admin can edit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { aiDraftTemplates } from '@/drizzle/schema/ai';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import { SEED_DRAFT_TEMPLATES } from '@/lib/ai/draft';

const VALID_KINDS = new Set(['email', 'note', 'reply', 'call_prep']);

interface UpsertBody {
  slug?: string;
  name?: string;
  description?: string;
  kind?: string;
  entity_types?: string | string[];
  system_prompt?: string;
  user_prompt?: string;
  tone?: string;
  default_subject?: string;
  active?: boolean;
}

function validate(body: UpsertBody): { error: string } | null {
  if (typeof body.name !== 'string' || !body.name.trim()) return { error: 'name required' };
  if (typeof body.system_prompt !== 'string' || !body.system_prompt.trim()) return { error: 'system_prompt required' };
  if (typeof body.user_prompt !== 'string' || !body.user_prompt.trim()) return { error: 'user_prompt required' };
  if (typeof body.kind === 'string' && !VALID_KINDS.has(body.kind)) {
    return { error: `kind must be one of ${[...VALID_KINDS].join(', ')}` };
  }
  return null;
}

function normaliseEntityTypes(input: string | string[] | undefined): string {
  if (!input) return 'contact,deal';
  if (Array.isArray(input)) return input.join(',');
  return input;
}

function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const rows = await db
      .select()
      .from(aiDraftTemplates)
      .where(and(eq(aiDraftTemplates.tenantId, ctx.tenantId), isNull(aiDraftTemplates.deletedAt)))
      .orderBy(desc(aiDraftTemplates.createdAt));

    const installedSlugs = new Set(rows.map(r => r.slug));
    const seeds = SEED_DRAFT_TEMPLATES.filter(s => !installedSlugs.has(s.slug)).map(s => ({
      ...s,
      id: null,
      seed: true,
      active: true,
    }));

    return NextResponse.json({ templates: rows, seeds });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    let body: UpsertBody;
    try { body = await req.json() as UpsertBody; } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    // Allow installing a seed template by slug
    if (typeof body.slug === 'string' && !body.system_prompt && !body.user_prompt) {
      const seed = SEED_DRAFT_TEMPLATES.find(s => s.slug === body.slug);
      if (seed) {
        const [row] = await db.insert(aiDraftTemplates).values({
          tenantId: ctx.tenantId,
          slug: seed.slug,
          name: seed.name,
          description: seed.description,
          kind: seed.kind,
          entityTypes: seed.entityTypes,
          systemPrompt: seed.systemPrompt,
          userPrompt: seed.userPrompt,
          tone: seed.tone,
          defaultSubject: seed.defaultSubject ?? null,
          active: true,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        }).returning();
        await logAudit({
          tenantId: ctx.tenantId, userId: ctx.userId,
          action: 'install_ai_draft_template', entityType: 'ai_draft_template',
          entityId: row?.id, newData: { slug: seed.slug },
        });
        return NextResponse.json({ template: row, installed_from_seed: true });
      }
      return NextResponse.json({ error: `unknown seed slug '${body.slug}'` }, { status: 400 });
    }

    const err = validate(body);
    if (err) return NextResponse.json(err, { status: 400 });

    const name = String(body.name).trim().slice(0, 120);
    const slug = (typeof body.slug === 'string' && body.slug.trim()) ? body.slug.trim().slice(0, 60) : slugify(name);

    const [row] = await db.insert(aiDraftTemplates).values({
      tenantId: ctx.tenantId,
      slug,
      name,
      description: body.description?.toString().slice(0, 500) ?? null,
      kind: body.kind ?? 'email',
      entityTypes: normaliseEntityTypes(body.entity_types),
      systemPrompt: String(body.system_prompt).slice(0, 8000),
      userPrompt: String(body.user_prompt).slice(0, 8000),
      tone: body.tone ?? 'professional',
      defaultSubject: body.default_subject?.toString().slice(0, 200) ?? null,
      active: body.active !== false,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    }).returning();

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'create_ai_draft_template', entityType: 'ai_draft_template',
      entityId: row?.id, newData: { slug, name, kind: body.kind ?? 'email' },
    });

    return NextResponse.json({ template: row });
  } catch (err) {
    console.error('[ai-templates POST]', err);
    return apiError(err);
  }
}
