/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { portalClients, platformSettings } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { withPortalLookupContext, withTenantContext, NO_USER_SENTINEL, type RlsTransaction } from '@/lib/db/rls';
import { readJsonBody } from '@/lib/api/validate';
import { rateLimiter } from '@/lib/rate-limit';
import { PORTAL_SESSION_COOKIE, encodePortalSessionCookie, portalSessionCookieOptions } from '@/lib/portal-session';
import { requestIsHttps } from '@/lib/auth/cookie-security';
import { logError } from '@/lib/errors-server';

const PORTAL_CONFIG_KEY = 'portal_config';

/** Constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const aPadded = a.padEnd(maxLen, '\0');
  const bPadded = b.padEnd(maxLen, '\0');
  let result = 0;
  for (let i = 0; i < maxLen; i++) {
    result |= aPadded.charCodeAt(i) ^ bPadded.charCodeAt(i);
  }
  return result === 0 && a.length === b.length;
}

/**
 * The workspace's own `portal_config` row. Takes `tx` because it is only ever
 * readable inside a portal lookup context (#2446): `platform_settings` carries
 * `tenant_isolation`, whose USING clause needs `app.current_tenant` — a value an
 * anonymous "is this portal on?" probe does not have, because learning it is the
 * point of the query. On the bare pool this returned no row, so
 * `config.enabled` was falsy and every portal login answered 403 "Portal not
 * enabled" for a portal that is switched on. 0122 gives this read a policy keyed
 * on (tenant_id, key = 'portal_config'), so it can see this one row and nothing
 * else on the table.
 */
async function readPortalConfig(tx: RlsTransaction, tenantId: string) {
  const [setting] = await tx
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(and(
      eq(platformSettings.tenantId, tenantId),
      eq(platformSettings.key, PORTAL_CONFIG_KEY)
    ))
    .limit(1);

  // platform_settings.value is jsonb: the pg driver already returns a parsed
  // object. Older rows may hold a JSON string — handle both (#1982).
  const rawValue = setting?.value;
  if (typeof rawValue === 'object' && rawValue !== null) return rawValue as Record<string, unknown>;
  if (typeof rawValue === 'string' && rawValue) {
    try { return JSON.parse(rawValue) as Record<string, unknown>; } catch { /* fall through */ }
  }
  return { enabled: false };
}

export async function POST(request: NextRequest) {
  try {
    const { email, token, tenant_id } = await readJsonBody(request);

    if (!email || !token || !tenant_id) {
      return NextResponse.json({ error: 'Email, token, and tenant_id required' }, { status: 400 });
    }

    // Validate tenant_id format (UUID) to prevent injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenant_id)) {
      return NextResponse.json({ error: 'Invalid tenant_id format' }, { status: 400 });
    }

    // Rate limit: max 10 login attempts per email per 15 minutes
    const rateLimitKey = `portal_login:${email}`;
    const { allowed } = await rateLimiter.check(rateLimitKey, 10, 15 * 60 * 1000);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many login attempts. Please try again later.' }, { status: 429 });
    }

    // #2446: both reads below are pre-tenant, so neither could see anything on
    // the bare pool — `config.enabled` was falsy (403 "Portal not enabled" for an
    // enabled portal) and the client lookup returned no row ("Invalid
    // credentials" no matter what was typed). They now share ONE
    // withPortalLookupContext: one transaction, one set_config statement (PP-028
    // prices each extra one at a flat ~200 ms), and the narrowest SELECT 0122
    // offers — this workspace's `portal_config` row and this (tenant, email)
    // client row, nothing else. Read-only by construction, so a bug further down
    // this handler still cannot write through a context an anonymous caller
    // named a tenant into.
    const { config, client } = await withPortalLookupContext(
      { tenantId: tenant_id, email },
      async (tx) => {
        const cfg = await readPortalConfig(tx, tenant_id);
        // #2459: this row *is* a bearer credential — `access_token` is what the
        // comparison below tests and what the session cookie is built from, and
        // reading the whole 10-column row is exactly what turned a `client`
        // spread into the response into a credential leak. Five of the table's
        // columns are named here; the other five never leave the query.
        const [row] = await tx
          .select({
            id: portalClients.id,
            name: portalClients.name,
            email: portalClients.email,
            accessToken: portalClients.accessToken,
            expiresAt: portalClients.expiresAt,
          })
          .from(portalClients)
          .where(and(
            eq(portalClients.email, email),
            eq(portalClients.tenantId, tenant_id),
            eq(portalClients.isActive, true)
          ))
          .limit(1);
        return { config: cfg, client: row ?? null };
      },
    );

    if (!config.enabled) {
      return NextResponse.json({ error: 'Portal not enabled' }, { status: 403 });
    }

    if (!client) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Use constant-time comparison to prevent timing attacks
    const isValid = timingSafeEqual(client.accessToken, token) && client.expiresAt > new Date();
    if (!isValid) {
      return NextResponse.json({ error: 'Token expired or invalid' }, { status: 401 });
    }

    const sessionExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // A write, so a different context: the lookup above is SELECT-only and knows
    // no tenant. `tenant_isolation` is what admits this UPDATE, and the tenant it
    // is scoped to is the one this request's own credential just resolved a live
    // client row in — never a value the body supplied. NO_USER_SENTINEL because
    // there is no CRM user behind a portal login (same shape as
    // app/api/public/invoices and app/api/track/open).
    await withTenantContext(tenant_id, NO_USER_SENTINEL, (tx) =>
      tx
        .update(portalClients)
        .set({ lastLoginAt: new Date() })
        .where(eq(portalClients.id, client.id)),
    );

    // #1179: the session of record is the httpOnly `nucrm_portal_session` cookie
    // set below (validated server-side by getPortalSession(), and revocable by
    // deactivating/expiring the portal client or rotating its access token).
    // We no longer return a random uuid "session.token": it was never stored or
    // validated by anything, so it was a misleading, unrevocable dead token that
    // also sat readable in the client's localStorage.
    const response = NextResponse.json({
      ok: true,
      session: {
        expiresAt: sessionExpiry,
      },
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
      },
      permissions: {
        quotes: config.allow_quotes,
        invoices: config.allow_invoices,
        cases: config.allow_cases,
      },
    });

    // Server-visible session cookie so the /portal layout can gate pages
    // server-side (Issue #1326). Stores only a hash of the access token.
    response.cookies.set(
      PORTAL_SESSION_COOKIE,
      encodePortalSessionCookie(client.email, tenant_id, client.accessToken),
      portalSessionCookieOptions(sessionExpiry, requestIsHttps(request))
    );

    return response;
 
 
  } catch (err) {
    await logError({ error: err, context: 'portal login', requestMethod: 'POST' });
    return apiError(err);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant_id = searchParams.get('tenant_id');

    if (!tenant_id) {
      return NextResponse.json({ error: 'Tenant ID required' }, { status: 400 });
    }

    // #2446: the same pre-tenant read as POST, alone this time — this endpoint
    // answers "is this workspace's portal on, and what may it show", which is by
    // design open to the embedded login widget, and nothing else on
    // platform_settings (0122 freezes the key into the policy).
    const config = await withPortalLookupContext({ tenantId: tenant_id }, (tx) => readPortalConfig(tx, tenant_id));

    return NextResponse.json({
      enabled: config.enabled,
      features: {
        quotes: config.allow_quotes,
        invoices: config.allow_invoices,
        cases: config.allow_cases,
      },
    });
 
 
  } catch (err) {
    await logError({ error: err, context: 'portal status', requestMethod: 'GET' });
    return apiError(err);
  }
}