/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * SCIM 2.0 Users Endpoint
 *
 * GET  /api/scim/v2/Users  - List/search users (with filter, pagination)
 * POST /api/scim/v2/Users  - Create (provision) a user from the IdP
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.4
 */

import { NextRequest, NextResponse } from 'next/server';
import { logError } from '@/lib/errors-server';
import { escapeLike } from '@/lib/api/sanitize-like';
import { selectLeastPrivilegeRole } from '@/lib/auth/default-role';
import { db } from '@/drizzle/db';
import { users, tenantMembers, roles } from '@/drizzle/schema';
import { eq, and, ilike, sql } from 'drizzle-orm';
import {
  parseSCIMFilter,
  toSCIMUser,
  fromSCIMUser,
  generateSCIMResponse,
  generateSCIMError,
  verifySCIMToken,
  scimUserSchema,
  type SCIMUser,
} from '@/lib/scim';

// ── Auth Helper ──────────────────────────────────────────────────────────────

async function authenticateSCIM(
  request: NextRequest
): Promise<{ tenantId: string } | NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      generateSCIMError('Bearer token required', 401),
      { status: 401, headers: { 'Content-Type': 'application/scim+json' } }
    );
  }

  const token = authHeader.slice(7);
  // Accept tenant ID from header as fallback for v1 tokens;
  // v2 tokens embed the tenant ID and ignore the header value.
  const headerTenantId = request.headers.get('x-tenant-id') ?? '';

  const result = await verifySCIMToken(token, headerTenantId);
  if (!result) {
    return NextResponse.json(
      generateSCIMError('Invalid or expired SCIM token', 401),
      { status: 401, headers: { 'Content-Type': 'application/scim+json' } }
    );
  }

  return { tenantId: result.tenantId };
}

// ── GET: List/Search Users ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authResult = await authenticateSCIM(request);
  if (authResult instanceof NextResponse) return authResult;
  const { tenantId } = authResult;

  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') ?? undefined;
  const startIndex = Math.max(1, parseInt(url.searchParams.get('startIndex') ?? '1', 10));
  const count = Math.min(100, Math.max(1, parseInt(url.searchParams.get('count') ?? '100', 10)));

  try {
    // Build query conditions
    const conditions = [eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.status, 'active')];

    // Apply filter if present
    if (filter) {
      const parsed = parseSCIMFilter(filter);
      if (parsed) {
        if (parsed.attribute === 'username' || parsed.attribute === 'emails.value') {
          if (parsed.operator === 'eq') {
            conditions.push(eq(users.email, parsed.value));
          } else if (parsed.operator === 'co') {
            conditions.push(ilike(users.email, `%${escapeLike(parsed.value)}%`));
          } else if (parsed.operator === 'sw') {
            conditions.push(ilike(users.email, `${escapeLike(parsed.value)}%`));
          }
        } else if (parsed.attribute === 'displayname') {
          if (parsed.operator === 'eq') {
            conditions.push(eq(users.fullName, parsed.value));
          } else if (parsed.operator === 'co') {
            conditions.push(ilike(users.fullName, `%${escapeLike(parsed.value)}%`));
          }
        }
      }
    }

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
      .where(and(...conditions));

    const totalResults = Number(countResult?.count ?? 0);

    // Fetch paginated results
    const offset = startIndex - 1; // SCIM is 1-indexed
    const results = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
      .where(and(...conditions))
      .limit(count)
      .offset(offset);

    const baseUrl = `${url.protocol}//${url.host}/api`;
    const scimUsers: SCIMUser[] = results.map((user) =>
      toSCIMUser(
        {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          active: true,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        baseUrl
      )
    );

    const response = generateSCIMResponse(scimUsers, totalResults, startIndex);

    return NextResponse.json(response, {
      status: 200,
      headers: { 'Content-Type': 'application/scim+json' },
    });
  } catch (error) {
    void logError({ error, context: 'scim/Users GET' });
    return NextResponse.json(
      generateSCIMError('Internal server error', 500),
      { status: 500, headers: { 'Content-Type': 'application/scim+json' } }
    );
  }
}

// ── POST: Create (Provision) User ────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authResult = await authenticateSCIM(request);
  if (authResult instanceof NextResponse) return authResult;
  const { tenantId } = authResult;

  try {
    const parsedBody = scimUserSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json(
        generateSCIMError('Invalid SCIM User payload', 400),
        { status: 400, headers: { 'Content-Type': 'application/scim+json' } }
      );
    }
    const body = parsedBody.data as SCIMUser;

    if (!body.schemas?.includes('urn:ietf:params:scim:schemas:core:2.0:User')) {
      return NextResponse.json(
        generateSCIMError('Invalid schema. Expected urn:ietf:params:scim:schemas:core:2.0:User', 400),
        { status: 400, headers: { 'Content-Type': 'application/scim+json' } }
      );
    }

    const internalUser = fromSCIMUser(body);

    if (!internalUser.email) {
      return NextResponse.json(
        generateSCIMError('userName (email) is required', 400),
        { status: 400, headers: { 'Content-Type': 'application/scim+json' } }
      );
    }

    // #1171: users are shared across tenants (membership lives in
    // tenant_members), so an unscoped email lookup let one tenant's IdP mutate
    // a user account owned/used by ANOTHER tenant. Resolve membership in THIS
    // tenant first: only a user who is already a member here may have their
    // profile (name) updated. A globally-existing but non-member account is
    // re-used by id for the membership row below, but is never mutated.
    const [existingMemberUser] = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
      .where(and(eq(users.email, internalUser.email), eq(tenantMembers.tenantId, tenantId)))
      .limit(1);

    const [existingGlobalUser] = existingMemberUser
      ? [existingMemberUser]
      : await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, internalUser.email))
          .limit(1);

    let userId: string;
    let isNew = false;

    if (existingMemberUser) {
      userId = existingMemberUser.id;
      // Safe to update: this user is a member of the requesting tenant.
      if (internalUser.fullName) {
        await db.update(users)
          .set({ fullName: internalUser.fullName, updatedAt: new Date() })
          .where(eq(users.id, userId));
      }
    } else if (existingGlobalUser) {
      // Account exists but is NOT a member of this tenant — re-use the id for
      // the membership, but do NOT modify the foreign user's profile.
      userId = existingGlobalUser.id;
    } else {
      // Create new user
      const [created] = await db.insert(users).values({
        email: internalUser.email,
        fullName: internalUser.fullName ?? internalUser.email,
        emailVerified: true,
        lastTenantId: tenantId,
      }).returning({ id: users.id });

      if (!created) {
        return NextResponse.json(
          generateSCIMError('Failed to create user', 500),
          { status: 500, headers: { 'Content-Type': 'application/scim+json' } }
        );
      }
      userId = created.id;
      isNew = true;
    }

    // Ensure tenant membership exists
    const [existingMember] = await db
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
      .limit(1);

    if (!existingMember) {
      // SECURITY: pick a LEAST-PRIVILEGE default role. The previous fallback was
      // an unordered `roles ... limit(1)`, which could return the tenant's
      // `admin` role — silently provisioning an IdP-managed user as admin.
      // selectLeastPrivilegeRole never returns admin/super_admin.
      const tenantRoles = await db
        .select({ id: roles.id, slug: roles.slug, sortOrder: roles.sortOrder })
        .from(roles)
        .where(eq(roles.tenantId, tenantId));

      const roleToAssign = selectLeastPrivilegeRole(tenantRoles);

      await db.insert(tenantMembers).values({
        tenantId,
        userId,
        ...(roleToAssign ? { roleId: roleToAssign.id, roleSlug: roleToAssign.slug } : { roleSlug: 'member' }),
        status: 'active',
        joinedAt: new Date(),
      });
    } else {
      // Reactivate if inactive
      await db.update(tenantMembers)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(tenantMembers.id, existingMember.id));
    }

    // Fetch the created/updated user to return
    const [finalUser] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!finalUser) {
      return NextResponse.json(
        generateSCIMError('User not found after creation', 500),
        { status: 500, headers: { 'Content-Type': 'application/scim+json' } }
      );
    }

    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}/api`;
    const scimUser = toSCIMUser(
      {
        id: finalUser.id,
        email: finalUser.email,
        fullName: finalUser.fullName,
        active: true,
        createdAt: finalUser.createdAt,
        updatedAt: finalUser.updatedAt,
      },
      baseUrl
    );

    return NextResponse.json(scimUser, {
      status: isNew ? 201 : 200,
      headers: {
        'Content-Type': 'application/scim+json',
        'Location': `${baseUrl}/scim/v2/Users/${userId}`,
      },
    });
  } catch (error) {
    void logError({ error, context: 'scim/Users POST' });
    return NextResponse.json(
      generateSCIMError('Internal server error', 500),
      { status: 500, headers: { 'Content-Type': 'application/scim+json' } }
    );
  }
}
