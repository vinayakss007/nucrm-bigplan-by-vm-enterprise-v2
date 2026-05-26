/**
 * GET /api/auth/sso/discover?email=user@acme.com
 *
 * Public endpoint used by the login page to detect whether a given email
 * domain has an active SSO provider. Returns minimal info — just enough
 * to render a "Continue with <Provider>" button. Does NOT reveal anything
 * about the configured client_id / issuer / etc.
 *
 * Always returns 200 with { sso: boolean, providerName?: string } so the
 * caller doesn't need special-case error handling for the no-SSO path
 * (which is the common case).
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { ssoProviders } from '@/drizzle/schema';
import { eq, and, sql, isNull } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.json({ sso: false });
  }
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) {
    return NextResponse.json({ sso: false });
  }

  const candidates = await db
    .select({
      id: ssoProviders.id,
      name: ssoProviders.name,
      providerType: ssoProviders.providerType,
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
    return NextResponse.json({ sso: false });
  }
  return NextResponse.json({
    sso: true,
    providerName: row.name,
    providerType: row.providerType,
  });
}
