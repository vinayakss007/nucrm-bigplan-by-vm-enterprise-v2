/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * SCIM 2.0 Single User Endpoint
 *
 * GET    /api/scim/v2/Users/:id  - Get user by ID
 * PATCH  /api/scim/v2/Users/:id  - Update user attributes
 * DELETE /api/scim/v2/Users/:id  - Deactivate user (soft-delete, revoke sessions)
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.5
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/drizzle/db';
import { users, tenantMembers, sessions } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import {
  toSCIMUser,
  fromSCIMUser,
  generateSCIMError,
  verifySCIMToken,
  type SCIMUser,
} from '@/lib/scim';
import { concurrencyGuard } from '@/lib/api/concurrency';

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

// ── GET: Retrieve User ───────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateSCIM(request);
  if (authResult instanceof NextResponse) return authResult;
  const { tenantId } = authResult;
  const { id } = await params;

  try {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        memberStatus: tenantMembers.status,
      })
      .from(users)
      .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
      .where(and(eq(users.id, id), eq(tenantMembers.tenantId, tenantId)))
      .limit(1);

    if (!user) {
      return NextResponse.json(
        generateSCIMError('User not found', 404),
        { status: 404, headers: { 'Content-Type': 'application/scim+json' } }
      );
    }

    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}/api`;
    const scimUser = toSCIMUser(
      {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        active: user.memberStatus === 'active',
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      baseUrl
    );

    return NextResponse.json(scimUser, {
      status: 200,
      headers: { 'Content-Type': 'application/scim+json' },
    });
  } catch (error) {
    console.error('[SCIM] GET /Users/:id error:', error);
    return NextResponse.json(
      generateSCIMError('Internal server error', 500),
      { status: 500, headers: { 'Content-Type': 'application/scim+json' } }
    );
  }
}

// ── PATCH: Update User Attributes ────────────────────────────────────────────

// Runtime validation for the SCIM PatchOp body (#1270). IdPs send untrusted
// JSON, so we validate the shape at runtime instead of trusting an
// `as SCIMPatchRequest` cast.
const scimPatchRequestSchema = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z
    .array(
      z.object({
        op: z.enum(['add', 'replace', 'remove']),
        path: z.string().optional(),
        value: z.unknown().optional(),
      }),
    )
    .optional(),
});

type SCIMPatchRequest = z.infer<typeof scimPatchRequestSchema>;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateSCIM(request);
  if (authResult instanceof NextResponse) return authResult;
  const { tenantId } = authResult;
  const { id } = await params;

  try {
    // Verify user exists and belongs to tenant
    const [existingUser] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        updatedAt: users.updatedAt,
        memberId: tenantMembers.id,
        memberStatus: tenantMembers.status,
        memberUpdatedAt: tenantMembers.updatedAt,
      })
      .from(users)
      .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
      .where(and(eq(users.id, id), eq(tenantMembers.tenantId, tenantId)))
      .limit(1);

    if (!existingUser) {
      return NextResponse.json(
        generateSCIMError('User not found', 404),
        { status: 404, headers: { 'Content-Type': 'application/scim+json' } }
      );
    }

    const parsedBody = scimPatchRequestSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json(
        generateSCIMError('Invalid SCIM PatchOp payload', 400),
        { status: 400, headers: { 'Content-Type': 'application/scim+json' } }
      );
    }
    const body: SCIMPatchRequest = parsedBody.data;

    if (!body.schemas?.includes('urn:ietf:params:scim:api:messages:2.0:PatchOp')) {
      return NextResponse.json(
        generateSCIMError('Invalid schema. Expected urn:ietf:params:scim:api:messages:2.0:PatchOp', 400),
        { status: 400, headers: { 'Content-Type': 'application/scim+json' } }
      );
    }

    const userUpdates: Record<string, unknown> = {};
    let deactivate = false;
    let activate = false;

    for (const op of body.Operations ?? []) {
      const path = op.path?.toLowerCase();

      if (op.op === 'replace' || op.op === 'add') {
        if (path === 'active') {
          const active = op.value === true || op.value === 'true';
          if (!active) {
            deactivate = true;
          } else {
            activate = true;
          }
        } else if (path === 'name.givenname' || path === 'name.firstname') {
          // Will reconstruct full name below
          userUpdates['givenName'] = String(op.value ?? '');
        } else if (path === 'name.familyname' || path === 'name.lastname') {
          userUpdates['familyName'] = String(op.value ?? '');
        } else if (path === 'displayname' || path === 'name.formatted') {
          userUpdates['fullName'] = String(op.value ?? '');
        } else if (path === 'username' || path === 'emails[type eq "work"].value') {
          userUpdates['email'] = String(op.value ?? '');
        } else if (!path && typeof op.value === 'object' && op.value !== null) {
          // Bulk replace without path - treat value as partial SCIM user
          const partial = fromSCIMUser(op.value as SCIMUser);
          if (partial.fullName) userUpdates['fullName'] = partial.fullName;
          if (partial.email) userUpdates['email'] = partial.email;
          if (partial.active === false) deactivate = true;
          if (partial.active === true) activate = true;
        }
      } else if (op.op === 'remove') {
        if (path === 'active') {
          deactivate = true;
        }
      }
    }

    // Build full name from parts if individual name components were updated
    if (userUpdates['givenName'] || userUpdates['familyName']) {
      const given = (userUpdates['givenName'] as string) ?? '';
      const family = (userUpdates['familyName'] as string) ?? '';
      userUpdates['fullName'] = [given, family].filter(Boolean).join(' ');
      delete userUpdates['givenName'];
      delete userUpdates['familyName'];
    }

    // Use client-provided If-Match header (SCIM versioning convention) for
    // concurrency check.  The IdP sends the ETag it last saw; we compare
    // against the DB snapshot.  If absent, fall back to the DB snapshot
    // (backward-compatible, but two concurrent PATCHes can both pass).
    const ifMatch = request.headers.get('if-match');
    const expectedUserUpdatedAt = ifMatch
      ? ifMatch.replace(/^W\//, '').replace(/^"|"$/g, '')  // strip weak-etag prefix/quotes
      : existingUser.updatedAt;
    const expectedMemberUpdatedAt = ifMatch
      ? ifMatch.replace(/^W\//, '').replace(/^"|"$/g, '')
      : existingUser.memberUpdatedAt;

    // Apply user record updates
    const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (userUpdates['fullName']) dbUpdates['fullName'] = userUpdates['fullName'];
    if (userUpdates['email']) dbUpdates['email'] = userUpdates['email'];

    // Handle activation/deactivation
    const memberUpdates: { table: typeof tenantMembers; id: string; status: string } | null =
      deactivate
        ? { table: tenantMembers, id: existingUser.memberId, status: 'inactive' }
        : activate
          ? { table: tenantMembers, id: existingUser.memberId, status: 'active' }
          : null;

    // Wrap user + member updates in a transaction to avoid partial writes
    const hasUserUpdates = Object.keys(dbUpdates).length > 1;
    if (hasUserUpdates || memberUpdates) {
      await db.transaction(async (tx) => {
        if (hasUserUpdates) {
          const guard = await concurrencyGuard(db, users, id, tenantId, expectedUserUpdatedAt);
          if (guard) throw guard;
          const [updated] = await tx
            .update(users)
            .set(dbUpdates)
            .where(and(eq(users.id, id), eq(users.updatedAt, new Date(expectedUserUpdatedAt as string | Date))))
            .returning({ id: users.id });
          if (!updated) throw NextResponse.json(
            generateSCIMError('Stale data — record was modified. Please refresh.', 409),
            { status: 409, headers: { 'Content-Type': 'application/scim+json' } },
          );
        }

        if (memberUpdates) {
          const guard = await concurrencyGuard(db, tenantMembers, memberUpdates.id, tenantId, expectedMemberUpdatedAt);
          if (guard) throw guard;
          const [updatedMember] = await tx
            .update(tenantMembers)
            .set({ status: memberUpdates.status, updatedAt: new Date() })
            .where(and(
              eq(tenantMembers.id, memberUpdates.id),
              eq(tenantMembers.updatedAt, new Date(expectedMemberUpdatedAt as string | Date)),
            ))
            .returning({ id: tenantMembers.id });
          if (!updatedMember) throw NextResponse.json(
            generateSCIMError('Stale data — record was modified. Please refresh.', 409),
            { status: 409, headers: { 'Content-Type': 'application/scim+json' } },
          );

          // Revoke all active sessions for deactivated users
          if (deactivate) {
            await tx.delete(sessions).where(eq(sessions.userId, id));
          }
        }
      });
    }

    // Fetch updated user
    const [updatedUser] = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        memberStatus: tenantMembers.status,
      })
      .from(users)
      .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
      .where(and(eq(users.id, id), eq(tenantMembers.tenantId, tenantId)))
      .limit(1);

    if (!updatedUser) {
      return NextResponse.json(
        generateSCIMError('User not found after update', 500),
        { status: 500, headers: { 'Content-Type': 'application/scim+json' } }
      );
    }

    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}/api`;
    const scimUser = toSCIMUser(
      {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        active: updatedUser.memberStatus === 'active',
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      },
      baseUrl
    );

    return NextResponse.json(scimUser, {
      status: 200,
      headers: { 'Content-Type': 'application/scim+json' },
    });
  } catch (error) {
    console.error('[SCIM] PATCH /Users/:id error:', error);
    return NextResponse.json(
      generateSCIMError('Internal server error', 500),
      { status: 500, headers: { 'Content-Type': 'application/scim+json' } }
    );
  }
}

// ── DELETE: Deactivate User (Soft Delete) ────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authenticateSCIM(request);
  if (authResult instanceof NextResponse) return authResult;
  const { tenantId } = authResult;
  const { id } = await params;

  try {
    // Verify user exists and belongs to tenant
    const [existingUser] = await db
      .select({
        id: users.id,
        memberId: tenantMembers.id,
      })
      .from(users)
      .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
      .where(and(eq(users.id, id), eq(tenantMembers.tenantId, tenantId)))
      .limit(1);

    if (!existingUser) {
      return NextResponse.json(
        generateSCIMError('User not found', 404),
        { status: 404, headers: { 'Content-Type': 'application/scim+json' } }
      );
    }

    // Soft-delete: set membership to inactive
    await db.update(tenantMembers)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(tenantMembers.id, existingUser.memberId));

    // Revoke all active sessions for this user
    await db.delete(sessions).where(eq(sessions.userId, id));

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('[SCIM] DELETE /Users/:id error:', error);
    return NextResponse.json(
      generateSCIMError('Internal server error', 500),
      { status: 500, headers: { 'Content-Type': 'application/scim+json' } }
    );
  }
}
