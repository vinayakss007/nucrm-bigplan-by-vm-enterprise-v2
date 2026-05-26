/**
 * GET /api/auth/sso/start?email=user@acme.com[&redirect=/tenant]
 *
 * Look up the OIDC provider that claims the user's email domain, sign a
 * state cookie, and redirect to the IdP authorize URL. The IdP will land
 * the user back on /api/auth/sso/callback after authentication.
 *
 * 404 when no active provider claims the domain — the caller can fall
 * back to password login.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { ssoProviders } from '@/drizzle/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';
import {
  domainsFor,
  getAuthorizeUrl,
  loadProviderConfig,
  randomToken,
} from '@/lib/auth/sso/oidc';
import { setSsoState } from '@/lib/auth/sso/state';
import { decrypt } from '@/lib/crypto';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  const redirectTo = url.searchParams.get('redirect') || '/tenant';

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) {
    return NextResponse.json({ error: 'email is malformed' }, { status: 400 });
  }

  // Pull every active OIDC provider whose config.email_domains contains the
  // domain. The `?` JSONB operator checks for an array element when the
  // value at that path is a JSON array.
  const candidates = await db
    .select({
      id: ssoProviders.id,
      tenantId: ssoProviders.tenantId,
      config: ssoProviders.config,
    })
    .from(ssoProviders)
    .where(
      and(
        eq(ssoProviders.providerType, 'oidc'),
        eq(ssoProviders.isActive, true),
        isNull(ssoProviders.deletedAt),
        sql`${ssoProviders.config}->'email_domains' ? ${domain}`,
      ),
    )
    .limit(1);

  const row = candidates[0];
  if (!row) {
    return NextResponse.json(
      { error: `No SSO provider is configured for ${domain}` },
      { status: 404 },
    );
  }

  let cfg;
  try {
    cfg = loadProviderConfig(row.config, decrypt);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Provider config could not be decrypted';
    console.error('[sso/start] decrypt failed', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  // Defence in depth: domain match should already be true via the SQL filter,
  // but reject if the JSON shape was tampered with at write time.
  if (!domainsFor(cfg).includes(domain)) {
    return NextResponse.json({ error: 'Provider config rejected the domain' }, { status: 400 });
  }
  if (!cfg.issuer || !cfg.client_id || !cfg.client_secret) {
    return NextResponse.json(
      { error: 'Provider is misconfigured (missing issuer / client credentials)' },
      { status: 500 },
    );
  }

  const state = randomToken(24);
  const nonce = randomToken(24);
  const redirectUri = absoluteCallbackUrl(request);

  await setSsoState({
    providerId: row.id,
    tenantId: row.tenantId,
    state,
    nonce,
    redirectTo,
  });

  let authorizeUrl: string;
  try {
    authorizeUrl = await getAuthorizeUrl({
      provider: cfg,
      redirectUri,
      state,
      nonce,
      loginHint: email,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not build authorize URL';
    console.error('[sso/start] discovery/authorize failed', msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.redirect(authorizeUrl, 302);
}

function absoluteCallbackUrl(request: NextRequest): string {
  const base = process.env['NEXT_PUBLIC_APP_URL'] || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  return `${base.replace(/\/$/, '')}/api/auth/sso/callback`;
}
