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
 * #3303 — every query below runs inside `withScimTenantContext`, so the
 * policies that gate `users` and `tenant_members` have a tenant to answer for.
 * The two windows that need more than the token's tenant — a global email
 * lookup and a brand-new user's own INSERT…RETURNING row — borrow exactly one
 * identity each and hand it back; see lib/db/scim-context.ts.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.4
 */

import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { readJsonBody, InvalidJsonBodyError } from '@/lib/api/validate';
import { logError } from '@/lib/errors-server';
import { RateLimiter } from '@/lib/rate-limit';
import { escapeLike } from '@/lib/api/sanitize-like';
import { clampInt } from '@/lib/api/query-params';
import { selectLeastPrivilegeRole } from '@/lib/auth/default-role';
import { inScimTransaction, withScimEmailLookup, withScimTenantContext, withScimUserIdentity } from '@/lib/db/scim-context';
import { authenticateSCIMRequest } from '@/lib/scim/user-route-support';
import { users, tenantMembers, roles } from '@/drizzle/schema';
import { eq, and, ilike, sql } from 'drizzle-orm';
import {
  parseSCIMFilter,
  toSCIMUser,
  fromSCIMUser,
  generateSCIMResponse,
  generateSCIMError,
  scimUserSchema,
  type SCIMUser,
} from '@/lib/scim';

// ── Rate Limiting ────────────────────────────────────────────────────────────

/**
 * Per-tenant rate limiter for SCIM provisioning (POST). SCIM tokens are not
 * browser sessions and are not covered by session-based limits, and mass user
 * creation is the primary abuse vector for this endpoint. Keyed by tenantId so
 * one tenant's IdP cannot exhaust another tenant's budget. 30 provisioning
 * calls per 60s per tenant.
 */
const provisionLimiter = new RateLimiter({ max: 30, window: 60 });

// ── Auth Helper ──────────────────────────────────────────────────────────────

// `authenticateSCIMRequest` lives in `lib/scim/user-route-support.ts` (#3303): it is the same
// gate this file and `.../Users/[id]/route.ts` were each carrying a private copy of, and the
// item route had outgrown #1843's ceiling by the time the context wrapping landed.

// ── GET: List/Search Users ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authResult = await authenticateSCIMRequest(request);
  if (authResult instanceof NextResponse) return authResult;
  const { tenantId } = authResult;

  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') ?? undefined;
  // #2766 — these two `Math.max(1, parseInt(…))` / `Math.min(100, …)` clamps answer
  // `NaN` for `?count=abc` and for `?startIndex=` (an empty parameter is `''`, and
  // `?? '100'` only covers an *absent* one). Drizzle then omits both clauses —
  // `pg-core/dialect.js:286` drops a `NaN` limit and `offsetSql = offset ? …` drops a
  // `NaN` offset — so the provisioning API documented at "max 100" returned every
  // active user of the tenant, and `generateSCIMResponse` echoed `startIndex: NaN`,
  // which `JSON.stringify` writes as `null`: malformed SCIM, answered 200.
  const startIndex = clampInt(url.searchParams.get('startIndex'), 1, 1, Number.MAX_SAFE_INTEGER);
  const count = clampInt(url.searchParams.get('count'), 100, 1, 100);

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

    const { totalResults, rows } = await withScimTenantContext(tenantId, async (tx) => {
      // Get total count
      const [countResult] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
        .where(and(...conditions));

      // Fetch paginated results
      const offset = startIndex - 1; // SCIM is 1-indexed
      const page = await tx
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

      return { totalResults: Number(countResult?.count ?? 0), rows: page };
    });

    const baseUrl = `${url.protocol}//${url.host}/api`;
    const scimUsers: SCIMUser[] = rows.map((user) =>
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
  const authResult = await authenticateSCIMRequest(request);
  if (authResult instanceof NextResponse) return authResult;
  const { tenantId } = authResult;

  // Per-tenant rate limit, applied AFTER token verification (tenantId known)
  // and BEFORE any provisioning work. A rejection MUST be returned as a
  // SCIM-formatted 429 (via generateSCIMError) to honor the SCIM error
  // contract, NOT a plain JSON 429.
  const rl = await provisionLimiter.check(`scim:provision:${tenantId}`);
  if (!rl.allowed) {
    return NextResponse.json(
      generateSCIMError('Too many requests', 429),
      { status: 429, headers: { 'Content-Type': 'application/scim+json' } }
    );
  }

  try {
    const parsedBody = scimUserSchema.safeParse(await readJsonBody(request));
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
    // Narrow email to a plain string here so the transaction closure below
    // (which captures it) keeps the non-undefined type after the guard above.
    const email = internalUser.email;

    const outcome = await withScimTenantContext(tenantId, async (ctx) => {
      // #1171: users are shared across tenants (membership lives in
      // tenant_members), so an unscoped email lookup let one tenant's IdP mutate
      // a user account owned/used by ANOTHER tenant. Resolve membership in THIS
      // tenant first: only a user who is already a member here may have their
      // profile (name) updated. A globally-existing but non-member account is
      // re-used by id for the membership row below, but is never mutated.
      const [existingMemberUser] = await ctx
        .select({ id: users.id })
        .from(users)
        .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
        .where(and(eq(users.email, email), eq(tenantMembers.tenantId, tenantId)))
        .limit(1);

      // A non-member account may live in another workspace, so finding its id is
      // a cross-tenant question and runs through the same one-statement
      // `users_auth_lookup` window login uses.
      const [existingGlobalUser] = existingMemberUser
        ? [existingMemberUser]
        : await withScimEmailLookup(ctx, () =>
            ctx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.email, email))
              .limit(1)
          );

      // #685 (HIGH #7): the user upsert and the tenant_members upsert write two
      // distinct tables and MUST be atomic. Previously a fresh `users` INSERT
      // that succeeded followed by a failing `tenant_members` INSERT left an
      // ORPHANED global user row with no membership — which SCIM's later unscoped
      // email lookup would then silently re-use across tenants. Wrap the whole
      // provisioning write (user + membership, and the role lookup they depend
      // on) in one transaction so a failure rolls the user creation back too.
      const provisionResult = await inScimTransaction(ctx, async (tx): Promise<{ userId: string; isNew: boolean }> => {
        let uid: string;
        let created = false;

        if (existingMemberUser) {
          uid = existingMemberUser.id;
          // Safe to update: this user is a member of the requesting tenant.
          if (internalUser.fullName) {
            await tx.update(users)
              .set({ fullName: internalUser.fullName, updatedAt: new Date() })
              .where(eq(users.id, uid));
          }
        } else if (existingGlobalUser) {
          // Account exists but is NOT a member of this tenant — re-use the id for
          // the membership, but do NOT modify the foreign user's profile.
          uid = existingGlobalUser.id;
        } else {
          // Create new user. The id is chosen before the INSERT so the row's own
          // RETURNING read is visible: the `users` policies admit a row only to
          // its own app.current_user, so we adopt the new uuid for the duration
          // of the insert. Nothing else runs inside that window.
          uid = randomUUID();
          const [createdUser] = await withScimUserIdentity(tx, uid, () =>
            tx.insert(users).values({
              id: uid,
              email,
              fullName: internalUser.fullName ?? email,
              emailVerified: true,
              lastTenantId: tenantId,
            }).returning({ id: users.id })
          );

          if (!createdUser) {
            // Throwing rolls the whole provisioning write back, so a failure
            // here cannot leave a half-provisioned user behind.
            throw new Error('scim-provision:user-create-failed');
          }
          created = true;
        }

        // Ensure tenant membership exists
        const [existingMember] = await tx
          .select({ id: tenantMembers.id })
          .from(tenantMembers)
          .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, uid)))
          .limit(1);

        if (!existingMember) {
          // SECURITY: pick a LEAST-PRIVILEGE default role. The previous fallback was
          // an unordered `roles ... limit(1)`, which could return the tenant's
          // `admin` role — silently provisioning an IdP-managed user as admin.
          // selectLeastPrivilegeRole never returns admin/super_admin.
          const tenantRoles = await tx
            .select({ id: roles.id, slug: roles.slug, sortOrder: roles.sortOrder })
            .from(roles)
            .where(eq(roles.tenantId, tenantId));

          const roleToAssign = selectLeastPrivilegeRole(tenantRoles);

          await tx.insert(tenantMembers).values({
            tenantId,
            userId: uid,
            ...(roleToAssign ? { roleId: roleToAssign.id, roleSlug: roleToAssign.slug } : { roleSlug: 'member' }),
            status: 'active',
            joinedAt: new Date(),
          });
        } else {
          // Reactivate if inactive
          await tx.update(tenantMembers)
            .set({ status: 'active', updatedAt: new Date() })
            .where(eq(tenantMembers.id, existingMember.id));
        }

        return { userId: uid, isNew: created };
      });

      // Read the created/updated user back while the context that admits
      // `users` is still in force.
      const { userId, isNew } = provisionResult;
      const [finalUser] = await ctx
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

      return { userId, isNew, finalUser };
    });

    const { userId, isNew, finalUser } = outcome;

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
    if (error instanceof InvalidJsonBodyError) {
      return NextResponse.json(
        generateSCIMError('Invalid JSON body', 400),
        { status: 400, headers: { 'Content-Type': 'application/scim+json' } }
      );
    }
    void logError({ error, context: 'scim/Users POST' });
    return NextResponse.json(
      generateSCIMError('Internal server error', 500),
      { status: 500, headers: { 'Content-Type': 'application/scim+json' } }
    );
  }
}
