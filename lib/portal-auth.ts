/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { NextRequest } from 'next/server';
import { contacts, portalClients, platformSettings } from '@/drizzle/schema';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { getPortalSession } from '@/lib/portal-session';
import type { RlsTransaction } from '@/lib/db/rls';
import { withPortalLookupContext } from '@/lib/db/portal-lookup-context';

export interface PortalIdentity {
  email: string;
  tenantId: string;
}

/**
 * #4091: an explicit `portal_config.enabled = false` must close every
 * customer-facing surface, not just /portal/login. A missing row (or a legacy
 * row without the flag) keeps the historical behaviour — this only honours an
 * explicit opt-out. Errors fail open here because identity validation itself
 * already decided who the caller is; a config read outage must not lock every
 * customer out of an enabled portal.
 */
async function portalExplicitlyDisabled(tenantId: string): Promise<boolean> {
  try {
    return await withPortalLookupContext({ tenantId }, async (tx) => {
      const [row] = await tx
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(and(
          eq(platformSettings.tenantId, tenantId),
          eq(platformSettings.key, 'portal_config'),
        ))
        .limit(1);
      const raw = row?.value;
      const config = typeof raw === 'string' ? JSON.parse(raw) as Record<string, unknown> : raw;
      return config?.['enabled'] === false;
    });
  } catch {
    return false;
  }
}

/**
 * Resolve the caller's customer-portal identity (#1133 / #1913).
 *
 * The old `x-portal-email` header was spoofable (plain client-controlled
 * string) and must never be trusted. Identity is established one of two ways:
 *
 * 1. `x-portal-token` header — opaque access token for non-browser callers
 *    (embeds, integrations). Validated against an active, unexpired
 *    `portal_clients` row.
 * 2. `nucrm_portal_session` httpOnly cookie — set at portal login and
 *    validated server-side by `getPortalSession()`. Browser `fetch()`
 *    same-origin calls send it automatically, so the portal UI needs no
 *    auth headers at all.
 *
 * Returns null when neither credential is present/valid (caller → 401).
 *
 * #2446 — the token branch is a pre-tenant read, and it was being made on the
 * bare pool. `portal_clients` has one policy, `tenant_isolation`, comparing
 * `tenant_id` to `app.current_tenant`, which is exactly the value this lookup
 * exists to discover; unset, the fail-closed deparse returns nothing rather
 * than raising, so a valid `x-portal-token` authenticated as *nobody* and every
 * portal route 401ed. The read now runs inside `withPortalLookupContext()`,
 * whose GUC 0122's policy matches against `access_token` — one row, the row the
 * presented credential names. The cookie branch's read is scoped the same way
 * inside `getPortalSession()`.
 */
export async function resolvePortalIdentity(request: NextRequest): Promise<PortalIdentity | null> {
  const token = request.headers.get('x-portal-token');
  if (token) {
    const portalClient = await withPortalLookupContext({ accessToken: token }, async (tx) => {
      const [row] = await tx
        .select({ email: portalClients.email, tenantId: portalClients.tenantId })
        .from(portalClients)
        .where(and(
          eq(portalClients.accessToken, token),
          eq(portalClients.isActive, true),
          gt(portalClients.expiresAt, new Date()),
        ))
        .limit(1);
      return row ?? null;
    });
    if (!portalClient) return null;
    if (await portalExplicitlyDisabled(portalClient.tenantId)) return null;
    return { email: portalClient.email, tenantId: portalClient.tenantId };
  }

  const session = await getPortalSession();
  if (!session) return null;
  if (await portalExplicitlyDisabled(session.tenantId)) return null;
  return { email: session.email, tenantId: session.tenantId };
}

export interface PortalContact {
  id: string;
  tenantId: string;
}

/**
 * Resolve the CRM contact for an authenticated portal identity, always
 * scoped to (email, tenantId) so one tenant's email can never resolve
 * another tenant's contact (#1913 / #1982). A tombstoned contact resolves to
 * nobody: deleting the customer ends their portal access (#2382).
 *
 * `tx` is REQUIRED, not optional (#2446). The `contacts` policy compares
 * `tenant_id` to `app.current_tenant`, so from the bare pool this lookup either
 * aborts (that table's strict arm raises on an unset GUC, #2438) or matches
 * nothing — and a caller that got nothing back reads as "this customer has no
 * contact", which is how an unreadable portal stayed invisible for a whole
 * release. It has to be the same transaction as the reads and writes that follow
 * it, because that is where the GUC lives, so the only honest signature is one
 * that cannot be called without it.
 */
export async function resolvePortalContact(
  identity: PortalIdentity,
  tx: RlsTransaction,
): Promise<PortalContact | null> {
  const [contact] = await tx
    .select({ id: contacts.id, tenantId: contacts.tenantId })
    .from(contacts)
    .where(and(
      eq(contacts.email, identity.email),
      eq(contacts.tenantId, identity.tenantId),
      isNull(contacts.deletedAt),
    ))
    .limit(1);
  return contact ?? null;
}
