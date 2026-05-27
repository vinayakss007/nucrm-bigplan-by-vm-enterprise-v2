/**
 * AI Providers (admin only)
 *   GET   /api/tenant/admin/ai-providers
 *   PATCH /api/tenant/admin/ai-providers
 *
 * Storage: tenants.settings.ai_providers (jsonb_set merge)
 * Per provider: { enabled, default_model, temperature, max_tokens, fallback_priority,
 *                 api_key_set (boolean — never echo the key), base_url (Ollama only) }
 *
 * Secrets: API keys are not stored on tenants.settings (jsonb is too readable).
 * For now we record api_key_set:true as a marker. The real key should land in
 * a dedicated secrets table or env-per-tenant override; that's a follow-up.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';

const PROVIDERS = ['openai', 'anthropic', 'groq', 'ollama'] as const;
type ProviderId = typeof PROVIDERS[number];

const DEFAULTS: Record<ProviderId, any> = {
  openai:    { enabled: false, default_model: 'gpt-4o-mini',         temperature: 0.4, max_tokens: 1024, fallback_priority: 1, api_key_set: false },
  anthropic: { enabled: false, default_model: 'claude-3-5-sonnet',   temperature: 0.4, max_tokens: 1024, fallback_priority: 2, api_key_set: false },
  groq:      { enabled: false, default_model: 'llama-3.1-70b-versatile', temperature: 0.4, max_tokens: 1024, fallback_priority: 3, api_key_set: false },
  ollama:    { enabled: false, default_model: 'llama3.1:8b',         temperature: 0.4, max_tokens: 1024, fallback_priority: 4, base_url: 'http://localhost:11434' },
};

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
    const stored = ((t?.settings as any) ?? {}).ai_providers ?? {};

    const providers: Record<string, any> = {};
    for (const id of PROVIDERS) {
      providers[id] = { ...DEFAULTS[id], ...(stored[id] ?? {}) };
      // Never echo the raw key
      delete providers[id].api_key;
    }

    return NextResponse.json({ providers });
  } catch (err: any) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  let ctx: any;
  try {
    ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const incoming = body.providers;
    if (!incoming || typeof incoming !== 'object')
      return NextResponse.json({ error: 'providers object required' }, { status: 400 });

    const safe: Record<string, any> = {};
    for (const id of PROVIDERS) {
      if (!incoming[id]) continue;
      const p = incoming[id];
      const out: any = {};
      if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
      if (typeof p.default_model === 'string' && p.default_model.trim()) out.default_model = p.default_model.trim().slice(0, 100);
      if (typeof p.temperature === 'number') {
        if (p.temperature < 0 || p.temperature > 2) return NextResponse.json({ error: `${id}.temperature must be 0-2` }, { status: 400 });
        out.temperature = p.temperature;
      }
      if (typeof p.max_tokens === 'number') {
        if (!Number.isInteger(p.max_tokens) || p.max_tokens < 16 || p.max_tokens > 32000)
          return NextResponse.json({ error: `${id}.max_tokens must be 16-32000` }, { status: 400 });
        out.max_tokens = p.max_tokens;
      }
      if (typeof p.fallback_priority === 'number') {
        if (!Number.isInteger(p.fallback_priority) || p.fallback_priority < 1 || p.fallback_priority > 99)
          return NextResponse.json({ error: `${id}.fallback_priority must be 1-99` }, { status: 400 });
        out.fallback_priority = p.fallback_priority;
      }
      if (id === 'ollama' && typeof p.base_url === 'string') {
        const url = p.base_url.trim();
        if (url && !/^https?:\/\//.test(url))
          return NextResponse.json({ error: 'ollama.base_url must start with http(s)://' }, { status: 400 });
        out.base_url = url.slice(0, 200);
      }
      // API key: just record presence (real secret lives elsewhere — TODO secrets vault)
      if (typeof p.api_key === 'string') {
        out.api_key_set = p.api_key.trim().length > 0;
      }
      safe[id] = out;
    }

    await db
      .update(tenants)
      .set({
        settings: sql`
          jsonb_set(
            COALESCE(${tenants.settings}, '{}'::jsonb),
            '{ai_providers}',
            COALESCE(${tenants.settings}->'ai_providers', '{}'::jsonb) || ${JSON.stringify(safe)}::jsonb
          )
        `,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, ctx.tenantId));

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'update_ai_providers', entityType: 'tenant',
      newData: { providers: Object.keys(safe) },
    });

    return NextResponse.json({ ok: true, providers: safe });
  } catch (err: any) {
    console.error('[ai-providers PATCH]', err);
    return apiError(err);
  }
}
