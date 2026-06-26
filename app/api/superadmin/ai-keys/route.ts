/**
 * Superadmin AI System Keys
 *   GET   /api/superadmin/ai-keys               — list all system keys across tenants
 *   GET   /api/superadmin/ai-keys?tenantId=X    — list keys for a specific tenant
 *   POST  /api/superadmin/ai-keys               — set a system-level key for a tenant
 *   DELETE /api/superadmin/ai-keys?tenantId=X&provider=Y — delete a system key
 *
 * System keys are platform-provided AI keys that any tenant can use
 * unless they have their own tenant or personal key configured.
 * Only superadmins can manage system keys.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { apiError } from '@/lib/api-error';
import { logAudit } from '@/lib/audit';
import {
  setSystemKey,
  deleteProviderKey,
  listAllKeysForTenant,
  listProviderKeyMeta,
  SecretsVaultError,
  type AIProviderId,
} from '@/lib/ai/secrets';

const VALID_PROVIDERS: AIProviderId[] = ['openai', 'anthropic', 'groq', 'ollama', 'opencode'];

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Superadmin required' }, { status: 403 });

    const tenantId = req.nextUrl.searchParams.get('tenantId');

    if (tenantId) {
      // Get keys for specific tenant
      const keys = await listAllKeysForTenant(tenantId);
      return NextResponse.json({ tenantId, keys });
    }

    // List all tenants with their system key status
    const allTenants = await db
      .select({ id: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.status, 'active'));

    const results = [];
    for (const t of allTenants) {
      const meta = await listProviderKeyMeta(t.id);
      const systemKeys = Object.entries(meta)
        .filter(([_, v]) => v.keyType === 'system')
        .map(([provider, v]) => ({
          provider,
          keyPrefix: v.keyPrefix,
          rotatedAt: v.rotatedAt,
        }));

      results.push({
        tenantId: t.id,
        tenantName: t.name,
        tenantSlug: t.slug,
        systemKeys,
      });
    }

    return NextResponse.json({ tenants: results });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Superadmin required' }, { status: 403 });

    let body;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

    const { tenantId, provider, api_key, base_url } = body as {
      tenantId?: string;
      provider?: string;
      api_key?: string;
      base_url?: string;
    };

    if (!tenantId || !provider || !api_key) {
      return NextResponse.json({ error: 'tenantId, provider, and api_key are required' }, { status: 400 });
    }
    if (!VALID_PROVIDERS.includes(provider as AIProviderId)) {
      return NextResponse.json({ error: `provider must be one of ${VALID_PROVIDERS.join(', ')}` }, { status: 400 });
    }

    // Verify tenant exists
    const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!t) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    let result;
    try {
      result = await setSystemKey(tenantId, provider, api_key, { baseUrl: base_url });
    } catch (err) {
      if (err instanceof SecretsVaultError && err.code === 'encryption_key_missing') {
        return NextResponse.json({
          error: 'Server is not configured to store API keys. Set ENCRYPTION_KEY (>=32 chars) and retry.',
        }, { status: 503 });
      }
      throw err;
    }

    await logAudit({
      tenantId,
      userId: ctx.userId,
      action: 'set_system_ai_key',
      entityType: 'tenant',
      newData: { provider, keyPrefix: result.keyPrefix },
    });

    return NextResponse.json({ ok: true, provider, keyPrefix: result.keyPrefix });
  } catch (err) {
    console.error('[superadmin ai-keys POST]', err);
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Superadmin required' }, { status: 403 });

    const tenantId = req.nextUrl.searchParams.get('tenantId');
    const provider = req.nextUrl.searchParams.get('provider');

    if (!tenantId || !provider) {
      return NextResponse.json({ error: 'tenantId and provider are required' }, { status: 400 });
    }
    if (!VALID_PROVIDERS.includes(provider as AIProviderId)) {
      return NextResponse.json({ error: `provider must be one of ${VALID_PROVIDERS.join(', ')}` }, { status: 400 });
    }

    await deleteProviderKey(tenantId, provider as AIProviderId, 'system');

    await logAudit({
      tenantId,
      userId: ctx.userId,
      action: 'delete_system_ai_key',
      entityType: 'tenant',
      newData: { provider },
    });

    return NextResponse.json({ ok: true, tenantId, provider });
  } catch (err) {
    return apiError(err);
  }
}
