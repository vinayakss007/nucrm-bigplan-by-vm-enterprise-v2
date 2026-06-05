/**
 * GET    /api/tenant/sso/providers       — list providers for the workspace
 * POST   /api/tenant/sso/providers       — create a new provider (admin only)
 *
 * Stores client_secret encrypted via lib/crypto.encrypt(); the plaintext
 * never returns from the API. The list endpoint exposes a masked
 * client_secret_present boolean so the UI can show "Update secret" vs
 * "Set secret".
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { ssoProviders } from '@/drizzle/schema';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { encrypt } from '@/lib/crypto';

interface OidcProviderInput {
  name: string;
  issuer: string;
  client_id: string;
  client_secret?: string;
  email_domains: string[];
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  is_active?: boolean;
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isAdmin) {
    return NextResponse.json({ error: 'Admin required' }, { status: 403 });
  }

  const rows = await db
    .select({
      id: ssoProviders.id,
      providerType: ssoProviders.providerType,
      name: ssoProviders.name,
      config: ssoProviders.config,
      isActive: ssoProviders.isActive,
      createdAt: ssoProviders.createdAt,
      updatedAt: ssoProviders.updatedAt,
    })
    .from(ssoProviders)
    .where(and(eq(ssoProviders.tenantId, ctx.tenantId), isNull(ssoProviders.deletedAt)))
    .orderBy(desc(ssoProviders.createdAt));

  const data = rows.map((r) => maskProvider(r));
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuth(request);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isAdmin) {
    return NextResponse.json({ error: 'Admin required' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as OidcProviderInput | null;
  const validationError = validateInput(body, { secretRequired: true });
  if (validationError) return validationError;
  const v = body!;

  const config = buildEncryptedConfig(v);
  if (config instanceof NextResponse) return config;

  const [created] = await db
    .insert(ssoProviders)
    .values({
      tenantId: ctx.tenantId,
      providerType: 'oidc',
      name: v.name.trim(),
      config,
      isActive: v.is_active ?? false,
    })
    .returning({
      id: ssoProviders.id,
      providerType: ssoProviders.providerType,
      name: ssoProviders.name,
      config: ssoProviders.config,
      isActive: ssoProviders.isActive,
      createdAt: ssoProviders.createdAt,
      updatedAt: ssoProviders.updatedAt,
    });

  if (!created) {
    return NextResponse.json({ error: 'Failed to create provider' }, { status: 500 });
  }
  return NextResponse.json({ data: maskProvider(created) }, { status: 201 });
}

// ── helpers (also used by the [id] route via direct import) ────────────────

export function validateInput(
  body: OidcProviderInput | null,
  opts: { secretRequired: boolean },
): NextResponse | null {
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 });
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }
  if (!body.issuer || !/^https?:\/\//.test(body.issuer)) {
    return NextResponse.json(
      { error: 'issuer must be a fully-qualified https URL' },
      { status: 400 },
    );
  }
  if (!body.client_id || typeof body.client_id !== 'string') {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  }
  if (opts.secretRequired && !body.client_secret) {
    return NextResponse.json({ error: 'client_secret is required' }, { status: 400 });
  }
  if (
    !Array.isArray(body.email_domains) ||
    body.email_domains.length === 0 ||
    body.email_domains.some((d) => typeof d !== 'string' || !d.includes('.'))
  ) {
    return NextResponse.json(
      { error: 'email_domains must be a non-empty array of domain strings' },
      { status: 400 },
    );
  }
  return null;
}

export function buildEncryptedConfig(
  v: OidcProviderInput,
  existingEncryptedSecret?: string,
): Record<string, unknown> | NextResponse {
  const key = process.env['ENCRYPTION_KEY'];
  if (!key) {
    return NextResponse.json(
      { error: 'ENCRYPTION_KEY is not configured; cannot store SSO client_secret' },
      { status: 503 },
    );
  }
  const encryptedSecret = v.client_secret
    ? encrypt(v.client_secret, key)
    : existingEncryptedSecret;

  if (!encryptedSecret) {
    return NextResponse.json({ error: 'client_secret is missing' }, { status: 400 });
  }

  return {
    issuer: v.issuer.trim(),
    client_id: v.client_id.trim(),
    client_secret_enc: encryptedSecret,
    email_domains: v.email_domains.map((d) => d.toLowerCase().trim()),
    ...(v.authorization_endpoint ? { authorization_endpoint: v.authorization_endpoint.trim() } : {}),
    ...(v.token_endpoint ? { token_endpoint: v.token_endpoint.trim() } : {}),
    ...(v.jwks_uri ? { jwks_uri: v.jwks_uri.trim() } : {}),
  };
}

/** Hide the encrypted secret from API responses; surface a presence flag. */
export function maskProvider(row: {
  id: string;
  providerType: string;
  name: string;
  config: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date | null;
}) {
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const { client_secret_enc, ...publicCfg } = cfg as { client_secret_enc?: string };
  return {
    id: row.id,
    provider_type: row.providerType,
    name: row.name,
    is_active: row.isActive,
    config: publicCfg,
    client_secret_present: !!client_secret_enc,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
