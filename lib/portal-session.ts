/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { createHash } from 'crypto';
import { cookies } from 'next/headers';
import { db } from '@/drizzle/db';
import { portalClients } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export const PORTAL_SESSION_COOKIE = 'nucrm_portal_session';

export interface PortalSessionInfo {
  clientId: string;
  tenantId: string;
  name: string;
  email: string;
}

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

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Build the value stored in the portal session cookie.
 * Only the SHA-256 of the portal client's access token is stored — never the raw token.
 */
export function encodePortalSessionCookie(email: string, tenantId: string, accessToken: string): string {
  return Buffer.from(JSON.stringify({
    email,
    tenantId,
    tokenHash: hashToken(accessToken),
  }), 'utf8').toString('base64url');
}

export function portalSessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

/**
 * Server-side validation of the customer-portal session (Issue #1326).
 *
 * Reads `nucrm_portal_session`, then re-validates against the database:
 * the referenced portal client must exist, be active, and its access
 * token hash must still match with a non-expired grant. Returns null
 * for any absent/malformed/stale cookie so callers can redirect to login.
 */
export async function getPortalSession(): Promise<PortalSessionInfo | null> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(PORTAL_SESSION_COOKIE)?.value;
    if (!raw) return null;

    let parsed: { email?: string; tenantId?: string; tokenHash?: string };
    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    } catch {
      return null;
    }

    const email = typeof parsed.email === 'string' ? parsed.email : '';
    const tenantId = typeof parsed.tenantId === 'string' ? parsed.tenantId : '';
    const tokenHash = typeof parsed.tokenHash === 'string' ? parsed.tokenHash : '';
    if (!email || !tenantId || !tokenHash) return null;

    const [client] = await db
      .select({
        id: portalClients.id,
        tenantId: portalClients.tenantId,
        name: portalClients.name,
        email: portalClients.email,
        accessToken: portalClients.accessToken,
        isActive: portalClients.isActive,
        expiresAt: portalClients.expiresAt,
      })
      .from(portalClients)
      .where(and(
        eq(portalClients.email, email),
        eq(portalClients.tenantId, tenantId)
      ))
      .limit(1);

    if (!client) return null;
    if (client.isActive === false) return null;
    if (client.expiresAt <= new Date()) return null;
    if (!timingSafeEqual(hashToken(client.accessToken), tokenHash)) return null;

    return {
      clientId: client.id,
      tenantId: client.tenantId,
      name: client.name,
      email: client.email,
    };
  } catch (err) {
    console.error('[portal-session] validation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
