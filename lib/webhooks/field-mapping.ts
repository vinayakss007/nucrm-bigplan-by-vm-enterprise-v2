/**
 * Inbound webhook field mapping.
 *
 * The inbound endpoint (`app/api/webhooks/inbound/route.ts`) reads a fixed
 * allowlist of keys per entity, so any other top-level key a third party sends is
 * silently discarded — a telephony provider posting `call_duration`,
 * `transcript` and `recording_url` gets a 200 back and none of it is stored.
 *
 * A `webhook_field_mappings` row tells the endpoint where such a key belongs:
 * either a native field the handler already consumes, or a custom field stored in
 * the entity's `custom_fields` JSONB column.
 */

import { and, eq, getTableColumns, isNull, or } from 'drizzle-orm';
import { db } from '@/drizzle/db';
import { webhookFieldMappings } from '@/drizzle/schema/comm';
import { contacts, leads, deals, companies } from '@/drizzle/schema/crm';
import { tasks } from '@/drizzle/schema/tasks';

// ── Native target allowlist ────────────────────────────────────────────────────

/**
 * Per-entity allowlist of native field names a mapping may write.
 *
 * SECURITY BOUNDARY — not a convenience list. A mapping's target is
 * attacker-influenceable configuration, so an unrestricted native target would
 * let whoever controls that config aim an incoming key at `tenantId`, `id`,
 * `createdBy`, `deletedAt`, `isArchived`, `ownerId` or `stageId` and get
 * cross-tenant writes or privilege escalation.
 *
 * Every entry below is a key the corresponding handler in the inbound route
 * already reads off the payload, so a mapping grants no capability a direct
 * caller did not already have. Adding anything else here widens the trust
 * boundary — don't, without re-reading the handler.
 *
 * Deliberately excluded even though the handlers touch them:
 *   - `id`            — selects which row is updated; must stay caller-explicit.
 *   - `ownerId`       — ownership assignment (handleLead reads it on insert).
 *   - `customFields`  — reachable via `targetType: 'custom_field'`; a native
 *                       mapping onto it would let one key replace the whole blob.
 */
export const NATIVE_TARGETS: Record<string, readonly string[]> = {
  // handleContact
  contact: [
    'firstName', 'lastName', 'email', 'phone', 'companyId', 'assignedTo',
    'leadStatus', 'leadSource', 'notes', 'tags', 'score', 'city', 'country',
    'website', 'linkedinUrl', 'twitterUrl',
  ],
  // handleLead
  lead: [
    'firstName', 'lastName', 'email', 'phone', 'mobile', 'title', 'companyName',
    'leadSource', 'leadStatus', 'lifecycleStage', 'assignedTo', 'tags', 'notes',
  ],
  // handleDeal — `stageId` is set by the route itself and is never a target.
  deal: [
    'title', 'value', 'stage', 'probability', 'closeDate', 'contactId',
    'companyId', 'assignedTo', 'notes',
  ],
  // handleCompany
  company: [
    'name', 'industry', 'size', 'website', 'phone', 'address', 'notes',
  ],
  // handleTask
  task: [
    'title', 'description', 'dueDate', 'priority', 'contactId', 'dealId',
    'assignedTo', 'completed',
  ],
};

/** Entities whose handler the route dispatches to. */
const ENTITY_TABLES = {
  contact: contacts,
  lead: leads,
  deal: deals,
  company: companies,
  task: tasks,
} as const;

/**
 * Entities that actually have a `custom_fields` column to write into.
 *
 * Derived from the Drizzle schema rather than hardcoded, so a table gaining or
 * losing the column cannot leave this list quietly wrong. As of this writing
 * `deals` and `tasks` both lack it — they carry `metadata` instead — so a
 * custom-field mapping for either is rejected rather than silently dropped by
 * the ORM.
 */
export const ENTITIES_WITH_CUSTOM_FIELDS: ReadonlySet<string> = new Set(
  Object.entries(ENTITY_TABLES)
    .filter(([, table]) => 'customFields' in getTableColumns(table))
    .map(([entity]) => entity)
);

/** Transform names a mapping may specify. */
export const VALID_TRANSFORMS = ['string', 'number', 'boolean', 'date', 'trim', 'lowercase'] as const;
export type Transform = typeof VALID_TRANSFORMS[number];

/** Entities the inbound route accepts. Mirrors VALID_ENTITIES in the route. */
export const MAPPABLE_ENTITIES = ['contact', 'lead', 'deal', 'company', 'task'] as const;

/** True when `targetKey` is a native field this entity's handler will consume. */
export function isValidNativeTarget(entityType: string, targetKey: string): boolean {
  if (!entityType || !targetKey) return false;
  // Object.prototype lookups (`constructor`, `__proto__`) must not resolve.
  if (!Object.prototype.hasOwnProperty.call(NATIVE_TARGETS, entityType)) return false;
  const allowed = NATIVE_TARGETS[entityType];
  return Array.isArray(allowed) && allowed.includes(targetKey);
}

// ── Transforms ─────────────────────────────────────────────────────────────────

const TRUTHY_STRINGS = new Set(['true', '1', 'yes']);

/**
 * Coerce a mapped value. An unrecognised, null or undefined transform is a no-op
 * so an unknown value in the column can never drop data.
 */
export function applyTransform(value: unknown, transform: string | null | undefined): unknown {
  switch (transform) {
    case 'string':
      return value == null ? value : String(value);

    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      if (trimmed === '') return null;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }

    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1;
      if (typeof value === 'string') return TRUTHY_STRINGS.has(value.trim().toLowerCase());
      return false;
    }

    case 'date': {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
      if (typeof value !== 'string' && typeof value !== 'number') return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    case 'trim':
      return typeof value === 'string' ? value.trim() : value;

    case 'lowercase':
      return typeof value === 'string' ? value.toLowerCase() : value;

    default:
      return value;
  }
}

// ── Applying mappings ──────────────────────────────────────────────────────────

/** The subset of a mapping row the engine needs. */
export interface FieldMapping {
  sourceKey: string;
  targetType: string | null;
  targetKey: string;
  transform?: string | null;
  isActive?: boolean | null;
  apiKeyId?: string | null;
}

export interface AppliedMapping {
  sourceKey: string;
  targetType: string;
  targetKey: string;
}

export interface RejectedMapping {
  sourceKey: string;
  targetKey: string;
  reason: string;
}

export interface MappingResult {
  data: Record<string, unknown>;
  applied: AppliedMapping[];
  rejected: RejectedMapping[];
}

export const REJECT_NATIVE_NOT_ALLOWED = 'native target not allowed';
export const REJECT_NO_CUSTOM_FIELDS = 'entity does not support custom fields';
export const REJECT_ALREADY_PROVIDED = 'target already provided by caller';

/** snake_case -> camelCase, matching normalizeFields() in the inbound route. */
function toCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Find the incoming key that a mapping's `sourceKey` refers to, tolerating the
 * same snake_case/camelCase difference the route already normalises away, so a
 * mapping for `call_duration` matches a payload sending `callDuration` and the
 * other way round.
 *
 * Returns the actual key present in `data`, or null when absent.
 */
function resolveSourceKey(data: Record<string, unknown>, sourceKey: string): string | null {
  if (Object.prototype.hasOwnProperty.call(data, sourceKey)) return sourceKey;

  const wanted = toCamel(sourceKey);
  for (const key of Object.keys(data)) {
    if (key === wanted || toCamel(key) === wanted) return key;
  }
  return null;
}

/**
 * True when the caller already supplied this native target, in either spelling.
 * `{ close_date: ... }` and `{ closeDate: ... }` are the same field to the route,
 * so a mapping onto `closeDate` must yield to both.
 */
function callerOwns(callerKeys: ReadonlySet<string>, source: Record<string, unknown>, targetKey: string): boolean {
  if (callerKeys.has(targetKey) && source[targetKey] !== undefined) return true;
  const wanted = toCamel(targetKey);
  for (const key of callerKeys) {
    if (toCamel(key) === wanted && source[key] !== undefined) return true;
  }
  return false;
}

/**
 * Route unrecognised payload keys to their configured destinations.
 *
 * Never mutates `data`; the returned object is a fresh shallow copy with a fresh
 * `customFields` object, so the caller's payload stays intact for logging.
 */
export function applyFieldMappings(
  entityType: string,
  data: Record<string, unknown>,
  mappings: readonly FieldMapping[]
): MappingResult {
  const applied: AppliedMapping[] = [];
  const rejected: RejectedMapping[] = [];
  const appliedTargets = new Set<string>();

  const source = data ?? {};
  const out: Record<string, unknown> = { ...source };

  // Preserve whatever custom fields the caller sent. The clone is what we write
  // into, so the caller's own object is never touched.
  const callerCustom = source['customFields'];
  const custom: Record<string, unknown> =
    callerCustom && typeof callerCustom === 'object' && !Array.isArray(callerCustom)
      ? { ...(callerCustom as Record<string, unknown>) }
      : {};
  // Snapshot of the keys the caller owns, taken before any mapping runs, so
  // "already provided" means provided by the caller and not by an earlier
  // mapping in this same pass.
  const callerCustomKeys = new Set(Object.keys(custom));
  const callerNativeKeys = new Set(Object.keys(source));
  let customTouched = false;

  if (!Array.isArray(mappings) || mappings.length === 0) {
    return { data: out, applied, rejected };
  }

  for (const mapping of mappings) {
    if (!mapping || !mapping.sourceKey || !mapping.targetKey) continue;
    if (mapping.isActive === false) continue;

    // Absent source key is not an error — a sender simply omitted the field.
    const presentKey = resolveSourceKey(source, mapping.sourceKey);
    if (presentKey === null) continue;

    const targetType = mapping.targetType === 'native' ? 'native' : 'custom_field';

    if (targetType === 'native') {
      if (!isValidNativeTarget(entityType, mapping.targetKey)) {
        rejected.push({ sourceKey: mapping.sourceKey, targetKey: mapping.targetKey, reason: REJECT_NATIVE_NOT_ALLOWED });
        continue;
      }
      // A mapping must never overwrite what the caller sent explicitly, in
      // either spelling, and two mappings must not fight over one target.
      if (
        callerOwns(callerNativeKeys, source, mapping.targetKey) ||
        appliedTargets.has(`native:${mapping.targetKey}`)
      ) {
        rejected.push({ sourceKey: mapping.sourceKey, targetKey: mapping.targetKey, reason: REJECT_ALREADY_PROVIDED });
        continue;
      }

      out[mapping.targetKey] = applyTransform(source[presentKey], mapping.transform);
      appliedTargets.add(`native:${mapping.targetKey}`);
      applied.push({ sourceKey: mapping.sourceKey, targetType, targetKey: mapping.targetKey });
      continue;
    }

    if (!ENTITIES_WITH_CUSTOM_FIELDS.has(entityType)) {
      rejected.push({ sourceKey: mapping.sourceKey, targetKey: mapping.targetKey, reason: REJECT_NO_CUSTOM_FIELDS });
      continue;
    }
    if (callerCustomKeys.has(mapping.targetKey) || appliedTargets.has(`custom:${mapping.targetKey}`)) {
      rejected.push({ sourceKey: mapping.sourceKey, targetKey: mapping.targetKey, reason: REJECT_ALREADY_PROVIDED });
      continue;
    }
    appliedTargets.add(`custom:${mapping.targetKey}`);

    custom[mapping.targetKey] = applyTransform(source[presentKey], mapping.transform);
    customTouched = true;
    applied.push({ sourceKey: mapping.sourceKey, targetType, targetKey: mapping.targetKey });
  }

  if (customTouched) out['customFields'] = custom;

  return { data: out, applied, rejected };
}

// ── Loading ────────────────────────────────────────────────────────────────────

/**
 * Load the active mappings that apply to one inbound item.
 *
 * Matches rows for this API key plus the tenant-wide rows (`api_key_id IS
 * NULL`). Where both exist for the same `sourceKey`, the key-specific row wins —
 * a tenant-wide default should never override a per-integration decision.
 */
export async function loadFieldMappings(
  tenantId: string,
  apiKeyId: string | null,
  entityType: string
): Promise<FieldMapping[]> {
  if (!tenantId || !entityType) return [];

  const keyScope = apiKeyId
    ? or(eq(webhookFieldMappings.apiKeyId, apiKeyId), isNull(webhookFieldMappings.apiKeyId))
    : isNull(webhookFieldMappings.apiKeyId);

  const rows = await db
    .select({
      sourceKey: webhookFieldMappings.sourceKey,
      targetType: webhookFieldMappings.targetType,
      targetKey: webhookFieldMappings.targetKey,
      transform: webhookFieldMappings.transform,
      isActive: webhookFieldMappings.isActive,
      apiKeyId: webhookFieldMappings.apiKeyId,
    })
    .from(webhookFieldMappings)
    .where(and(
      eq(webhookFieldMappings.tenantId, tenantId),
      eq(webhookFieldMappings.entityType, entityType),
      eq(webhookFieldMappings.isActive, true),
      isNull(webhookFieldMappings.deletedAt),
      keyScope
    ));

  // Key-specific beats tenant-wide for the same source key.
  const bySourceKey = new Map<string, FieldMapping>();
  for (const row of rows ?? []) {
    const existing = bySourceKey.get(row.sourceKey);
    if (!existing || (!existing.apiKeyId && row.apiKeyId)) {
      bySourceKey.set(row.sourceKey, row);
    }
  }

  return [...bySourceKey.values()];
}
