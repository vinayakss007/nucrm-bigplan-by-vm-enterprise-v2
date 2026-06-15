import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { db } from '@/drizzle/db';
import { apiKeys, webhookInboundLogs, contacts, leads, deals, companies, tasks } from '@/drizzle/schema';
import { eq, and, or, isNull, gt, sql } from 'drizzle-orm';
import { RateLimiter, getRateLimitHeaders } from '@/lib/rate-limit';
import { fireWebhooks, type WebhookEvent } from '@/lib/webhooks';
import { logAudit } from '@/lib/audit';
import { devLogger } from '@/lib/dev-logger';
import { logError } from '@/lib/errors-server';

// ── Constants ──────────────────────────────────────────────────────────
const MAX_PAYLOAD_SIZE = 1_000_000; // 1 MB
const MAX_BATCH_SIZE = 100;
const VALID_ACTIONS = new Set(['create', 'update', 'upsert']);
const VALID_ENTITIES = new Set(['contact', 'lead', 'deal', 'company', 'task']);

// Rate limiter: 100 requests per API key per minute
const inboundLimiter = new RateLimiter({ max: 100, window: 60 });

// ── In-memory request tracking (last 100 per API key prefix) ──────────
const requestLog = new Map<string, Array<{ ts: number; status: number; path: string }>>();
const MAX_LOG_PER_KEY = 100;

function logRequest(keyPrefix: string, status: number, path: string) {
  const entries = requestLog.get(keyPrefix) ?? [];
  entries.push({ ts: Date.now(), status, path });
  if (entries.length > MAX_LOG_PER_KEY) entries.splice(0, entries.length - MAX_LOG_PER_KEY);
  requestLog.set(keyPrefix, entries);
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
      callCount: sql`${apiKeys.callCount} + 1`
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

/**
 * Convert snake_case keys to camelCase for database insertion.
 * Handles both camelCase and snake_case input transparently.
 */
function normalizeFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data)) {
    // Convert snake_case to camelCase
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = val;
  }
  return out;
}

/**
 * Log a webhook delivery attempt.
 */
async function logWebhookDelivery(input: {
  tenantId: string;
  apiKeyId: string | null;
  action: string;
  entity: string;
  status: string;
  statusCode: number;
  errorMessage: string | null;
  recordId: string | null;
  payloadSize: number;
}) {
  try {
    await db.insert(webhookInboundLogs).values({
      tenantId: input.tenantId,
      apiKeyId: input.apiKeyId,
      action: input.action,
      entity: input.entity,
      status: input.status,
      statusCode: input.statusCode,
      errorMessage: input.errorMessage?.slice(0, 1000) ?? null,
      recordId: input.recordId ? Number(input.recordId) : null,
      payloadSize: input.payloadSize,
      createdAt: new Date(),
    } as unknown as typeof webhookInboundLogs.$inferInsert);
  } catch (err) {
    console.error('[webhook] Failed to log delivery:', err);
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
  userId: string
): Promise<EntityResult> {
  const d = normalizeFields(raw);

  const email = sanitizeString(d['email'] as string, 255)?.toLowerCase() ?? null;
  const firstName = sanitizeString(d['firstName'] as string, 100);
  if (!firstName) throw new Error('first_name is required');

  // Check duplicate email
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existing: any = null;
  if (email) {
    existing = await db.query.contacts.findFirst({
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
    customFields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
    updatedAt: new Date(),
  };

  // On "update", require existing record
  if (action === 'update' && !existing) {
    // Try by ID if provided
    const byId = d['id'] ? await db.query.contacts.findFirst({
      where: and(
        eq(contacts.id, d['id'] as string),
        eq(contacts.tenantId, tenantId)
      )
    }) : null;
    if (!byId) throw new Error('Contact not found for update');
    
    await db.update(contacts).set(contactData).where(eq(contacts.id, byId.id));
    return { id: byId.id, action: 'updated' };
  }

  // Create (or upsert = create if not exists)
  if (existing) {
    // Upsert: update the existing contact
    await db.update(contacts).set(contactData).where(eq(contacts.id, existing.id));
    return { id: existing.id, action: 'updated' };
  }

  const [newContact] = await db.insert(contacts).values({
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
  userId: string
): Promise<EntityResult> {
  const d = normalizeFields(raw);

  const email = sanitizeString(d['email'] as string, 255)?.toLowerCase();
  const firstName = sanitizeString(d['firstName'] as string, 100);
  if (!firstName) throw new Error('first_name is required for lead');

 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existing: any = null;
  if (email) {
    existing = await db.query.leads.findFirst({
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
    customFields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
    updatedAt: new Date(),
  };

  if (action === 'update') {
    const targetId = (d['id'] as string) || existing?.id;
    if (!targetId) throw new Error('Lead id is required for update');
    
    const check = await db.query.leads.findFirst({
      where: and(
        eq(leads.id, targetId),
        eq(leads.tenantId, tenantId)
      )
    });
    if (!check) throw new Error('Lead not found for update');
    
    await db.update(leads).set(leadData).where(eq(leads.id, targetId));
    return { id: targetId, action: 'updated' };
  }

  if (existing) {
    // Upsert — update existing
    await db.update(leads).set(leadData).where(eq(leads.id, existing.id));
    return { id: existing.id, action: 'updated' };
  }

  const [newLead] = await db.insert(leads).values({
    ...leadData,
    tenantId,
    createdBy: userId,
    ownerId: (d['ownerId'] as string) || userId,
    createdAt: new Date(),
  }).returning();

  return { id: newLead?.id ?? null, action: 'created' };
}

/**
 * Create or update a deal.
 */
async function handleDeal(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string
): Promise<EntityResult> {
  const d = normalizeFields(raw);
  const title = sanitizeString(d['title'] as string, 200);
  if (!title) throw new Error('title is required for deal');

  const value = typeof d['value'] === 'number' ? d['value'] : (d['value'] ? parseFloat(String(d['value'])) || 0 : 0);
  const probability = typeof d['probability'] === 'number' ? d['probability'] : (d['probability'] ? parseInt(String(d['probability'])) : 10);

  const dealData = {
    title,
    value: String(value), // Decimal in Drizzle
    stage: sanitizeString(d['stage'] as string, 50) ?? 'lead',
    probability,
    closeDate: d['closeDate'] ? new Date(d['closeDate'] as string) : null,
    contactId: (d['contactId'] as string) || null,
    companyId: (d['companyId'] as string) || null,
    assignedTo: (d['assignedTo'] as string) || userId,
    notes: sanitizeString(d['notes'] as string, 5000),
    customFields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
    updatedAt: new Date(),
  };

  if (action === 'update' || action === 'upsert') {
    const dealId = d['id'] as string | null;
    if (dealId) {
      const check = await db.query.deals.findFirst({
        where: and(
          eq(deals.id, dealId),
          eq(deals.tenantId, tenantId),
          isNull(deals.deletedAt)
        )
      });
      if (check) {
        await db.update(deals).set(dealData).where(eq(deals.id, dealId));
        return { id: dealId, action: 'updated' };
      }
      if (action === 'update') throw new Error('Deal not found for update');
    }
  }

  const [newDeal] = await db.insert(deals).values({
    ...dealData,
    tenantId,
    stageId: '', // placeholder - will be resolved
    createdBy: userId,
    createdAt: new Date(),
  } as unknown as typeof deals.$inferInsert).returning();

  return { id: newDeal?.id ?? null, action: 'created' };
}

/**
 * Create or update a company.
 */
async function handleCompany(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string
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
    customFields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
    updatedAt: new Date(),
  };

  if (action === 'update' || action === 'upsert') {
    const companyId = d['id'] as string | null;
    if (companyId) {
      const check = await db.query.companies.findFirst({
        where: and(
          eq(companies.id, companyId),
          eq(companies.tenantId, tenantId)
        )
      });
      if (check) {
        await db.update(companies).set(companyData).where(eq(companies.id, companyId));
        return { id: companyId, action: 'updated' };
      }
      if (action === 'update') throw new Error('Company not found for update');
    }
  }

  const [newCompany] = await db.insert(companies).values({
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
  userId: string
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
    updatedAt: new Date(),
  };

  if (action === 'update') {
    const taskId = d['id'] as string | null;
    if (!taskId) throw new Error('id is required to update a task');
    
    const check = await db.query.tasks.findFirst({
      where: and(
        eq(tasks.id, taskId),
        eq(tasks.tenantId, tenantId),
        isNull(tasks.deletedAt)
      )
    });
    if (!check) throw new Error('Task not found for update');
    
    await db.update(tasks).set(taskData).where(eq(tasks.id, taskId));
    return { id: taskId, action: 'updated' };
  }

  const [newTask] = await db.insert(tasks).values({
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
  userId: string
): Promise<EntityResult> {
  const { action, entity, data } = item;

  if (!VALID_ACTIONS.has(action)) throw new Error(`Invalid action: ${action}. Must be one of: ${[...VALID_ACTIONS].join(', ')}`);
  if (!VALID_ENTITIES.has(entity)) throw new Error(`Invalid entity: ${entity}. Must be one of: ${[...VALID_ENTITIES].join(', ')}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be a non-empty object');

  switch (entity) {
    case 'contact': return await handleContact(action, data, tenantId, userId);
    case 'lead':    return await handleLead(action, data, tenantId, userId);
    case 'deal':    return await handleDeal(action, data, tenantId, userId);
    case 'company': return await handleCompany(action, data, tenantId, userId);
    case 'task':    return await handleTask(action, data, tenantId, userId);
    default:        throw new Error(`Unsupported entity: ${entity}`);
  }
}

// ── Route handler ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let apiKeyRow: Awaited<ReturnType<typeof resolveApiKey>> = null;
  let keyPrefix = 'unknown';

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
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
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
    const results: Array<{ entity: string; action: string; id: string | null; status: string; error?: string }> = [];
    let hasError = false;

    for (const item of items) {
      try {
        const result = await processItem(item, apiKeyRow.tenantId, apiKeyRow.userId!);
        results.push({ entity: item.entity, action: result.action, id: result.id, status: 'ok' });

        // Fire outgoing webhooks for created records
        if (result.action === 'created') {
          const eventType = `${item.entity}.created` as WebhookEvent;
          fireWebhooks(apiKeyRow.tenantId, eventType, { id: result.id }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
        }

        // Log audit entry
        logAudit({
          tenantId: apiKeyRow.tenantId,
          userId: apiKeyRow.userId!,
          action: result.action === 'created' ? 'create' : 'update',
          entityType: item.entity,
          entityId: result.id as string,
          newData: { source: 'inbound_webhook', api_key: apiKeyRow.name },
        }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));

        // Log delivery
        logWebhookDelivery({
          tenantId: apiKeyRow.tenantId,
          apiKeyId: apiKeyRow.id,
          action: item.action,
          entity: item.entity,
          status: 'success',
          statusCode: 200,
          errorMessage: null,
          recordId: result.id,
          payloadSize: contentLength || 0,
        });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (err: any) {
        hasError = true;
        results.push({ entity: item.entity, action: item.action, id: null, status: 'error', error: "Internal server error" });

        logWebhookDelivery({
          tenantId: apiKeyRow.tenantId,
          apiKeyId: apiKeyRow.id,
          action: item.action,
          entity: item.entity,
          status: 'error',
          statusCode: 400,
          errorMessage: err.message,
          recordId: null,
          payloadSize: contentLength || 0,
        });
      }
    }

    const statusCode = hasError ? 207 : 200;
    const duration = Date.now() - startTime;

    logRequest(keyPrefix, statusCode, request.nextUrl.pathname);

    // Audit log
    if (process.env.NODE_ENV === 'production') {
      await logAudit({
        tenantId: apiKeyRow.tenantId,
        userId: apiKeyRow.userId!,
        action: 'webhook_inbound',
        entityType: 'api',
        entityId: 'batch',
        newData: { processed: results.length, succeeded: results.filter(r => r.status === 'ok').length, failed: results.filter(r => r.status === 'error').length, duration_ms: duration },
      }).catch((err) => logError({ error: err, context: "async-catch:[context]" }));
    }

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
    console.error('[inbound webhook]', err);

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
    console.error('[inbound webhook GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
