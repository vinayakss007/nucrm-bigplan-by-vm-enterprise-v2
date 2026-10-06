/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { createCustomFieldSchema, updateCustomFieldSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customFieldDefs, contacts, companies, deals, leads } from '@/drizzle/schema';
import { featureRegistry } from '@/drizzle/schema';
import { tasks } from '@/drizzle/schema';
import { eq, and, asc, desc, sql, isNull } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import { concurrencyGuard } from '@/lib/api/concurrency';

import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { withApiRoute } from '@/lib/api/with-api-route';

/**
 * Everything a tenant may DEFINE a custom field for. A definition is a row in
 * custom_field_defs keyed by entity_type alone, so the subject table is never
 * touched here — which is why `user` and `tenant` are allowed at all.
 */
const VALID_ENTITY_TYPES = ['contact', 'company', 'deal', 'lead', 'task', 'user', 'tenant'] as const;

/**
 * #2385: the metadata value endpoints build `WHERE id = … AND tenant_id = …`
 * against the subject table, so the subject must actually carry both columns.
 * `users` and `tenants` are legitimate custom-field DEFINITION subjects
 * (custom_field_defs is keyed by entity_type alone) but have no tenant_id, and
 * those three endpoints failed on them with Postgres 42703 (column does not
 * exist) → a 500 for a documented entity type.
 */
const VALUE_ENTITY_TYPES = ['contact', 'company', 'deal', 'lead', 'task'] as const;
type ValueEntityType = typeof VALUE_ENTITY_TYPES[number];
const valueTableMap: Record<ValueEntityType, AnyPgTable> = {
  contact: contacts,
  company: companies,
  deal: deals,
  lead: leads,
  task: tasks,
};

function getValueTable(entityType: string): AnyPgTable | null {
  // Allowlist membership, not a bare map lookup: `tableMap['constructor']`
  // resolves off Object.prototype and would then be interpolated as a table.
  if (!(VALUE_ENTITY_TYPES as readonly string[]).includes(entityType)) return null;
  return valueTableMap[entityType as ValueEntityType];
}

function sanitizeFieldKey(key: string): string {
  return key.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
}

/**
 * Dynamic Custom Fields API
 */

// ── GET: List custom fields for an entity type ──────────────────────────────

export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entityType');
    const action = searchParams.get('action');

    // List registered features
    if (action === 'features') {
      const features = await db.query.featureRegistry.findMany({
        limit: 200,
        where: eq(featureRegistry.enabled, true),
        orderBy: [desc(featureRegistry.createdAt)]
      });
      return NextResponse.json({ features });
    }

    // Get all custom field values for a specific entity
    if (action === 'values') {
      const entityId = searchParams.get('entityId');
      if (!entityId || !entityType) {
        return NextResponse.json({ error: 'entityType and entityId required' }, { status: 400 });
      }

      const table = getValueTable(entityType);
      if (!table) {
        return NextResponse.json({ error: `Custom field values are not supported for entity type: ${entityType}` }, { status: 400 });
      }

      // Raw SQL because the table is dynamic; getValueTable() is what makes
      // ${table} safe. deleted_at IS NULL: a deleted record has no readable
      // custom-field values (#2385).
      const results = await db.execute(
        sql`SELECT id, metadata FROM ${table} WHERE id = ${entityId} AND tenant_id = ${ctx.tenantId} AND deleted_at IS NULL`
      );      const result = results.rows[0] as { id: string; metadata: Record<string, unknown> | null } | undefined;

      if (!result) {
        return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
      }

      // Get field definitions to provide labels/types
      const fieldDefinitions = await db.query.customFieldDefs.findMany({
        limit: 200,
        where: and(
          eq(customFieldDefs.tenantId, ctx.tenantId),
          eq(customFieldDefs.entityType, entityType),
          isNull(customFieldDefs.deletedAt)
        ),
        orderBy: [asc(customFieldDefs.displayOrder)]
      });      const fieldMap: Record<string, { label: string; type: string; options?: unknown; value: unknown }> = {};
      for (const def of fieldDefinitions) {
        fieldMap[def.fieldKey] = {
          label: def.fieldLabel,
          type: def.fieldType,
          options: def.fieldOptions,
          value: (result.metadata || {})[def.fieldKey] ?? null,
        };
      }

      // Also include any metadata keys that don't have field definitions
      const metadata = result.metadata || {};
      for (const [key, value] of Object.entries(metadata)) {
        if (!fieldMap[key]) {
          fieldMap[key] = {
            label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            type: typeof value,
            value,
          };
        }
      }

      return NextResponse.json({ entityId, entityType, fields: fieldMap });
    }

    // List custom field definitions
    if (!entityType) {
      // Return all entity types available
      return NextResponse.json({
        entityTypes: [...VALID_ENTITY_TYPES],
        hint: 'Add ?entityType=contact to list custom fields',
      });
    }

    const fields = await db.query.customFieldDefs.findMany({
        limit: 200,
      where: and(
        eq(customFieldDefs.tenantId, ctx.tenantId),
        eq(customFieldDefs.entityType, entityType),
        // #2385: DELETE tombstones the definition, so a deleted field would
        // otherwise keep showing up in the settings list forever.
        isNull(customFieldDefs.deletedAt)
      ),
      orderBy: [asc(customFieldDefs.displayOrder)]
    });

    return NextResponse.json({ entityType, fields });
 
 
  } catch (err) {
    return apiError(err);
  }
});

// ── POST: Create custom field or set value or register feature ──────────────

export const POST = withApiRoute(async (req: NextRequest) => {
  const limited = await rateLimitMutating(req, 'customFields', 'post');
  if (limited) return limited;
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  // Register a feature (auto-schema evolution)
  if (action === 'register-feature') {
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
    }

    const body = await readJsonBody(req);
    const { featureName, description, version, metadataKeys, entities, requiresTables } = body;

    if (!featureName) {
      return NextResponse.json({ error: 'featureName is required' }, { status: 400 });
    }

    await db.execute(
      sql`SELECT public.register_feature(${featureName}, ${description || null}, ${version || '1.0.0'}, 
          ${metadataKeys ? JSON.stringify(metadataKeys) : '[]'}, 
          ${entities ? JSON.stringify(entities) : '[]'}, 
          ${requiresTables ? JSON.stringify(requiresTables) : '[]'})`
    );

    return NextResponse.json({
      message: `Feature '${featureName}' registered`,
      feature: { featureName, description, version, metadataKeys, entities, requiresTables },
    });
  }

  // Set a custom field value on an entity
  if (action === 'set-value') {
    const body = await readJsonBody(req);
    const { entityType, entityId, fieldKey, value } = body;

    if (!entityType || !entityId || !fieldKey) {
      return NextResponse.json({ error: 'entityType, entityId, and fieldKey are required' }, { status: 400 });
    }

    const table = getValueTable(entityType);
    if (!table) {
      return NextResponse.json({ error: `Custom field values are not supported for entity type: ${entityType}` }, { status: 400 });
    }

    const safeFieldKey = typeof fieldKey === 'string' ? sanitizeFieldKey(fieldKey) : '';
    if (!safeFieldKey) {
      return NextResponse.json({ error: 'Invalid fieldKey' }, { status: 400 });
    }

    // Verify ownership — and that the record is alive: a soft-deleted record is
    // inert, not merely hidden (#2385).
    const entityResult = await db.execute(
      sql`SELECT id FROM ${table} WHERE id = ${entityId} AND tenant_id = ${ctx.tenantId} AND deleted_at IS NULL`
    );
    if (entityResult.rows.length === 0) {
      return NextResponse.json({ error: 'Entity not found or not owned' }, { status: 404 });
    }

    // Update metadata JSONB column (fieldKey is sanitized to alphanumeric + underscore).
    // The predicate repeats tenant + lifecycle scoping so the write is not
    // guarded only by the read above it (#2385).
    await db.execute(
      sql`UPDATE ${table} 
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         ARRAY[${safeFieldKey}],
         to_jsonb(${value}),
         true
       )
       WHERE id = ${entityId} AND tenant_id = ${ctx.tenantId} AND deleted_at IS NULL`
    );

    return NextResponse.json({
      message: `Custom field '${safeFieldKey}' set on ${entityType}`,
      entityType,
      entityId,
      fieldKey: safeFieldKey,
      value,
    });
  }

  // Bulk set multiple custom fields at once
  if (action === 'set-bulk') {
    const body = await readJsonBody(req);
    const { entityType, entityId, fields } = body;

    if (!entityType || !entityId || !fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'entityType, entityId, and fields object are required' }, { status: 400 });
    }

    const table = getValueTable(entityType);
    if (!table) {
      return NextResponse.json({ error: `Custom field values are not supported for entity type: ${entityType}` }, { status: 400 });
    }

    const entityResult = await db.execute(
      sql`SELECT metadata FROM ${table} WHERE id = ${entityId} AND tenant_id = ${ctx.tenantId} AND deleted_at IS NULL`
    );    const entity = entityResult.rows[0] as { id: string; metadata: Record<string, unknown> | null } | undefined;
    if (!entity) {
      return NextResponse.json({ error: 'Entity not found or not owned' }, { status: 404 });
    }

    // Sanitize all field keys to prevent SQL injection via key names
    const sanitizedFields: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(fields)) {
      const safeKey = sanitizeFieldKey(key);
      if (safeKey) sanitizedFields[safeKey] = val;
    }

    const mergedMetadata = {
      ...(entity.metadata || {}),
      ...sanitizedFields,
    };

    await db.execute(
      sql`UPDATE ${table} SET metadata = ${mergedMetadata} WHERE id = ${entityId} AND tenant_id = ${ctx.tenantId} AND deleted_at IS NULL`
    );

    return NextResponse.json({
      message: `${Object.keys(sanitizedFields).length} custom fields set on ${entityType}`,
      entityType,
      entityId,
      fields: sanitizedFields,
    });
  }

  // Create a custom field definition
  const rawBody = await readJsonBody(req);
  const validated = validateBody(createCustomFieldSchema, rawBody);
  if (validated instanceof NextResponse) return validated;
  const v = validated.data;
  const { entityType, fieldKey, fieldLabel, fieldType, fieldOptions, isRequired, isSearchable, defaultValue, displayOrder, isCalculated, formula } = v;

  if (!entityType || !fieldKey || !fieldLabel) {
    return NextResponse.json({ error: 'entityType, fieldKey, and fieldLabel are required' }, { status: 400 });
  }

  // The key is stored lowercased and underscore-normalised, so the collision
  // check has to run against that same value. Comparing the raw request key
  // instead let `FOO` slip past a stored `foo` and hit the unique index as a
  // raw 23505 → 500 (#2386).
  const storedFieldKey = sanitizeFieldKey(fieldKey);

  // Deliberately NOT filtered on deleted_at: idx_custom_fields_unique_key
  // (drizzle/schema/crm.ts:388) covers tombstones, so a deleted field really
  // does still reserve its key. Now that the list hides tombstones (#2385),
  // "already exists" would describe a field the tenant cannot see — name the
  // blocker instead.
  const existing = await db.query.customFieldDefs.findFirst({
    where: and(
      eq(customFieldDefs.tenantId, ctx.tenantId),
      eq(customFieldDefs.entityType, entityType),
      eq(customFieldDefs.fieldKey, storedFieldKey)
    )
  });

  if (existing) {
    return NextResponse.json({
      error: existing.deletedAt
        ? `Field '${storedFieldKey}' for ${entityType} was deleted, but its key is still reserved. Choose a different key — values already stored under '${storedFieldKey}' remain on the records.`
        : `Field '${storedFieldKey}' already exists for ${entityType}`,
    }, { status: 409 });
  }

  const results = await db.insert(customFieldDefs)
    .values({
      tenantId: ctx.tenantId,
      entityType,
      fieldKey: storedFieldKey,
      fieldLabel,
      // createCustomFieldSchema already restricts this to `customFieldTypes`;
      // a second local whitelist here had drifted (it lacked 'currency' and
      // silently downgraded the UI's Currency field to 'text') (#2386).
      fieldType,
      fieldOptions: fieldOptions || null,
      isRequired: isRequired || false,
      isSearchable: isSearchable !== false,
      defaultValue: defaultValue as string || null,
      displayOrder: displayOrder || 0,
      isCalculated: isCalculated || false,
      formula: formula || null,
    })
    .returning();

  return NextResponse.json({
    message: `Custom field '${storedFieldKey}' created for ${entityType}`,
    field: results[0]!,
  }, { status: 201 });
});

// ── PUT: Update custom field definition ─────────────────────────────────────

export const PUT = withApiRoute(async (req: NextRequest) => {
  const limited = await rateLimitMutating(req, 'customFields', 'patch');
  if (limited) return limited;
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const rawBody = await readJsonBody(req);
  const validated = validateBody(updateCustomFieldSchema, rawBody);
  if (validated instanceof NextResponse) return validated;
  const v = validated.data;
  const { fieldId, fieldLabel, fieldType, fieldOptions, isRequired, isSearchable, displayOrder, isCalculated, formula } = v;

  if (!fieldId) {
    return NextResponse.json({ error: 'fieldId is required' }, { status: 400 });
  }

 
 
 
  const expectedUpdatedAt = (validated.data as Record<string, unknown>).expectedUpdatedAt ? new Date((validated.data as Record<string, unknown>).expectedUpdatedAt as string) : null;
  const guard = await concurrencyGuard(db, customFieldDefs, fieldId, ctx.tenantId, expectedUpdatedAt);
  if (guard) return guard;

  const setValues: Record<string, unknown> = {
    updatedAt: new Date()
  };

  if (fieldLabel !== undefined) setValues.fieldLabel = fieldLabel;
  if (fieldType !== undefined) {
    setValues.fieldType = fieldType;
  }
  if (fieldOptions !== undefined) setValues.fieldOptions = fieldOptions;
  if (isRequired !== undefined) setValues.isRequired = isRequired;
  if (isSearchable !== undefined) setValues.isSearchable = isSearchable;
  if (displayOrder !== undefined) setValues.displayOrder = displayOrder;
  if (isCalculated !== undefined) setValues.isCalculated = isCalculated;
  if (formula !== undefined) setValues.formula = formula;

  const results = await db.update(customFieldDefs)
    .set(setValues)
    .where(and(
      eq(customFieldDefs.id, fieldId),
      eq(customFieldDefs.tenantId, ctx.tenantId),
      // A tombstone is not editable. concurrencyGuard only checks this when the
      // client sends the optional expectedUpdatedAt, so the predicate has to
      // carry it (#2385).
      isNull(customFieldDefs.deletedAt)
    ))
    .returning();

  if (results.length === 0) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }

  return NextResponse.json({ message: 'Field updated', field: results[0]! });
});

// ── DELETE: Remove custom field definition ──────────────────────────────────

export const DELETE = withApiRoute(async (req: NextRequest) => {
  const limited = await rateLimitMutating(req, 'customFields', 'delete');
  if (limited) return limited;
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = new URL(req.url);
  const fieldId = searchParams.get('fieldId');
  const fieldKey = searchParams.get('fieldKey');
  const entityType = searchParams.get('entityType');

  if (!fieldId && (!fieldKey || !entityType)) {
    return NextResponse.json({ error: 'fieldId OR (fieldKey + entityType) required' }, { status: 400 });
  }

  let results;
  if (fieldId) {
    results = await db.update(customFieldDefs)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(customFieldDefs.id, fieldId),
        eq(customFieldDefs.tenantId, ctx.tenantId),
        isNull(customFieldDefs.deletedAt)
      ))
      .returning();
  } else {
    results = await db.update(customFieldDefs)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(customFieldDefs.tenantId, ctx.tenantId!),
        eq(customFieldDefs.entityType, entityType!),
        eq(customFieldDefs.fieldKey, fieldKey!),
        isNull(customFieldDefs.deletedAt)
      ))
      .returning();
  }

  if (results.length === 0) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }

  return NextResponse.json({ 
    message: `Field '${results[0]!.fieldKey}' deleted (data preserved in metadata)`, 
    field: results[0]! 
  });
});
