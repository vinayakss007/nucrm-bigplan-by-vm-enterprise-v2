/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { escapeLike } from '@/lib/api/sanitize-like';
import { createHash } from 'crypto';
import { db } from '@/drizzle/db';
import { apiKeys, webhookInboundLogs, contacts, leads, deals, companies, tasks, dealStages, pipelines } from '@/drizzle/schema';
import { eq, and, or, isNull, gt, sql, ilike, asc, desc } from 'drizzle-orm';
import { RateLimiter, getRateLimitHeaders } from '@/lib/rate-limit';
import { fireWebhooks, type WebhookEvent } from '@/lib/webhooks';
import { logAudit } from '@/lib/audit';
import { devLogger } from '@/lib/dev-logger';
import { logError } from '@/lib/errors-server';
import { validateJsonb } from '@/lib/validation/jsonb';
import {
  applyFieldMappings,
  loadFieldMappings,
  NATIVE_TARGETS,
  type AppliedMapping,
  type RejectedMapping,
} from '@/lib/webhooks/field-mapping';

// ── Constants ──────────────────────────────────────────────────────────
const MAX_PAYLOAD_SIZE = 1_000_000; // 1 MB
const MAX_BATCH_SIZE = 100;
const VALID_ACTIONS = new Set(['create', 'update', 'upsert']);
const VALID_ENTITIES = new Set(['contact', 'lead', 'deal', 'company', 'task']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Max serialized size of the raw body we persist into webhook_inbound_logs.payload. */
const MAX_STORED_PAYLOAD_BYTES = 64 * 1024; // 64 KB

/** Header names whose values must never be written to the audit log. */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'x-webhook-secret',
  'cookie',
  'set-cookie',
  'proxy-authorization',
]);

const REDACTED = '[REDACTED]';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Rate limiter: 100 requests per API key per minute
const inboundLimiter = new RateLimiter({ max: 100, window: 60 });

// ── In-memory request tracking (last 100 per API key prefix) ──────────
const requestLog = new Map<string, Array<{ ts: number; status: number; path: string }>>();
const MAX_LOG_PER_KEY = 100;
const MAX_LOG_KEYS = 1000;

function logRequest(keyPrefix: string, status: number, path: string) {
  const entries = requestLog.get(keyPrefix) ?? [];
  entries.push({ ts: Date.now(), status, path });
  if (entries.length > MAX_LOG_PER_KEY) entries.splice(0, entries.length - MAX_LOG_PER_KEY);
  requestLog.set(keyPrefix, entries);

  // Cap the map at MAX_LOG_KEYS to prevent unbounded memory growth
  if (requestLog.size > MAX_LOG_KEYS) {
    const oldestKey = requestLog.keys().next().value;
    if (oldestKey !== undefined) {
      requestLog.delete(oldestKey);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Resolve an API key to a tenant. Accepts either a raw key (from header/query)
 * or a key hash. Returns null if the key is invalid, expired, or inactive.
 */
async function resolveApiKey(rawKey: string) {
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const row = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.keyHash, keyHash),
      eq(apiKeys.isActive, true),
      or(
        isNull(apiKeys.expiresAt),
        gt(apiKeys.expiresAt, new Date())
      )
    )
  });

  if (!row) return null;

  // Update last_used_at and call_count
  await db.update(apiKeys)
    .set({ 
      lastUsedAt: new Date(),
      callCount: sql`${apiKeys.callCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(apiKeys.id, row.id));

  return row;
}

/**
 * Sanitize a string value — trim, limit length, strip control characters.
 */
function sanitizeString(val: string | null | undefined, maxLen = 200): string | null {
  if (val == null) return null;
  const s = String(val).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s || null;
}

/** Convert a single snake_case key to camelCase. */
function toCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Convert snake_case keys to camelCase for database insertion.
 * Handles both camelCase and snake_case input transparently.
 */
function normalizeFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data)) {
    out[toCamelKey(key)] = val;
  }
  return out;
}

/**
 * Sanitize a customFields JSONB value: validate size, depth, and key count.
 * Returns the original value if valid, or `{}` if invalid (with a warning logged).
 */
function sanitizeCustomFields(raw: unknown, entity: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result = validateJsonb(raw, { label: `${entity}.customFields` });
  if (!result.valid) {
    console.warn(`[webhook] ${result.error} — sanitizing to empty`);
    return {};
  }
  return raw as Record<string, unknown>;
}

/**
 * Return `value` only when it is a well-formed uuid, otherwise null.
 * `record_id` is a uuid column — anything else must not reach it.
 */
export function toUuidOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}

type HeaderLike = Headers | Record<string, string | string[] | undefined>;

/** Normalise either a `Headers` instance or a plain object into name/value pairs. */
function headerEntries(headers: HeaderLike): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const maybeIterable = headers as { forEach?: unknown };
  if (typeof maybeIterable.forEach === 'function') {
    (headers as Headers).forEach((value, key) => {
      out.push([key, String(value)]);
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (value === undefined) continue;
    out.push([key, Array.isArray(value) ? value.join(', ') : String(value)]);
  }
  return out;
}

/**
 * Keys each entity handler actually reads off the payload.
 *
 * NATIVE_TARGETS is the subset a field mapping is *allowed* to write; the extras
 * here are consumed by the handler but deliberately not mapping targets (`id`
 * selects the row to update, `customFields` has its own target type, `ownerId` is
 * ownership assignment). Anything outside this set is dropped on the floor, which
 * is what _ignoredKeys reports back to the sender.
 */
const HANDLER_KEYS: Record<string, readonly string[]> = {
  contact: [...(NATIVE_TARGETS['contact'] ?? []), 'id', 'customFields'],
  lead: [...(NATIVE_TARGETS['lead'] ?? []), 'id', 'customFields', 'ownerId'],
  deal: [...(NATIVE_TARGETS['deal'] ?? []), 'id', 'customFields'],
  company: [...(NATIVE_TARGETS['company'] ?? []), 'id', 'customFields'],
  task: [...(NATIVE_TARGETS['task'] ?? []), 'id', 'customFields'],
};

/**
 * Report the payload keys that nothing will read, so a sender can see that its
 * `recording_url` went nowhere instead of trusting a bare 200.
 *
 * A key routed by a field mapping counts as recognised — that is the whole point
 * of configuring the mapping — so `mappedSourceKeys` are excluded.
 */
export function collectIgnoredKeys(
  entity: string,
  data: Record<string, unknown>,
  mappedSourceKeys: readonly string[] = []
): string[] {
  const recognized = new Set(HANDLER_KEYS[entity] ?? []);
  if (recognized.size === 0) return [];

  const mapped = new Set<string>();
  for (const key of mappedSourceKeys) {
    mapped.add(key);
    mapped.add(toCamelKey(key));
  }

  const ignored: string[] = [];
  for (const key of Object.keys(data ?? {})) {
    const camel = toCamelKey(key);
    if (recognized.has(camel)) continue;
    if (mapped.has(key) || mapped.has(camel)) continue;
    ignored.push(key);
  }
  return ignored;
}

interface ItemMapping {
  data: Record<string, unknown>;
  applied: AppliedMapping[];
  rejected: RejectedMapping[];
}

/**
 * Route this item's unrecognised keys to their configured destinations.
 *
 * A broken or unreachable mapping table must never cost the sender an otherwise
 * valid webhook, so any failure here is logged and the raw payload is processed
 * unchanged.
 */
async function resolveItemMapping(
  item: { entity: string; data: Record<string, unknown> },
  tenantId: string,
  apiKeyId: string | null
): Promise<ItemMapping> {
  const untouched: ItemMapping = { data: item.data, applied: [], rejected: [] };

  if (!VALID_ENTITIES.has(item.entity)) return untouched;
  if (!item.data || typeof item.data !== 'object' || Array.isArray(item.data)) return untouched;

  try {
    const mappings = await loadFieldMappings(tenantId, apiKeyId, item.entity);
    if (mappings.length === 0) return untouched;
    return applyFieldMappings(item.entity, item.data, mappings);
  } catch (err) {
    void logError({ error: err, context: 'webhooks/inbound load field mappings', level: 'warning' });
    return untouched;
  }
}

/**
 * Coerce a caller-supplied money value into the string form Drizzle wants for a
 * `decimal` column (`deals.amount` is `decimal(15, 2)`), mirroring
 * `app/api/tenant/deals/route.ts` which writes `amount.toString()`.
 *
 * Numbers and numeric strings are accepted; a numeric string is passed through
 * verbatim so '2500.50' keeps its scale instead of collapsing to '2500.5'.
 * Anything non-numeric becomes '0' — never the string 'NaN', which Postgres
 * would reject and which would otherwise turn a bad field into a 500.
 */
function toDecimalString(raw: unknown): string {
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : '0';
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return '0';
    return Number.isFinite(Number(s)) ? s : '0';
  }
  return '0';
}

/**
 * Copy request headers for storage, replacing the value of any sensitive header
 * with `[REDACTED]`. Header-name matching is case-insensitive.
 */
export function redactHeaders(headers: HeaderLike | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, value] of headerEntries(headers)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value;
  }
  return out;
}

/**
 * Build the `payload` jsonb value: the raw body as received, plus `_ignoredKeys`
 * when fields were dropped. Bodies larger than 64 KB are replaced by a stub so a
 * single request cannot bloat the audit table.
 */
export function buildStoredPayload(
  body: unknown,
  ignoredKeys: string[] = []
): Record<string, unknown> | null {
  if (body === undefined) {
    return ignoredKeys.length > 0 ? { _ignoredKeys: ignoredKeys } : null;
  }

  let serialized: string | null;
  try {
    serialized = JSON.stringify(body) ?? null;
  } catch {
    serialized = null;
  }

  const size = serialized === null ? 0 : Buffer.byteLength(serialized, 'utf8');

  let payload: Record<string, unknown>;
  if (serialized === null || size > MAX_STORED_PAYLOAD_BYTES) {
    payload = { _truncated: true, _originalSize: size };
  } else if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    payload = { ...(body as Record<string, unknown>) };
  } else {
    payload = { _body: body };
  }

  if (ignoredKeys.length > 0) payload._ignoredKeys = ignoredKeys;
  return payload;
}

/**
 * Log a webhook delivery attempt, including the raw body and (redacted) headers
 * so an unexpected payload shape stays recoverable and replayable.
 */
export async function logWebhookDelivery(input: {
  tenantId: string;
  apiKeyId: string | null;
  action: string;
  entity: string;
  status: string;
  statusCode: number;
  errorMessage: string | null;
  recordId: string | null;
  payloadSize: number;
  body?: unknown;
  headers?: HeaderLike | null;
  data?: Record<string, unknown>;
}) {
  try {
    const succeeded = input.status === 'success';
    const ignoredKeys = input.data ? collectIgnoredKeys(input.entity, input.data) : [];

    await db.insert(webhookInboundLogs).values({
      tenantId: input.tenantId,
      apiKeyId: input.apiKeyId,
      action: input.action,
      entity: input.entity,
      status: input.status,
      statusCode: input.statusCode,
      errorMessage: input.errorMessage?.slice(0, 1000) ?? null,
      recordId: toUuidOrNull(input.recordId),
      payloadSize: input.payloadSize,
      payload: buildStoredPayload(input.body, ignoredKeys),
      headers: redactHeaders(input.headers),
      processed: succeeded,
      processedAt: succeeded ? new Date() : null,
      createdAt: new Date(),
    });
  } catch (err) {
    void logError({ error: err, context: 'webhooks/inbound log delivery', level: 'warning' });
  }
}

// ── Entity handlers ────────────────────────────────────────────────────

interface EntityResult {
  id: string | null;
  action: 'created' | 'updated';
}

/**
 * Create or upsert a contact.
 * Duplicates are prevented by email within the tenant.
 */
async function handleContact(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string,
  tx: typeof db
): Promise<EntityResult> {
  const d = normalizeFields(raw);

  const email = sanitizeString(d['email'] as string, 255)?.toLowerCase() ?? null;
  const firstName = sanitizeString(d['firstName'] as string, 100);
  if (!firstName) throw new Error('first_name is required');

  // Check duplicate email
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existing: any = null;
  if (email) {
    existing = await tx.query.contacts.findFirst({
      where: and(
        eq(contacts.tenantId, tenantId),
        eq(contacts.email, email),
        eq(contacts.isArchived, false),
        isNull(contacts.deletedAt)
      )
    });
  }

  // On plain "create" with a duplicate, reject
  if (action === 'create' && existing) {
    throw new Error(`Duplicate contact with email ${email} (id: ${existing.id})`);
  }

  const contactData = {
    firstName,
    lastName: sanitizeString(d['lastName'] as string, 100) ?? '',
    email,
    phone: sanitizeString(d['phone'] as string, 50),
    companyId: (d['companyId'] as string) || null,
    assignedTo: (d['assignedTo'] as string) || userId,
    leadStatus: (d['leadStatus'] as string) || 'new',
    leadSource: sanitizeString(d['leadSource'] as string, 100),
    notes: sanitizeString(d['notes'] as string, 5000),
    tags: Array.isArray(d['tags']) ? d['tags'] : [],
    score: typeof d['score'] === 'number' ? d['score'] : 0,
    city: sanitizeString(d['city'] as string, 100),
    country: sanitizeString(d['country'] as string, 100),
    website: sanitizeString(d['website'] as string, 500),
    linkedinUrl: sanitizeString(d['linkedinUrl'] as string, 500),
    twitterUrl: sanitizeString(d['twitterUrl'] as string, 500),
    customFields: sanitizeCustomFields(d['customFields'], 'contact'),
    updatedAt: new Date(),
  };

  // On "update", require existing record
  if (action === 'update' && !existing) {
    // Try by ID if provided
    const byId = d['id'] ? await tx.query.contacts.findFirst({
      where: and(
        eq(contacts.id, d['id'] as string),
        eq(contacts.tenantId, tenantId)
      )
    }) : null;
    if (!byId) throw new Error('Contact not found for update');
    
    await tx.update(contacts).set(contactData).where(eq(contacts.id, byId.id));
    return { id: byId.id, action: 'updated' };
  }

  // Create (or upsert = create if not exists)
  if (existing) {
    // Upsert: update the existing contact
    await tx.update(contacts).set(contactData).where(eq(contacts.id, existing.id));
    return { id: existing.id, action: 'updated' };
  }

  const [newContact] = await tx.insert(contacts).values({
    ...contactData,
    tenantId,
    createdBy: userId,
    createdAt: new Date(),
  }).returning();

  return { id: newContact?.id ?? null, action: 'created' };
}

/**
 * Create or upsert a lead.
 */
async function handleLead(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string,
  tx: typeof db
): Promise<EntityResult> {
  const d = normalizeFields(raw);

  const email = sanitizeString(d['email'] as string, 255)?.toLowerCase();
  const firstName = sanitizeString(d['firstName'] as string, 100);
  if (!firstName) throw new Error('first_name is required for lead');

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existing: any = null;
  if (email) {
    existing = await tx.query.leads.findFirst({
      where: and(
        eq(leads.tenantId, tenantId),
        eq(leads.email, email),
        isNull(leads.deletedAt)
      )
    });
  }

  if (action === 'create' && existing) {
    throw new Error(`Duplicate lead with email ${email} (id: ${existing.id})`);
  }

  const leadData = {
    firstName,
    lastName: sanitizeString(d['lastName'] as string, 100) ?? '',
    email,
    phone: sanitizeString(d['phone'] as string, 50),
    mobile: sanitizeString(d['mobile'] as string, 50),
    title: sanitizeString(d['title'] as string, 200),
    companyName: sanitizeString(d['companyName'] as string, 200),
    source: sanitizeString(d['leadSource'] as string, 100) ?? 'api',
    leadStatus: sanitizeString(d['leadStatus'] as string, 50) ?? 'new',
    lifecycleStage: sanitizeString(d['lifecycleStage'] as string, 50) ?? 'lead',
    assignedTo: (d['assignedTo'] as string) || userId,
    tags: Array.isArray(d['tags']) ? d['tags'] : [],
    notes: sanitizeString(d['notes'] as string, 5000),
    customFields: sanitizeCustomFields(d['customFields'], 'lead'),
    updatedAt: new Date(),
  };

  if (action === 'update') {
    const targetId = (d['id'] as string) || existing?.id;
    if (!targetId) throw new Error('Lead id is required for update');
    
    const check = await tx.query.leads.findFirst({
      where: and(
        eq(leads.id, targetId),
        eq(leads.tenantId, tenantId)
      )
    });
    if (!check) throw new Error('Lead not found for update');
    
    await tx.update(leads).set(leadData).where(eq(leads.id, targetId));
    return { id: targetId, action: 'updated' };
  }

  if (existing) {
    // Upsert — update existing
    await tx.update(leads).set(leadData).where(eq(leads.id, existing.id));
    return { id: existing.id, action: 'updated' };
  }

  const [newLead] = await tx.insert(leads).values({
    ...leadData,
    tenantId,
    createdBy: userId,
    ownerId: (d['ownerId'] as string) || userId,
    createdAt: new Date(),
  }).returning();

  return { id: newLead?.id ?? null, action: 'created' };
}

interface ResolvedStage {
  stageId: string;
  pipelineId: string;
}

/**
 * Resolve the stage the caller asked for, tenant-scoped.
 *
 * Mirrors `app/api/tenant/deals/route.ts`: a stage id wins over a stage name,
 * and a name is matched case-insensitively against `deal_stages` joined to
 * `pipelines` so the tenant filter lives on the pipeline row.
 *
 * A caller-supplied id is *never* trusted as-is: it has to come back from the
 * tenant-scoped query, otherwise a webhook key for tenant A could park a deal on
 * tenant B's stage. Returns null when the caller asked for nothing, or asked by
 * a name that matches nothing (the caller's spelling is not authoritative — the
 * create path then falls back to the default pipeline).
 */
async function resolveRequestedStage(
  suppliedStageId: string | null,
  stageName: string | null,
  tenantId: string
): Promise<ResolvedStage | null> {
  if (suppliedStageId) {
    if (!UUID_RE.test(suppliedStageId)) {
      throw new Error(`stage_id must be a uuid (got "${suppliedStageId}"); use "stage" to reference a stage by name`);
    }

    const [row] = await db
      .select({ id: dealStages.id, pipelineId: dealStages.pipelineId })
      .from(dealStages)
      .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
      .where(and(
        eq(dealStages.id, suppliedStageId),
        eq(pipelines.tenantId, tenantId)
      ))
      .limit(1);

    if (!row) {
      throw new Error(`stage_id ${suppliedStageId} does not belong to this tenant`);
    }
    return { stageId: row.id, pipelineId: row.pipelineId };
  }

  if (stageName) {
    const [row] = await db
      .select({ id: dealStages.id, pipelineId: dealStages.pipelineId })
      .from(dealStages)
      .innerJoin(pipelines, eq(pipelines.id, dealStages.pipelineId))
      .where(and(
        ilike(dealStages.name, escapeLike(stageName)),
        eq(pipelines.tenantId, tenantId)
      ))
      .limit(1);

    if (row) return { stageId: row.id, pipelineId: row.pipelineId };
  }

  return null;
}

/**
 * Fallback for a create with no usable stage input: the first stage of the
 * tenant's default pipeline. `isDefault DESC` puts the flagged pipeline first
 * and still yields a pipeline when none is flagged; `order ASC` then picks the
 * left-most stage. Returns null when the tenant has no pipelines or no stages.
 */
async function resolveDefaultStage(tenantId: string): Promise<ResolvedStage | null> {
  const [pipeline] = await db
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(and(
      eq(pipelines.tenantId, tenantId),
      isNull(pipelines.deletedAt)
    ))
    .orderBy(desc(pipelines.isDefault), asc(pipelines.createdAt))
    .limit(1);

  if (!pipeline) return null;

  const [stage] = await db
    .select({ id: dealStages.id, pipelineId: dealStages.pipelineId })
    .from(dealStages)
    .where(and(
      eq(dealStages.tenantId, tenantId),
      eq(dealStages.pipelineId, pipeline.id),
      isNull(dealStages.deletedAt)
    ))
    .orderBy(asc(dealStages.order))
    .limit(1);

  if (!stage) return null;
  return { stageId: stage.id, pipelineId: stage.pipelineId };
}

/**
 * Create or update a deal.
 */
async function handleDeal(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string,
  tx: typeof db
): Promise<EntityResult> {
  const d = normalizeFields(raw);
  const title = sanitizeString(d['title'] as string, 200);
  if (!title) throw new Error('title is required for deal');

  // `deals` has no `value`, `stage`, `probability` or `notes` column. Every one of
  // those keys used to be handed to Drizzle anyway, which emits only columns it
  // knows about, so they were silently dropped on update while the caller got a
  // 200. They are now mapped onto columns that exist: `value`/`amount` → `amount`,
  // `stage`/`stage_id` → `stageId` (+ `pipelineId`), and `probability`/`notes` →
  // keys inside the `customFields` jsonb, so nothing the caller sends is lost.
  const amount = toDecimalString(d['amount'] ?? d['value']);

  const customFields: Record<string, unknown> = sanitizeCustomFields(d['customFields'], 'deal');
  const probabilityRaw = d['probability'];
  if (probabilityRaw !== undefined && probabilityRaw !== null) {
    const n = typeof probabilityRaw === 'number' ? probabilityRaw : Number(String(probabilityRaw).trim());
    // Keep a usable number when we can, otherwise keep the caller's own text
    // rather than storing NaN.
    customFields['probability'] = Number.isFinite(n) ? n : sanitizeString(String(probabilityRaw), 50);
  }
  const notes = sanitizeString(d['notes'] as string, 5000);
  if (notes) customFields['notes'] = notes;

  // normalizeFields() has already folded `stage_id` into `stageId`.
  const suppliedStageId = sanitizeString(d['stageId'] as string, 64);
  const stageName = sanitizeString(d['stage'] as string, 100);
  // Only touch the stage columns when the caller actually said something about
  // the stage — an update that omits it must leave the existing stage alone.
  const requestedStage = (suppliedStageId || stageName)
    ? await resolveRequestedStage(suppliedStageId, stageName, tenantId)
    : null;

  const dealData = {
    title,
    amount,
    closeDate: d['closeDate'] ? new Date(d['closeDate'] as string) : null,
    contactId: (d['contactId'] as string) || null,
    companyId: (d['companyId'] as string) || null,
    assignedTo: (d['assignedTo'] as string) || userId,
    customFields,
    updatedAt: new Date(),
    ...(requestedStage
      ? { stageId: requestedStage.stageId, pipelineId: requestedStage.pipelineId }
      : {}),
  };

  if (action === 'update' || action === 'upsert') {
    const dealId = d['id'] as string | null;
    if (dealId) {
      const check = await tx.query.deals.findFirst({
        where: and(
          eq(deals.id, dealId),
          eq(deals.tenantId, tenantId),
          isNull(deals.deletedAt)
        )
      });
      if (check) {
        await tx.update(deals).set(dealData).where(eq(deals.id, dealId));
        return { id: dealId, action: 'updated' };
      }
      if (action === 'update') throw new Error('Deal not found for update');
    }
  }

  // `stageId` is a `notNull()` uuid, so the old `stageId: ''` placeholder made
  // every create fail with `invalid input syntax for type uuid: ""`. Resolve a
  // real stage instead: what the caller asked for, else the default pipeline's
  // first stage. No `as unknown as typeof deals.$inferInsert` cast is needed —
  // every key below is now a genuine `deals` column, so the compiler checks the
  // payload instead of a cast hiding the mismatch.
  const stage = requestedStage ?? await resolveDefaultStage(tenantId);
  if (!stage) {
    throw new Error(
      'Cannot determine a stage for this deal: send "stage_id" (a uuid belonging to this tenant) or "stage" (an existing stage name), or create a pipeline with at least one stage for this tenant first'
    );
  }

  const [newDeal] = await tx.insert(deals).values({
    ...dealData,
    tenantId,
    stageId: stage.stageId,
    pipelineId: stage.pipelineId,
    stageEnteredAt: new Date(),
    createdBy: userId,
    createdAt: new Date(),
  }).returning();

  return { id: newDeal?.id ?? null, action: 'created' };
}

/**
 * Create or update a company.
 */
async function handleCompany(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string,
  tx: typeof db
): Promise<EntityResult> {
  const d = normalizeFields(raw);
  const name = sanitizeString(d['name'] as string, 200);
  if (!name) throw new Error('name is required for company');

  const companyData = {
    name,
    industry: sanitizeString(d['industry'] as string, 100),
    size: sanitizeString(d['size'] as string, 50),
    website: sanitizeString(d['website'] as string, 500),
    phone: sanitizeString(d['phone'] as string, 50),
    address: sanitizeString(d['address'] as string, 500),
    notes: sanitizeString(d['notes'] as string, 5000),
    customFields: sanitizeCustomFields(d['customFields'], 'company'),
    updatedAt: new Date(),
  };

  if (action === 'update' || action === 'upsert') {
    const companyId = d['id'] as string | null;
    if (companyId) {
      const check = await tx.query.companies.findFirst({
        where: and(
          eq(companies.id, companyId),
          eq(companies.tenantId, tenantId)
        )
      });
      if (check) {
        await tx.update(companies).set(companyData).where(eq(companies.id, companyId));
        return { id: companyId, action: 'updated' };
      }
      if (action === 'update') throw new Error('Company not found for update');
    }
  }

  const [newCompany] = await tx.insert(companies).values({
    ...companyData,
    tenantId,
    createdBy: userId,
    createdAt: new Date(),
  }).returning();

  return { id: newCompany?.id ?? null, action: 'created' };
}

/**
 * Create or update a task.
 */
async function handleTask(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string,
  tx: typeof db
): Promise<EntityResult> {
  const d = normalizeFields(raw);
  const title = sanitizeString(d['title'] as string, 200);
  if (!title) throw new Error('title is required for task');

  const taskData = {
    title,
    description: sanitizeString(d['description'] as string, 5000),
    dueDate: d['dueDate'] ? new Date(d['dueDate'] as string) : null,
    priority: sanitizeString(d['priority'] as string, 20) ?? 'medium',
    contactId: (d['contactId'] as string) || null,
    dealId: (d['dealId'] as string) || null,
    assignedTo: (d['assignedTo'] as string) || userId,
    completed: typeof d['completed'] === 'boolean' ? d['completed'] : false,
    customFields: sanitizeCustomFields(d['customFields'], 'task'),
    updatedAt: new Date(),
  };

  if (action === 'update') {
    const taskId = d['id'] as string | null;
    if (!taskId) throw new Error('id is required to update a task');
    
    const check = await tx.query.tasks.findFirst({
      where: and(
        eq(tasks.id, taskId),
        eq(tasks.tenantId, tenantId),
        isNull(tasks.deletedAt)
      )
    });
    if (!check) throw new Error('Task not found for update');
    
    await tx.update(tasks).set(taskData).where(eq(tasks.id, taskId));
    return { id: taskId, action: 'updated' };
  }

  const [newTask] = await tx.insert(tasks).values({
    ...taskData,
    tenantId,
    createdBy: userId,
    createdAt: new Date(),
  }).returning();

  return { id: newTask?.id ?? null, action: 'created' };
}

// ── Single item processor ──────────────────────────────────────────────

async function processItem(
  item: { action: string; entity: string; data: Record<string, unknown> },
  tenantId: string,
  userId: string,
  tx: typeof db
): Promise<EntityResult> {
  const { action, entity, data } = item;

  if (!VALID_ACTIONS.has(action)) throw new Error(`Invalid action: ${action}. Must be one of: ${[...VALID_ACTIONS].join(', ')}`);
  if (!VALID_ENTITIES.has(entity)) throw new Error(`Invalid entity: ${entity}. Must be one of: ${[...VALID_ENTITIES].join(', ')}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be a non-empty object');

  switch (entity) {
    case 'contact': return await handleContact(action, data, tenantId, userId, tx);
    case 'lead':    return await handleLead(action, data, tenantId, userId, tx);
    case 'deal':    return await handleDeal(action, data, tenantId, userId, tx);
    case 'company': return await handleCompany(action, data, tenantId, userId, tx);
    case 'task':    return await handleTask(action, data, tenantId, userId, tx);
    default:        throw new Error(`Unsupported entity: ${entity}`);
  }
}

// ── Route handler ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let apiKeyRow: Awaited<ReturnType<typeof resolveApiKey>> = null;
  let keyPrefix = 'unknown';
  // Hoisted so the outer catch can still persist whatever body it received.
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;

  try {
    // 1. Extract API key
    const authHeader = request.headers.get('x-api-key');
    const url = new URL(request.url);
    const queryKey = url.searchParams.get('api_key');
    const rawKey = authHeader || queryKey;

    if (!rawKey) {
      return NextResponse.json(
        { error: 'API key required. Provide via X-API-Key header or ?api_key= query parameter.' },
        { status: 401 }
      );
    }

    // 2. Resolve API key
    apiKeyRow = await resolveApiKey(rawKey);
    if (!apiKeyRow) {
      return NextResponse.json({ error: 'Invalid, expired, or inactive API key.' }, { status: 401 });
    }

    keyPrefix = apiKeyRow.prefix;

    // 3. Rate limiting (per API key)
    try {
      await inboundLimiter.enforce(`inbound:${apiKeyRow.id}`);
    } catch {
      logRequest(keyPrefix, 429, request.nextUrl.pathname);
      return NextResponse.json(
        { error: 'Rate limit exceeded. Max 100 requests per minute.' },
        { status: 429, headers: getRateLimitHeaders({ allowed: false, remaining: 0, reset: Date.now() + 60000, limit: 100 }) }
      );
    }

    // 4. Payload size check
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_PAYLOAD_SIZE) {
      logRequest(keyPrefix, 413, request.nextUrl.pathname);
      return NextResponse.json(
        { error: `Payload too large. Max ${MAX_PAYLOAD_SIZE / 1_000_000}MB.` },
        { status: 413 }
      );
    }

    // 5. Parse JSON
    try {
      const text = await request.text();
      if (text.length > MAX_PAYLOAD_SIZE) {
        logRequest(keyPrefix, 413, request.nextUrl.pathname);
        return NextResponse.json(
          { error: `Payload too large. Max ${MAX_PAYLOAD_SIZE / 1_000_000}MB.` },
          { status: 413 }
        );
      }
      body = JSON.parse(text);
    } catch {
      logRequest(keyPrefix, 400, request.nextUrl.pathname);
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
    }

    // 6. Determine items to process
    const items: Array<{ action: string; entity: string; data: Record<string, unknown> }> = [];

    if (body.batch) {
      if (!Array.isArray(body.batch)) {
        logRequest(keyPrefix, 400, request.nextUrl.pathname);
        return NextResponse.json({ error: 'batch must be an array.' }, { status: 400 });
      }
      if (body.batch.length > MAX_BATCH_SIZE) {
        logRequest(keyPrefix, 400, request.nextUrl.pathname);
        return NextResponse.json(
          { error: `Batch too large. Max ${MAX_BATCH_SIZE} items per request.` },
          { status: 400 }
        );
      }
      items.push(...body.batch);
    } else if (body.action && body.entity && body.data) {
      items.push({ action: body.action, entity: body.entity, data: body.data });
    } else {
      logRequest(keyPrefix, 400, request.nextUrl.pathname);
      return NextResponse.json(
        { error: 'Invalid payload. Expected { action, entity, data } or { batch: [...] }.' },
        { status: 400 }
      );
    }

    // 7. Process each item
    const results: Array<{
      entity: string;
      action: string;
      id: string | null;
      status: string;
      error?: string;
      mapped: number;
      rejected_mappings: RejectedMapping[];
      _ignoredKeys: string[];
    }> = [];
    let hasError = false;

    if (!apiKeyRow) {
      return NextResponse.json({ error: 'API key not resolved' }, { status: 500 });
    }

    const currentKey = apiKeyRow;

    for (const item of items) {
      // Route configured keys before the handler sees the payload, so a mapped
      // key reaches the record instead of being silently discarded.
      const mapping = await resolveItemMapping(item, currentKey.tenantId, currentKey.id);
      const mappedItem = { ...item, data: mapping.data };
      const ignoredKeys = collectIgnoredKeys(
        item.entity,
        item.data,
        mapping.applied.map((a) => a.sourceKey)
      );

      try {
        const result = await db.transaction(async (tx) => {
          const r = await processItem(mappedItem, currentKey.tenantId, currentKey.userId!, tx);

          // Log delivery inside the same transaction
          await logWebhookDelivery({
            tenantId: currentKey.tenantId,
            apiKeyId: currentKey.id,
            action: item.action,
            entity: item.entity,
            status: 'success',
            statusCode: 200,
            errorMessage: null,
            recordId: r.id,
            payloadSize: contentLength || 0,
            body,
            headers: request.headers,
            data: item.data,
          });

          return r;
        });

        results.push({
          entity: item.entity,
          action: result.action,
          id: result.id,
          status: 'ok',
          mapped: mapping.applied.length,
          rejected_mappings: mapping.rejected,
          _ignoredKeys: ignoredKeys,
        });

        // Fire outgoing webhooks for created records (outside transaction — uses own db)
        if (result.action === 'created') {
          const eventType = `${item.entity}.created` as WebhookEvent;
          fireWebhooks(currentKey.tenantId, eventType, { id: result.id }).catch((err) => logError({ error: err, context: 'webhooks/inbound async side-effect' }));
        }

        // Log audit entry (outside transaction — uses own db)
        logAudit({
          tenantId: currentKey.tenantId,
          userId: currentKey.userId!,
          action: result.action === 'created' ? 'create' : 'update',
          entityType: item.entity,
          entityId: result.id as string,
          newData: { source: 'inbound_webhook', api_key: currentKey.name },
        }).catch((err) => logError({ error: err, context: 'webhooks/inbound async side-effect' }));

 

// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        hasError = true;
        results.push({
          entity: item.entity,
          action: item.action,
          id: null,
          status: 'error',
          error: "Internal server error",
          mapped: mapping.applied.length,
          rejected_mappings: mapping.rejected,
          _ignoredKeys: ignoredKeys,
        });

        logWebhookDelivery({
          tenantId: currentKey.tenantId,
          apiKeyId: currentKey.id,
          action: item.action,
          entity: item.entity,
          status: 'error',
          statusCode: 400,
          errorMessage: err.message,
          recordId: null,
          payloadSize: contentLength || 0,
          body,
          headers: request.headers,
          data: item.data,
        });
      }
    }

    const statusCode = hasError ? 207 : 200;
    const duration = Date.now() - startTime;

    logRequest(keyPrefix, statusCode, request.nextUrl.pathname);

    // Audit log — written in all environments so inbound webhook activity is
    // always traceable, not only in production.
    await logAudit({
      tenantId: currentKey.tenantId,
      userId: currentKey.userId!,
      action: 'webhook_inbound',
      entityType: 'api',
      entityId: 'batch',
      newData: { processed: results.length, succeeded: results.filter(r => r.status === 'ok').length, failed: results.filter(r => r.status === 'error').length, duration_ms: duration },
    }).catch((err) => logError({ error: err, context: 'webhooks/inbound async side-effect' }));

    // Dev log
    devLogger.request('POST', request.nextUrl.pathname, statusCode, duration);

    return NextResponse.json(
      {
        ok: !hasError,
        processed: results.length,
        succeeded: results.filter(r => r.status === 'ok').length,
        failed: results.filter(r => r.status === 'error').length,
        results,
        duration_ms: duration,
      },
      { status: statusCode }
    );
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    const duration = Date.now() - startTime;
    void logError({ error: err, context: 'webhooks/inbound POST' });

    if (apiKeyRow) {
      logWebhookDelivery({
        tenantId: apiKeyRow.tenantId,
        apiKeyId: apiKeyRow.id,
        action: 'unknown',
        entity: 'unknown',
        status: 'error',
        statusCode: 500,
        errorMessage: err.message,
        recordId: null,
        payloadSize: 0,
        body,
        headers: request.headers,
      });
      logRequest(keyPrefix, 500, request.nextUrl.pathname);
    }

    return NextResponse.json(
      { error: 'Internal server error', duration_ms: duration },
      { status: 500 }
    );
  }
}

// ── GET endpoint for health check / stats ──────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('x-api-key');
    const url = new URL(request.url);
    const queryKey = url.searchParams.get('api_key');
    const rawKey = authHeader || queryKey;

    if (!rawKey) {
      return NextResponse.json({ error: 'API key required.' }, { status: 401 });
    }

    const apiKeyRow = await resolveApiKey(rawKey);
    if (!apiKeyRow) {
      return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 });
    }

    const logs = requestLog.get(apiKeyRow.prefix) ?? [];

    return NextResponse.json({
      status: 'ok',
      key_name: apiKeyRow.name,
      key_prefix: apiKeyRow.prefix,
      tenant_id: apiKeyRow.tenantId,
      recent_requests: logs.length,
      recent_activity: logs.slice(-10).reverse(),
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    void logError({ error: err, context: 'webhooks/inbound GET' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
