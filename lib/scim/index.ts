/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * SCIM 2.0 Protocol Handler
 *
 * Provides utilities for parsing SCIM filter expressions, converting between
 * internal user representations and SCIM User resources, generating SCIM
 * ListResponse payloads, and verifying SCIM bearer tokens.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644
 * @see https://datatracker.ietf.org/doc/html/rfc7643
 */

import { timingSafeEqual, createHmac } from 'crypto';
import { z } from 'zod';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Runtime validation schema for an inbound SCIM User payload (#1270).
 * IdPs send arbitrary JSON, so POST/PATCH handlers must validate the body at
 * runtime rather than trusting a TypeScript `as SCIMUser` cast, which offers no
 * protection against malformed or unexpected fields. Unknown top-level keys are
 * stripped by Zod's default object parsing.
 */
export const scimUserSchema = z.object({
  schemas: z.array(z.string()).optional(),
  id: z.string().optional(),
  externalId: z.string().optional(),
  userName: z.string().optional(),
  name: z
    .object({
      formatted: z.string().optional(),
      familyName: z.string().optional(),
      givenName: z.string().optional(),
    })
    .optional(),
  displayName: z.string().optional(),
  emails: z
    .array(
      z.object({
        value: z.string(),
        type: z.string().optional(),
        primary: z.boolean().optional(),
      }),
    )
    .optional(),
  active: z.boolean().optional(),
  meta: z
    .object({
      resourceType: z.string().optional(),
      created: z.string().optional(),
      lastModified: z.string().optional(),
      location: z.string().optional(),
    })
    .optional(),
});

export interface SCIMUser {
  schemas: string[];
  id?: string;
  externalId?: string;
  userName: string;
  name?: {
    formatted?: string;
    familyName?: string;
    givenName?: string;
  };
  displayName?: string;
  emails?: Array<{
    value: string;
    type?: string;
    primary?: boolean;
  }>;
  active?: boolean;
  meta?: {
    resourceType: string;
    created?: string;
    lastModified?: string;
    location?: string;
  };
}

export interface SCIMListResponse {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: SCIMUser[];
}

export interface SCIMError {
  schemas: string[];
  detail: string;
  status: string;
}

export interface InternalUser {
  id: string;
  email: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  active?: boolean;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

export interface ParsedFilter {
  attribute: string;
  operator: string;
  value: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

// ── Filter Parsing ───────────────────────────────────────────────────────────

/**
 * Parse a SCIM filter expression.
 *
 * Supports simple filters like:
 *   userName eq "user@example.com"
 *   displayName co "John"
 *   active eq "true"
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.2.2
 */
export function parseSCIMFilter(filter: string): ParsedFilter | null {
  if (!filter || typeof filter !== 'string') {
    return null;
  }

  const trimmed = filter.trim();

  // Match pattern: attribute operator "value" or attribute operator value
  const match = trimmed.match(
    /^(\w+(?:\.\w+)?)\s+(eq|ne|co|sw|ew|gt|ge|lt|le|pr)\s+"?([^"]*)"?$/i
  );

  if (!match) {
    return null;
  }

  const [, attribute, operator, value] = match;
  if (!attribute || !operator) {
    return null;
  }

  return {
    attribute: attribute.toLowerCase(),
    operator: operator.toLowerCase(),
    value: value ?? '',
  };
}

// ── User Conversion ──────────────────────────────────────────────────────────

/**
 * Convert an internal user record to a SCIM User resource.
 */
export function toSCIMUser(user: InternalUser, baseUrl?: string): SCIMUser {
  const nameParts = splitFullName(user.fullName, user.firstName, user.lastName);

  const scimUser: SCIMUser = {
    schemas: [SCIM_USER_SCHEMA],
    id: user.id,
    userName: user.email,
    name: {
      formatted: user.fullName || `${nameParts.givenName} ${nameParts.familyName}`.trim(),
      familyName: nameParts.familyName,
      givenName: nameParts.givenName,
    },
    displayName: user.fullName || `${nameParts.givenName} ${nameParts.familyName}`.trim(),
    emails: [
      {
        value: user.email,
        type: 'work',
        primary: true,
      },
    ],
    active: user.active !== false,
    meta: {
      resourceType: 'User',
      created: formatDate(user.createdAt),
      lastModified: formatDate(user.updatedAt),
      ...(baseUrl ? { location: `${baseUrl}/scim/v2/Users/${user.id}` } : {}),
    },
  };

  return scimUser;
}

/**
 * Convert a SCIM User resource to internal user format.
 */
export function fromSCIMUser(scimUser: SCIMUser): Partial<InternalUser> {
  const primaryEmail = scimUser.emails?.find((e) => e.primary)?.value
    ?? scimUser.emails?.[0]?.value
    ?? scimUser.userName;

  const firstName = scimUser.name?.givenName ?? null;
  const lastName = scimUser.name?.familyName ?? null;

  let fullName: string | null = null;
  if (scimUser.name?.formatted) {
    fullName = scimUser.name.formatted;
  } else if (firstName || lastName) {
    fullName = [firstName, lastName].filter(Boolean).join(' ');
  } else if (scimUser.displayName) {
    fullName = scimUser.displayName;
  }

  return {
    email: primaryEmail,
    fullName,
    firstName,
    lastName,
    active: scimUser.active !== false,
    ...(scimUser.id ? { id: scimUser.id } : {}),
  };
}

// ── Response Generation ──────────────────────────────────────────────────────

/**
 * Generate a SCIM ListResponse.
 */
export function generateSCIMResponse(
  resources: SCIMUser[],
  totalResults: number,
  startIndex: number
): SCIMListResponse {
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

/**
 * Generate a SCIM error response body.
 */
export function generateSCIMError(detail: string, status: number): SCIMError {
  return {
    schemas: [SCIM_ERROR_SCHEMA],
    detail,
    status: String(status),
  };
}

// ── Token Verification ───────────────────────────────────────────────────────

/**
 * Verify a SCIM bearer token and extract the tenant ID.
 *
 * Token format (v2): "<tenantId>:<expiryMs>:<hmac>"
 *   - hmac = HMAC-SHA256(secret, "<tenantId>:<expiryMs>")
 *   - Token is rejected if expiryMs < now
 *
 * Token format (v1, deprecated): raw HMAC-SHA256(secret, tenantId)
 *   - Kept for backward compatibility; caller must still supply tenantId.
 *
 * Returns { tenantId } on success, null on failure.
 */
export async function verifySCIMToken(
  token: string,
  fallbackTenantId: string,
): Promise<{ tenantId: string } | null> {
  if (!token) {
    return null;
  }

  const secret = process.env['SCIM_SECRET'];
  if (!secret) {
    return null;
  }

  // ── v2 token: tenantId:expiryMs:hmac ──
  const parts = token.split(':');
  if (parts.length === 3) {
    const [tenantId, expiryStr, providedHmac] = parts;
    if (!tenantId || !expiryStr || !providedHmac) return null;

    const expiryMs = parseInt(expiryStr, 10);
    if (Number.isNaN(expiryMs) || Date.now() > expiryMs) {
      return null; // expired or malformed
    }

    try {
      const expectedHmac = createHmac('sha256', secret)
        .update(`${tenantId}:${expiryStr}`)
        .digest('hex');

      const tokenBuf = Buffer.from(providedHmac, 'utf8');
      const expectedBuf = Buffer.from(expectedHmac, 'utf8');

      if (tokenBuf.length !== expectedBuf.length) return null;
      if (!timingSafeEqual(tokenBuf, expectedBuf)) return null;

      return { tenantId };
    } catch {
      return null;
    }
  }

  // ── v1 token (deprecated): raw HMAC of tenantId ──
  //
  // v1 tokens NEVER expire and derive the tenant from the client-supplied
  // `x-tenant-id` header, so their only assurance is "knows the global
  // SCIM_SECRET" — there is no per-token expiry or self-contained tenant
  // binding. createSCIMToken only ever mints v2 tokens, so nothing issues v1
  // anymore. It is therefore rejected by default and only accepted when an
  // operator explicitly opts in via SCIM_ALLOW_V1_TOKENS=true (e.g. during a
  // migration window). Rotate to v2 tokens and drop the flag.
  if (process.env['SCIM_ALLOW_V1_TOKENS'] !== 'true') {
    return null;
  }
  if (fallbackTenantId) {
    try {
      const expectedHmac = createHmac('sha256', secret)
        .update(fallbackTenantId)
        .digest('hex');

      const tokenBuf = Buffer.from(token, 'utf8');
      const expectedBuf = Buffer.from(expectedHmac, 'utf8');

      if (tokenBuf.length !== expectedBuf.length) return null;
      if (!timingSafeEqual(tokenBuf, expectedBuf)) return null;

      warnV1TokenAccepted();
      return { tenantId: fallbackTenantId };
    } catch {
      return null;
    }
  }

  return null;
}

let _v1WarnedAt = 0;
/** Warn (throttled) whenever a deprecated v1 SCIM token is accepted. */
function warnV1TokenAccepted(): void {
  const now = Date.now();
  if (now - _v1WarnedAt >= 60_000) {
    _v1WarnedAt = now;
    console.warn(
      '[SCIM] Accepted a deprecated v1 bearer token (SCIM_ALLOW_V1_TOKENS=true). ' +
      'v1 tokens never expire and trust the client x-tenant-id header — rotate to v2 tokens and unset the flag.',
    );
  }
}

// ── Token Creation ───────────────────────────────────────────────────────────

/**
 * Create a SCIM bearer token for a tenant.
 *
 * Returns a v2 token: "<tenantId>:<expiryMs>:<hmac>"
 * Default expiry: 24 hours.
 */
export function createSCIMToken(tenantId: string, expiresInSeconds: number = 86400): string | null {
  const secret = process.env['SCIM_SECRET'];
  if (!secret || !tenantId) {
    return null;
  }

  const expiryMs = Date.now() + expiresInSeconds * 1000;
  const hmac = createHmac('sha256', secret)
    .update(`${tenantId}:${expiryMs}`)
    .digest('hex');

  return `${tenantId}:${expiryMs}:${hmac}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function splitFullName(
  fullName?: string | null,
  firstName?: string | null,
  lastName?: string | null
): { givenName: string; familyName: string } {
  if (firstName || lastName) {
    return {
      givenName: firstName ?? '',
      familyName: lastName ?? '',
    };
  }

  if (!fullName) {
    return { givenName: '', familyName: '' };
  }

  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { givenName: parts[0] ?? '', familyName: '' };
  }

  return {
    givenName: parts[0] ?? '',
    familyName: parts.slice(1).join(' '),
  };
}

function formatDate(date?: Date | string | null): string {
  if (!date) return new Date().toISOString();
  if (date instanceof Date) return date.toISOString();
  return new Date(date).toISOString();
}
