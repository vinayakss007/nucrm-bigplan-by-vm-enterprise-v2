/**
 * Personal AI Keys
 *   GET   /api/tenant/ai-keys          — list the current user's personal keys
 *   POST  /api/tenant/ai-keys          — set/update a personal key
 *   DELETE /api/tenant/ai-keys?provider=X — delete a personal key
 *
 * Personal keys are per-user, per-provider. They take priority over
 * tenant and system keys when resolving which key to use for AI calls.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import {
  setPersonalKey,
  deleteProviderKey,
  getProviderKeyMeta,
  SecretsVaultError,
  type AIProviderId,
} from '@/lib/ai/secrets';

const VALID_PROVIDERS: AIProviderId[] = ['openai', 'anthropic', 'groq', 'ollama', 'opencode'];

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    // Get all provider key metadata for the current user
    const results: Record<string, unknown> = {};
    for (const provider of VALID_PROVIDERS) {
      const meta = await getProviderKeyMeta(ctx.tenantId, provider, ctx.userId);
      results[provider] = meta;
    }

    return NextResponse.json({ keys: results });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const { provider, api_key, base_url } = body as {
      provider?: string;
      api_key?: string;
      base_url?: string;
    };

    if (!provider || !api_key) {
      return NextResponse.json({ error: 'provider and api_key are required' }, { status: 400 });
    }
    if (!VALID_PROVIDERS.includes(provider as AIProviderId)) {
      return NextResponse.json({ error: `provider must be one of ${VALID_PROVIDERS.join(', ')}` }, { status: 400 });
    }

    let result;
    try {
      result = await setPersonalKey(ctx.tenantId, provider, api_key, ctx.userId, { baseUrl: base_url });
    } catch (err) {
      if (err instanceof SecretsVaultError && err.code === 'encryption_key_missing') {
        return NextResponse.json({
          error: 'Server is not configured to store API keys. Set ENCRYPTION_KEY (>=32 chars) and retry.',
        }, { status: 503 });
      }
      throw err;
    }

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'set_personal_ai_key',
      entityType: 'tenant',
      newData: { provider, keyPrefix: result.keyPrefix },
    });

    return NextResponse.json({ ok: true, provider, keyPrefix: result.keyPrefix });
  } catch (err) {
    console.error('[ai-keys POST]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const provider = req.nextUrl.searchParams.get('provider');
    if (!provider || !VALID_PROVIDERS.includes(provider as AIProviderId)) {
      return NextResponse.json({ error: `provider must be one of ${VALID_PROVIDERS.join(', ')}` }, { status: 400 });
    }

    await deleteProviderKey(ctx.tenantId, provider as AIProviderId, 'personal', ctx.userId);

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'delete_personal_ai_key',
      entityType: 'tenant',
      newData: { provider },
    });

    return NextResponse.json({ ok: true, provider });
  } catch (err) {
    return apiError(err);
  }
}
