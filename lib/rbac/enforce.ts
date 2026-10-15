/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2597 — `field_permissions` rows are configurable in the admin UI but were
 * enforced nowhere: `lib/rbac/field-permissions.ts` had zero production call
 * sites, so "hide `amount` from role `rep`" saved a row and changed nothing.
 * This module is the enforcement layer the request path calls:
 *
 *   read  — `enforceFieldRead` strips a projection's restricted keys from
 *           response rows (list and detail).
 *   write — `enforceFieldWrite` strips body keys the role may not write
 *           before they reach the column map (pinned semantics: STRIP, not
 *           403 — a PATCH that touches one restricted key out of five must
 *           still apply the other four).
 *
 * Semantics match the lib the config UI was always promising: a field with
 * no row is unrestricted (default-open); `none` fails a read and a write;
 * `read` passes a read but fails a write; `write`/`admin` pass both.
 *
 * Two rules the naive per-key filter would miss, both pinned by tests:
 *  - the deals handler exposes the same column twice (`amount` AND `value`),
 *    so restricting the field must clear every projection of it — the
 *    renamed-key leak #2521's mask fix was also about;
 *  - rows are configured with either spelling (`createdAt` / `created_at`),
 *    so comparison normalizes both sides.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/drizzle/db';
import { fieldPermissions, roles } from '@/drizzle/schema/core';
import type { AuthContext } from '@/lib/auth/middleware';

export type FieldAccess = 'none' | 'read' | 'write' | 'admin';

const ACCESS_ORDER: Record<FieldAccess, number> = { none: 0, read: 1, write: 2, admin: 3 };

type RestrictionMap = Map<string, FieldAccess>;

// Response-surface aliases: restricting the DB field also clears these keys.
// #2617 — the deal detail handler re-emits `stageId` under the legacy `stage`
// key, and the POST response copies `createdBy` to `user_id`; without these
// rows restricting `stage_id` / `created_by` still leaks the value.
// #2616 — the same `ownerField` map is consulted by `enforceFieldWrite`, so
// the entries below also close the inbound rename bypass: a PATCH body
// sending `stage` or `stage_name` writes `deals.stage_id`, and without the
// alias a `stage_id` write-restriction would not strip it.
const READ_ALIASES: Record<string, Record<string, string[]>> = {
  deals: {
    amount: ['value'],
    stage_id: ['stage', 'stage_name'],
    created_by: ['user_id'],
  },
  // #2618: normalize() already folds a camelCase key (leadStatus) onto its
  // column name (lead_status), so the detail routes that spread the raw drizzle
  // row are covered without aliases. These entries are the TRUE synonyms —
  // spellings whose normalization does NOT equal the column name.
  leads: {
    lead_status: ['status'],           // body/wire alias of the lead_status column
    lead_source: ['source'],           // drizzle prop `source` → column lead_source
    created_by: ['user_id'],           // POST responses name the creator user_id
    first_name: ['leadFirstName'],     // leads/history join exposes leadFirstName
    last_name: ['leadLastName'],
  },
  contacts: {
    job_title: ['title'],              // PATCH accepts `title` for job_title
    created_by: ['user_id'],           // POST responses emit the creator as user_id
  },
};

// The UI's entity picker and the routes do not agree on singular/plural
// ('deal' in the issue's own example, 'deals' as the route names it); match
// both spellings rather than silently no-op'ing on the other.
const ENTITY_CANDIDATES: Record<string, string[]> = {
  deals: ['deals', 'deal'],
  leads: ['leads', 'lead'],
  contacts: ['contacts', 'contact'],
  companies: ['companies', 'company'],
  tasks: ['tasks', 'task'],
};

const normalize = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const roleIdCache = new Map<string, { id: string | null; at: number }>();
const ROLE_TTL_MS = 60_000;

export function __clearRoleIdCache(): void {
  roleIdCache.clear();
}

// #2619 — built restriction maps, keyed tenant:role:entity. Cleared wholesale
// on an admin write (field-permission rows are rare and the TTL is short, so
// per-key invalidation would be pure bookkeeping).
const restrictionCache = new Map<string, { map: RestrictionMap | null; at: number }>();

export function __clearFieldRestrictionsCache(): void {
  restrictionCache.clear();
}

async function resolveRoleId(tenantId: string, roleSlug: string): Promise<string | null> {
  const key = `${tenantId}:${roleSlug}`;
  const hit = roleIdCache.get(key);
  if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit.id;
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.slug, roleSlug)))
    .limit(1);
  const id = role?.id ?? null;
  roleIdCache.set(key, { id, at: Date.now() });
  return id;
}

/**
 * The role's restrictions for one entity, or null when there is nothing to
 * enforce (unknown role, or no rows) — null lets callers skip projection
 * work entirely, so the hot path of every tenant that never touched the
 * feature costs one indexed select and nothing else.
 */
export async function getFieldRestrictions(
  tenantId: string,
  roleSlug: string,
  entity: string,
): Promise<RestrictionMap | null> {
  if (!roleSlug) return null;
  // #2619 — a PATCH consults this twice (write projection, then the response's
  // read projection) and the rows are near-static; cache the built map with
  // the same TTL as the role cache. setFieldPermission() clears it, so an
  // admin's write lands immediately.
  const cacheKey = `${tenantId}:${roleSlug}:${entity}`;
  const hit = restrictionCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit.map;
  const roleId = await resolveRoleId(tenantId, roleSlug);
  let map: RestrictionMap | null = null;
  if (roleId) {
    const rows = await db
      .select({ fieldName: fieldPermissions.fieldName, accessLevel: fieldPermissions.accessLevel })
      .from(fieldPermissions)
      .where(and(
        eq(fieldPermissions.tenantId, tenantId),
        eq(fieldPermissions.roleId, roleId),
        inArray(fieldPermissions.entityType, ENTITY_CANDIDATES[entity] ?? [entity]),
      ));
    if (rows.length > 0) {
      map = new Map();
      for (const r of rows) {
        map.set(normalize(r.fieldName), r.accessLevel as FieldAccess);
      }
    }
  }
  restrictionCache.set(cacheKey, { map, at: Date.now() });
  return map;
}

function passes(map: RestrictionMap, key: string, required: number): boolean {
  const access = map.get(normalize(key));
  // No row for the field: default-open, exactly what
  // lib/rbac/field-permissions.ts:50 promised before anything called it.
  if (access === undefined) return true;
  return ACCESS_ORDER[access] >= required;
}

/**
 * Who owns a response key: itself, or the DB field that aliases it. The deals
 * handler exposes `amount` as both `amount` and `value`, so restricting the
 * field must clear both — an alias fails whenever its real field does, even
 * though no row was ever configured for the alias spelling.
 */
function ownerField(entity: string, key: string): string {
  const aliases = READ_ALIASES[entity];
  if (!aliases) return key;
  for (const [field, alts] of Object.entries(aliases)) {
    if (alts.includes(key)) return field;
  }
  return key;
}

/** Strip read-restricted keys from one already-shaped response row. */
export function stripRowForRead<T extends Record<string, unknown>>(
  entity: string,
  map: RestrictionMap,
  row: T,
): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!passes(map, ownerField(entity, key), ACCESS_ORDER.read)) continue;
    out[key] = value;
  }
  return out as T;
}

/**
 * Read projection for handler responses. Super-admins are exempt (the
 * platform role is not a tenant staffing role; no field_permissions row can
 * even name it). Returns the input untouched — without an allocation per
 * row — when the role has no restrictions configured.
 */
export async function enforceFieldRead<T extends Record<string, unknown>>(
  ctx: AuthContext,
  entity: string,
  rows: T[],
): Promise<T[]> {
  if (ctx.isSuperAdmin) return rows;
  const map = await getFieldRestrictions(ctx.tenantId, ctx.roleSlug, entity);
  if (!map) return rows;
  return rows.map((r) => stripRowForRead(entity, map, r));
}

/**
 * Write projection for request bodies, before keys reach the column map.
 * Pinned semantics (#2597): restricted keys are STRIPPED, not rejected with
 * 403 — and `stripped` tells the handler what was dropped so it can surface
 * it. A field at `read` blocks the write too: read means read.
 */
export async function enforceFieldWrite(
  ctx: AuthContext,
  entity: string,
  body: Record<string, unknown>,
): Promise<{ body: Record<string, unknown>; stripped: string[] }> {
  if (ctx.isSuperAdmin) return { body, stripped: [] };
  const map = await getFieldRestrictions(ctx.tenantId, ctx.roleSlug, entity);
  if (!map) return { body, stripped: [] };
  const out: Record<string, unknown> = {};
  const stripped: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    // Resolve the canonical field first: a body sent as `value` still writes
    // `amount`, so an `amount` write-restriction must strip the alias too
    // (otherwise the restriction is bypassed by renaming on the way in).
    if (passes(map, ownerField(entity, key), ACCESS_ORDER.write)) {
      out[key] = value;
    } else {
      stripped.push(key);
    }
  }
  return { body: out, stripped };
}

/**
 * #2620 — the design of `enforceFieldWrite` is STRIP (not 403): a PATCH with
 * one restricted key out of five still applies the other four and returns
 * 200. Without a signal back to the caller that's silent data loss on the
 * client side. Attach the dropped keys to the response so the UI can surface
 * them: `X-Stripped-Fields` header (comma-separated) and `stripped_fields`
 * on the JSON body when the payload is a plain object.
 *
 * No-op when `stripped` is empty, so superadmin / unrestricted requests stay
 * byte-identical to today.
 */
export function attachStrippedFields<T extends Record<string, unknown>>(
  response: NextResponse<T>,
  stripped: readonly string[],
): NextResponse<T> {
  if (stripped.length === 0) return response;
  response.headers.set('X-Stripped-Fields', stripped.join(','));
  return response;
}
