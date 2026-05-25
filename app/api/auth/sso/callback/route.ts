/**
 * GET /api/auth/sso/callback?code=...&state=...
 *
 * IdP redirects the browser here after the user authenticates. We verify
 * the state cookie, exchange the auth code for an ID token, verify the
 * token signature against the IdP's JWKS, upsert the user, attach them
 * to the provider's tenant, and create a session cookie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import {
  ssoProviders,
  ssoSessions,
  users,
  tenantMembers,
  roles,
  sessions,
} from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { exchangeAndVerify, type OidcProviderConfig } from '@/lib/auth/sso/oidc';
import { readSsoState, clearSsoState } from '@/lib/auth/sso/state';
import { createToken, hashToken, setSessionCookie } from '@/lib/auth/session';

const SESSION_TTL_DAYS = 30;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  // IdP can short-circuit with ?error=access_denied etc.
  if (errorParam) {
    await clearSsoState();
    return redirectToLogin(`SSO failed: ${errorParam}`);
  }
  if (!code || !stateParam) {
    await clearSsoState();
    return redirectToLogin('SSO callback missing code/state');
  }

  const stateCookie = await readSsoState();
  if (!stateCookie) {
    return redirectToLogin('SSO state expired or missing — try again');
  }
  if (stateCookie.state !== stateParam) {
    await clearSsoState();
    return redirectToLogin('SSO state mismatch');
  }

  const [provider] = await db
    .select({
      id: ssoProviders.id,
      tenantId: ssoProviders.tenantId,
      config: ssoProviders.config,
      isActive: ssoProviders.isActive,
    })
    .from(ssoProviders)
    .where(eq(ssoProviders.id, stateCookie.providerId))
    .limit(1);
  if (!provider || !provider.isActive) {
    await clearSsoState();
    return redirectToLogin('SSO provider is no longer available');
  }

  const cfg = provider.config as OidcProviderConfig;
  const redirectUri = absoluteCallbackUrl(request);

  // Token exchange + ID token verification. exchangeAndVerify checks
  // issuer, audience, signature, expiry, and nonce.
  let claims;
  try {
    claims = await exchangeAndVerify({
      provider: cfg,
      code,
      redirectUri,
      expectedNonce: stateCookie.nonce,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token verification failed';
    console.error('[sso/callback] token exchange/verify failed', msg);
    await clearSsoState();
    return redirectToLogin('Could not verify your SSO login');
  }

  const email = (claims.email || '').toLowerCase().trim();
  if (!email) {
    await clearSsoState();
    return redirectToLogin('Identity provider did not return an email');
  }
  // Belt-and-braces: the IdP may issue tokens for any user in their tenancy,
  // but only domains explicitly claimed in config get to log in.
  const allowedDomains = Array.isArray(cfg.email_domains) ? cfg.email_domains : [];
  if (!allowedDomains.map((d) => d.toLowerCase()).includes(email.split('@')[1] || '')) {
    await clearSsoState();
    return redirectToLogin('Your email domain is not authorised for this workspace');
  }

  // Upsert user + ensure they're a member of the provider's tenant.
  const userId = await upsertUserAndMembership({
    email,
    fullName: claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || null,
    tenantId: provider.tenantId,
    providerId: provider.id,
  });

  // Mint our normal session cookie (same flow as password login), plus
  // record an sso_sessions row so admins can audit / revoke.
  const sessionToken = await createToken(userId);
  const tokenHash = await hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown',
    userAgent: request.headers.get('user-agent')?.slice(0, 255),
  });

  await db.insert(ssoSessions).values({
    userId,
    tenantId: provider.tenantId,
    providerId: provider.id,
    sessionId: tokenHash, // links to our session row by the same hash
    idToken: null, // we don't persist the raw token; the verified claims are enough
    samlAssertion: null,
    expiresAt,
  });

  await setSessionCookie(sessionToken);
  await clearSsoState();

  const dest = stateCookie.redirectTo && stateCookie.redirectTo.startsWith('/')
    ? stateCookie.redirectTo
    : '/tenant';
  return NextResponse.redirect(new URL(dest, request.url), 302);
}

/**
 * Find-or-create the user, set lastTenantId so they land in the SSO tenant,
 * and ensure a tenant_members row exists with a sane default role.
 */
async function upsertUserAndMembership(args: {
  email: string;
  fullName: string | null;
  tenantId: string;
  providerId: string;
}): Promise<string> {
  // 1. user
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, args.email))
    .limit(1);

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    await db
      .update(users)
      .set({
        emailVerified: true,
        lastTenantId: args.tenantId,
        updatedAt: new Date(),
        ...(args.fullName ? { fullName: args.fullName } : {}),
      })
      .where(eq(users.id, userId));
  } else {
    const [created] = await db
      .insert(users)
      .values({
        email: args.email,
        fullName: args.fullName ?? args.email,
        emailVerified: true,
        lastTenantId: args.tenantId,
      })
      .returning({ id: users.id });
    if (!created) throw new Error('Failed to create user');
    userId = created.id;
  }

  // 2. membership — pick a default role for the tenant (sales_rep if it exists, else admin)
  const [existingMember] = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, args.tenantId), eq(tenantMembers.userId, userId)))
    .limit(1);

  if (!existingMember) {
    const [defaultRole] = await db
      .select({ id: roles.id, slug: roles.slug })
      .from(roles)
      .where(and(eq(roles.tenantId, args.tenantId), eq(roles.slug, 'sales_rep')))
      .limit(1);

    const fallbackRole =
      defaultRole ??
      (
        await db
          .select({ id: roles.id, slug: roles.slug })
          .from(roles)
          .where(and(eq(roles.tenantId, args.tenantId), eq(roles.slug, 'admin')))
          .limit(1)
      )[0];

    if (fallbackRole) {
      await db.insert(tenantMembers).values({
        tenantId: args.tenantId,
        userId,
        roleId: fallbackRole.id,
        roleSlug: fallbackRole.slug,
        status: 'active',
        joinedAt: new Date(),
      });
    }
  } else {
    // Reactivate an existing-but-inactive member silently — admins removed
    // them, IdP says they're back. The audit trail in sso_sessions records
    // the SSO sign-in regardless.
    await db
      .update(tenantMembers)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(tenantMembers.id, existingMember.id));
  }

  return userId;
}

function absoluteCallbackUrl(request: NextRequest): string {
  const base = process.env['NEXT_PUBLIC_APP_URL'] || `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  return `${base.replace(/\/$/, '')}/api/auth/sso/callback`;
}

function redirectToLogin(message: string): NextResponse {
  const base = process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';
  const url = new URL('/auth/login', base);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url, 302);
}
