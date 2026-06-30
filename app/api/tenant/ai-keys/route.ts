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
  SecretsVaultError,
} from '@/lib/ai/secrets';

/** Accept any provider string — no hardcoded list. */

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    // Get provider key metadata from the secrets table (dynamic, not hardcoded)
    const { listProviderKeyMeta } = await import('@/lib/ai/secrets');
    const allKeys = await listProviderKeyMeta(ctx.tenantId, ctx.userId);

    return NextResponse.json({ keys: allKeys });
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

    const { provider, api_key, base_url, model } = body as {
      provider?: string;
      api_key?: string;
      base_url?: string;
      model?: string;
    };

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }

    let result;
    try {
      result = await setPersonalKey(ctx.tenantId, provider, api_key ?? '', ctx.userId, {
        baseUrl: base_url,
        modelOverride: model,
      });
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
    if (!provider) {
      return NextResponse.json({ error: 'provider query param required' }, { status: 400 });
    }

    await deleteProviderKey(ctx.tenantId, provider, 'personal', ctx.userId);

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
