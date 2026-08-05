import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createWebhookFieldMappingSchema, updateWebhookFieldMappingSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { webhookFieldMappings, customFieldDefs, apiKeys } from '@/drizzle/schema';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { concurrencyGuardById } from '@/lib/api/concurrency';
import { isValidNativeTarget, NATIVE_TARGETS } from '@/lib/webhooks/field-mapping';

/**
 * Inbound webhook field mappings.
 *
 * Lets a tenant route a payload key the inbound endpoint would otherwise discard
 * (a telephony provider's `call_duration`) into a native field or a custom field,
 * with no code change and no migration.
 *
 * Every query is scoped by the tenant id from the auth context. A tenant id in
 * the request body is ignored — it is not the caller's to choose.
 */

/**
 * Validate the target of a mapping.
 *
 * `native` is checked against the per-entity allowlist, which is a security
 * boundary: without it a mapping could aim an incoming key at `tenantId`, `id` or
 * `createdBy`. `custom_field` must name a custom field that actually exists for
 * this tenant and entity, so mappings cannot point at phantom fields whose values
 * would never surface anywhere.
 */
async function validateTarget(
  tenantId: string,
  entityType: string,
  targetType: string,
  targetKey: string
): Promise<NextResponse | null> {
  if (targetType === 'native') {
    if (!isValidNativeTarget(entityType, targetKey)) {
      return NextResponse.json(
        {
          error: `'${targetKey}' is not an allowed native target for ${entityType}`,
          allowed: NATIVE_TARGETS[entityType] ?? [],
        },
        { status: 400 }
      );
    }
    return null;
  }

  const def = await db.query.customFieldDefs.findFirst({
    where: and(
      eq(customFieldDefs.tenantId, tenantId),
      eq(customFieldDefs.entityType, entityType),
      eq(customFieldDefs.fieldKey, targetKey)
    ),
  });

  if (!def) {
    return NextResponse.json(
      { error: `No custom field '${targetKey}' defined for ${entityType}. Create the custom field first.` },
      { status: 400 }
    );
  }

  return null;
}

// ── GET: List mappings ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entityType');
    const apiKeyId = searchParams.get('apiKeyId');

    const filters = [eq(webhookFieldMappings.tenantId, ctx.tenantId), isNull(webhookFieldMappings.deletedAt)];
    if (entityType) filters.push(eq(webhookFieldMappings.entityType, entityType));
    // ?apiKeyId=null asks for the tenant-wide mappings specifically.
    if (apiKeyId === 'null') {
      filters.push(isNull(webhookFieldMappings.apiKeyId));
    } else if (apiKeyId) {
      filters.push(eq(webhookFieldMappings.apiKeyId, apiKeyId));
    }

    const mappings = await db.query.webhookFieldMappings.findMany({
      limit: 200,
      where: and(...filters),
      orderBy: [asc(webhookFieldMappings.entityType), asc(webhookFieldMappings.sourceKey)],
    });

    return NextResponse.json({ mappings, nativeTargets: NATIVE_TARGETS });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

// ── POST: Create a mapping ──────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const limited = await rateLimitMutating(req, 'webhookFieldMappings', 'post');
    if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const rawBody = await readJsonBody(req);
    const validated = validateBody(createWebhookFieldMappingSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { apiKeyId, entityType, sourceKey, targetType, targetKey, transform, isActive } = validated.data;

    // An API key from another tenant must not be addressable.
    if (apiKeyId) {
      const key = await db.query.apiKeys.findFirst({
        where: and(eq(apiKeys.id, apiKeyId), eq(apiKeys.tenantId, ctx.tenantId)),
      });
      if (!key) {
        return NextResponse.json({ error: 'API key not found' }, { status: 400 });
      }
    }

    const targetError = await validateTarget(ctx.tenantId, entityType, targetType, targetKey);
    if (targetError) return targetError;

    // The unique index cannot catch this for tenant-wide rows, because Postgres
    // treats NULL api_key_id values as distinct.
    const existing = await db.query.webhookFieldMappings.findFirst({
      where: and(
        eq(webhookFieldMappings.tenantId, ctx.tenantId),
        eq(webhookFieldMappings.entityType, entityType),
        eq(webhookFieldMappings.sourceKey, sourceKey),
        apiKeyId ? eq(webhookFieldMappings.apiKeyId, apiKeyId) : isNull(webhookFieldMappings.apiKeyId),
        isNull(webhookFieldMappings.deletedAt)
      ),
    });
    if (existing) {
      return NextResponse.json(
        { error: `A mapping for '${sourceKey}' on ${entityType} already exists` },
        { status: 409 }
      );
    }

    const results = await db.insert(webhookFieldMappings)
      .values({
        tenantId: ctx.tenantId,
        apiKeyId: apiKeyId ?? null,
        entityType,
        sourceKey,
        targetType,
        targetKey,
        transform: transform ?? null,
        isActive: isActive !== false,
      })
      .returning();

    return NextResponse.json({
      message: `Mapping '${sourceKey}' -> ${targetType}:${targetKey} created for ${entityType}`,
      mapping: results[0]!,
    }, { status: 201 });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

// ── PATCH: Update a mapping ─────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const limited = await rateLimitMutating(req, 'webhookFieldMappings', 'patch');
    if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const rawBody = await readJsonBody(req);
    const validated = validateBody(updateWebhookFieldMappingSchema, rawBody);
    if (validated instanceof NextResponse) return validated;
    const { id, sourceKey, targetType, targetKey, transform, isActive } = validated.data;

    const current = await db.query.webhookFieldMappings.findFirst({
      where: and(
        eq(webhookFieldMappings.id, id),
        eq(webhookFieldMappings.tenantId, ctx.tenantId),
        isNull(webhookFieldMappings.deletedAt)
      ),
    });
    if (!current) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    const guard = await concurrencyGuardById(db, webhookFieldMappings, id, current.updatedAt);
    if (guard) return guard;

    // Validate the combination the row will end up with, not just the fields
    // that happen to be in this request — switching targetType alone can turn a
    // valid custom-field target into a disallowed native one.
    const nextTargetType = targetType ?? current.targetType;
    const nextTargetKey = targetKey ?? current.targetKey;
    if (targetType !== undefined || targetKey !== undefined) {
      const targetError = await validateTarget(ctx.tenantId, current.entityType, nextTargetType, nextTargetKey);
      if (targetError) return targetError;
    }

    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    if (sourceKey !== undefined) setValues.sourceKey = sourceKey;
    if (targetType !== undefined) setValues.targetType = targetType;
    if (targetKey !== undefined) setValues.targetKey = targetKey;
    if (transform !== undefined) setValues.transform = transform;
    if (isActive !== undefined) setValues.isActive = isActive;

    const results = await db.update(webhookFieldMappings)
      .set(setValues)
      .where(and(
        eq(webhookFieldMappings.id, id),
        eq(webhookFieldMappings.tenantId, ctx.tenantId),
        sql`date_trunc('millisecond', ${webhookFieldMappings.updatedAt}::timestamptz) = date_trunc('millisecond', ${current.updatedAt!}::timestamptz)`,
      ))
      .returning();

    if (results.length === 0) {
      return NextResponse.json({ error: 'Mapping was modified by another user — please refresh' }, { status: 409 });
    }

    return NextResponse.json({ message: 'Mapping updated', mapping: results[0]! });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}

// ── DELETE: Remove a mapping ────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const limited = await rateLimitMutating(req, 'webhookFieldMappings', 'delete');
    if (limited) return limited;
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const results = await db.delete(webhookFieldMappings)
      .where(and(
        eq(webhookFieldMappings.id, id),
        eq(webhookFieldMappings.tenantId, ctx.tenantId)
      ))
      .returning();

    if (results.length === 0) {
      return NextResponse.json({ error: 'Mapping not found' }, { status: 404 });
    }

    return NextResponse.json({
      message: `Mapping '${results[0]!.sourceKey}' deleted`,
      mapping: results[0]!,
    });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
