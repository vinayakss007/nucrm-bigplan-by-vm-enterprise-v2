/**
 * AI Providers (admin only)
 *   GET   /api/tenant/admin/ai-providers
 *   PATCH /api/tenant/admin/ai-providers
 *   DELETE /api/tenant/admin/ai-providers?provider=openai   (clears the stored key)
 *
 * Storage:
 *   - Provider config (enabled, default_model, temperature, max_tokens,
 *     fallback_priority) lives on tenants.settings.ai_providers via jsonb_set.
 *   - API keys live in ai_provider_secrets (encrypted with AES-256-GCM via
 *     lib/ai/secrets.ts). Plain `api_key` is accepted on PATCH but never
 *     echoed back; the response only ever exposes a masked …last4 prefix.
 *
 * The Ollama "key" is a base_url, not a secret — stored alongside the
 * ciphertext column so the gateway can resolve it without a second query.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import {
  setProviderKey,
  deleteProviderKey,
  listProviderKeyMeta,
  SecretsVaultError,
  isNamedProvider,
} from '@/lib/ai/secrets';

/** Named providers with built-in defaults. Any other key in the config is a custom provider. */
const NAMED_PROVIDERS = ['openai', 'anthropic', 'groq', 'ollama', 'opencode'];

interface IncomingProvider {
  enabled?: boolean;
  default_model?: string;
  temperature?: number;
  max_tokens?: number;
  fallback_priority?: number;
  api_key?: string;
  base_url?: string;
}

const DEFAULTS: Record<string, {
  enabled: boolean;
  default_model: string;
  temperature: number;
  max_tokens: number;
  fallback_priority: number;
  base_url?: string;
}> = {
  openai:    { enabled: false, default_model: 'gpt-4o-mini',              temperature: 0.4, max_tokens: 1024, fallback_priority: 1 },
  anthropic: { enabled: false, default_model: 'claude-3-5-sonnet-latest', temperature: 0.4, max_tokens: 1024, fallback_priority: 2 },
  groq:      { enabled: false, default_model: 'llama-3.1-70b-versatile',  temperature: 0.4, max_tokens: 1024, fallback_priority: 3 },
  ollama:    { enabled: false, default_model: 'llama3.1:8b',              temperature: 0.4, max_tokens: 1024, fallback_priority: 4, base_url: 'http://localhost:11434' },
  opencode:  { enabled: false, default_model: 'deepseek-v4-flash-free',   temperature: 0.4, max_tokens: 1024, fallback_priority: 5, base_url: 'https://opencode.ai/zen' },
};

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const [t] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    const stored = ((t?.settings as Record<string, unknown> | null) ?? {})['ai_providers'] as Record<string, Record<string, unknown>> | undefined ?? {};
    const keys = await listProviderKeyMeta(ctx.tenantId, ctx.userId);

    const providers: Record<string, unknown> = {};
    // Merge named defaults + stored config
    const allProviderIds = new Set([...NAMED_PROVIDERS, ...Object.keys(stored), ...Object.keys(keys)]);
    for (const id of allProviderIds) {
      const defaults = DEFAULTS[id] ?? { enabled: false, default_model: '', temperature: 0.4, max_tokens: 1024, fallback_priority: 99 };
      providers[id] = {
        ...defaults,
        ...(stored[id] ?? {}),
        api_key_present: keys[id]?.present ?? false,
        api_key_prefix: keys[id]?.keyPrefix ?? null,
        rotated_at: keys[id]?.rotatedAt ?? null,
        key_type: keys[id]?.keyType ?? null,
        model_override: keys[id]?.modelOverride ?? null,
        // base_url from secrets table takes precedence
        ...(keys[id]?.baseUrl ? { base_url: keys[id].baseUrl } : {}),
      };
    }

    return NextResponse.json({ providers });
  } catch (err) {
    return apiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const incoming = body.providers;
    if (!incoming || typeof incoming !== 'object') {
      return NextResponse.json({ error: 'providers object required' }, { status: 400 });
    }

    // Split incoming payload into:
    //   - configPatch (written to tenants.settings.ai_providers via jsonb_set)
    //   - keyUpdates  (written to ai_provider_secrets via the vault)
    const configPatch: Record<string, Record<string, unknown>> = {};
    const keyUpdates: Array<{ provider: string; apiKey?: string; baseUrl?: string; modelOverride?: string }> = [];

    // Accept any provider key from the incoming payload (named or custom)
    const allIds = Object.keys(incoming as Record<string, unknown>);

    for (const id of allIds) {
      const raw = (incoming as Record<string, unknown>)[id];
      if (!raw || typeof raw !== 'object') continue;
      const p = raw as IncomingProvider;

      const cfg: Record<string, unknown> = {};
      if (typeof p['enabled'] === 'boolean') cfg['enabled'] = p['enabled'];
      if (typeof p['default_model'] === 'string' && p['default_model'].trim()) {
        cfg['default_model'] = p['default_model'].trim().slice(0, 200);
      }
      if (typeof p['temperature'] === 'number') {
        if (p['temperature'] < 0 || p['temperature'] > 2) {
          return NextResponse.json({ error: `${id}.temperature must be 0-2` }, { status: 400 });
        }
        cfg['temperature'] = p['temperature'];
      }
      if (typeof p['max_tokens'] === 'number') {
        const mt = p['max_tokens'];
        if (!Number.isInteger(mt) || mt < 16 || mt > 32000) {
          return NextResponse.json({ error: `${id}.max_tokens must be 16-32000` }, { status: 400 });
        }
        cfg['max_tokens'] = mt;
      }
      if (typeof p['fallback_priority'] === 'number') {
        const fp = p['fallback_priority'];
        if (!Number.isInteger(fp) || fp < 1 || fp > 99) {
          return NextResponse.json({ error: `${id}.fallback_priority must be 1-99` }, { status: 400 });
        }
        cfg['fallback_priority'] = fp;
      }
      if (Object.keys(cfg).length > 0) configPatch[id] = cfg;

      // Key handling — keys never land in tenants.settings; they go in the vault.
      const update: { provider: string; apiKey?: string; baseUrl?: string; modelOverride?: string } = { provider: id };
      let touched = false;
      if (typeof p['api_key'] === 'string') {
        const trimmed = p['api_key'].trim();
        if (trimmed.length > 0) {
          update.apiKey = trimmed;
          touched = true;
        }
      }
      // base_url accepted for ALL providers (not just ollama/opencode)
      if (typeof p['base_url'] === 'string') {
        const url = p['base_url'].trim();
        if (url && !/^https?:\/\//.test(url)) {
          return NextResponse.json({ error: `${id}.base_url must start with http(s)://` }, { status: 400 });
        }
        update.baseUrl = url;
        // If provider has a base_url but no API key, store empty key (for self-hosted)
        if (!update.apiKey) update.apiKey = '';
        touched = true;
      }
      if (touched) keyUpdates.push(update);
    }

    // 1. Persist non-secret config via jsonb_set merge (preserve sibling keys).
    if (Object.keys(configPatch).length > 0) {
      await db
        .update(tenants)
        .set({
          settings: sql`
            jsonb_set(
              COALESCE(${tenants.settings}, '{}'::jsonb),
              '{ai_providers}',
              COALESCE(${tenants.settings}->'ai_providers', '{}'::jsonb) || ${JSON.stringify(configPatch)}::jsonb
            )
          `,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, ctx.tenantId));
    }

    // 2. Persist keys via the secrets vault.
    const updatedProviders: string[] = [];
    for (const u of keyUpdates) {
      try {
        await setProviderKey(ctx.tenantId, u.provider, u.apiKey ?? '', {
          baseUrl: u.baseUrl,
          userId: ctx.userId,
        });
        updatedProviders.push(u.provider);
      } catch (err) {
        if (err instanceof SecretsVaultError && err.code === 'encryption_key_missing') {
          return NextResponse.json({
            error: 'Server is not configured to store API keys. Set ENCRYPTION_KEY (>=32 chars) and retry.',
          }, { status: 503 });
        }
        throw err;
      }
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'update_ai_providers',
      entityType: 'tenant',
      newData: {
        config_keys: Object.keys(configPatch),
        keys_rotated: updatedProviders,
      },
    });

    return NextResponse.json({ ok: true, config: Object.keys(configPatch), keys_rotated: updatedProviders });
  } catch (err) {
    console.error('[ai-providers PATCH]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const provider = req.nextUrl.searchParams.get('provider');
    if (!provider) {
      return NextResponse.json({ error: 'provider query param required' }, { status: 400 });
    }

    await deleteProviderKey(ctx.tenantId, provider);

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete_ai_provider_key',
      entityType: 'tenant',
      newData: { provider },
    });

    return NextResponse.json({ ok: true, provider });
  } catch (err) {
    return apiError(err);
  }
}
