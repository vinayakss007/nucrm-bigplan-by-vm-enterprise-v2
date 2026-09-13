/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import type { NextRequest } from 'next/server';
import { db } from '@/drizzle/db';
import { contacts, portalClients } from '@/drizzle/schema';
import { eq, and, gt } from 'drizzle-orm';
import { getPortalSession } from '@/lib/portal-session';

export interface PortalIdentity {
  email: string;
  tenantId: string;
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
 */
export async function resolvePortalIdentity(request: NextRequest): Promise<PortalIdentity | null> {
  const token = request.headers.get('x-portal-token');
  if (token) {
    const [portalClient] = await db
      .select({ email: portalClients.email, tenantId: portalClients.tenantId })
      .from(portalClients)
      .where(and(
        eq(portalClients.accessToken, token),
        eq(portalClients.isActive, true),
        gt(portalClients.expiresAt, new Date()),
      ))
      .limit(1);
    if (!portalClient) return null;
    return { email: portalClient.email, tenantId: portalClient.tenantId };
  }

  const session = await getPortalSession();
  if (!session) return null;
  return { email: session.email, tenantId: session.tenantId };
}

export interface PortalContact {
  id: string;
  tenantId: string;
}

/**
 * Resolve the CRM contact for an authenticated portal identity, always
 * scoped to (email, tenantId) so one tenant's email can never resolve
 * another tenant's contact (#1913 / #1982).
 */
export async function resolvePortalContact(identity: PortalIdentity): Promise<PortalContact | null> {
  const [contact] = await db
    .select({ id: contacts.id, tenantId: contacts.tenantId })
    .from(contacts)
    .where(and(
      eq(contacts.email, identity.email),
      eq(contacts.tenantId, identity.tenantId),
    ))
    .limit(1);
  return contact ?? null;
}
