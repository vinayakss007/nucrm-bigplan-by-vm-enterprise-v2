import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { validateBody } from '@/lib/api/validate';
import { createCustomFieldSchema, updateCustomFieldSchema } from '@/lib/api/schemas';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { customFieldDefs, contacts, companies, deals, leads } from '@/drizzle/schema';
import { users, tenants, featureRegistry } from '@/drizzle/schema';
import { tasks } from '@/drizzle/schema';
import { eq, and, asc, desc, sql } from 'drizzle-orm';

const VALID_ENTITY_TYPES = ['contact', 'company', 'deal', 'lead', 'task', 'user', 'tenant'] as const;
type EntityType = typeof VALID_ENTITY_TYPES[number];

const tableMap: Record<EntityType, any> = {
  contact: contacts,
  company: companies,
  deal: deals,
  lead: leads,
  task: tasks,
  user: users,
  tenant: tenants,
};

function isEntityType(value: string): value is EntityType {
  return VALID_ENTITY_TYPES.includes(value as EntityType);
}

function getTable(entityType: string) {
  if (!isEntityType(entityType)) return null;
  return tableMap[entityType];
}

function sanitizeFieldKey(key: string): string {
  return key.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
}

/**
 * Dynamic Custom Fields API
 */

// ── GET: List custom fields for an entity type ──────────────────────────────

export async function GET(req: NextRequest) {
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

      const table = getTable(entityType);
      if (!table) {
        return NextResponse.json({ error: `Unknown entity type: ${entityType}` }, { status: 400 });
      }

      // We need to use raw SQL here because table is dynamic
      const results = await db.execute(
        sql`SELECT id, metadata FROM ${table} WHERE id = ${entityId} AND tenant_id = ${ctx.tenantId}`
      );
      const result: any = results.rows[0];

      if (!result) {
        return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
      }

      // Get field definitions to provide labels/types
      const fieldDefinitions = await db.query.customFieldDefs.findMany({
        limit: 200,
        where: and(
          eq(customFieldDefs.tenantId, ctx.tenantId),
          eq(customFieldDefs.entityType, entityType)
        ),
        orderBy: [asc(customFieldDefs.displayOrder)]
      });

      const fieldMap: Record<string, any> = {};
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
        entityTypes: Object.keys(tableMap),
        hint: 'Add ?entityType=contact to list custom fields',
      });
    }

    const fields = await db.query.customFieldDefs.findMany({
        limit: 200,
      where: and(
        eq(customFieldDefs.tenantId, ctx.tenantId),
        eq(customFieldDefs.entityType, entityType)
      ),
      orderBy: [asc(customFieldDefs.displayOrder)]
    });

    return NextResponse.json({ entityType, fields });
  } catch (err: any) {
    return apiError(err);
  }
}

// ── POST: Create custom field or set value or register feature ──────────────

export async function POST(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  // Register a feature (auto-schema evolution)
  if (action === 'register-feature') {
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
    }

    const body = await req.json();
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
    const body = await req.json();
    const { entityType, entityId, fieldKey, value } = body;

    if (!entityType || !entityId || !fieldKey) {
      return NextResponse.json({ error: 'entityType, entityId, and fieldKey are required' }, { status: 400 });
    }

    const table = getTable(entityType);
    if (!table) {
      return NextResponse.json({ error: `Unknown entity type: ${entityType}` }, { status: 400 });
    }

    const safeFieldKey = sanitizeFieldKey(fieldKey);
    if (!safeFieldKey) {
      return NextResponse.json({ error: 'Invalid fieldKey' }, { status: 400 });
    }

    // Verify ownership
    const entityResult = await db.execute(
      sql`SELECT id FROM ${table} WHERE id = ${entityId} AND tenant_id = ${ctx.tenantId}`
    );
    if (entityResult.rows.length === 0) {
      return NextResponse.json({ error: 'Entity not found or not owned' }, { status: 404 });
    }

    // Update metadata JSONB column (fieldKey is sanitized to alphanumeric + underscore)
    await db.execute(
      sql`UPDATE ${table} 
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         ARRAY[${safeFieldKey}],
         to_jsonb(${value}),
         true
       )
       WHERE id = ${entityId}`
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
    const body = await req.json();
    const { entityType, entityId, fields } = body;

    if (!entityType || !entityId || !fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'entityType, entityId, and fields object are required' }, { status: 400 });
    }

    const table = getTable(entityType);
    if (!table) {
      return NextResponse.json({ error: `Unknown entity type: ${entityType}` }, { status: 400 });
    }

    const entityResult = await db.execute(
      sql`SELECT metadata FROM ${table} WHERE id = ${entityId} AND tenant_id = ${ctx.tenantId}`
    );
    const entity: any = entityResult.rows[0];
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
      sql`UPDATE ${table} SET metadata = ${mergedMetadata} WHERE id = ${entityId}`
    );

    return NextResponse.json({
      message: `${Object.keys(sanitizedFields).length} custom fields set on ${entityType}`,
      entityType,
      entityId,
      fields: sanitizedFields,
    });
  }

  // Create a custom field definition
  const rawBody = await req.json();
  const validated = validateBody(createCustomFieldSchema, rawBody);
  if (validated instanceof NextResponse) return validated;
  const v = validated.data;
  const { entityType, fieldKey, fieldLabel, fieldType, fieldOptions, isRequired, isSearchable, defaultValue, displayOrder, isCalculated, formula } = v;

  if (!entityType || !fieldKey || !fieldLabel) {
    return NextResponse.json({ error: 'entityType, fieldKey, and fieldLabel are required' }, { status: 400 });
  }

  const existing = await db.query.customFieldDefs.findFirst({
    where: and(
      eq(customFieldDefs.tenantId, ctx.tenantId),
      eq(customFieldDefs.entityType, entityType),
      eq(customFieldDefs.fieldKey, fieldKey)
    )
  });

  if (existing) {
    return NextResponse.json({ error: `Field '${fieldKey}' already exists for ${entityType}` }, { status: 409 });
  }

  const VALID_TYPES = ['text','number','date','boolean','select','multiselect','url','email','phone','textarea','json','formula'] as const;
  const safeType = VALID_TYPES.includes(fieldType as any) ? fieldType : 'text';

  const results = await db.insert(customFieldDefs)
    .values({
      tenantId: ctx.tenantId,
      entityType,
      fieldKey: fieldKey.replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
      fieldLabel,
      fieldType: safeType as string,
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
    message: `Custom field '${fieldKey}' created for ${entityType}`,
    field: results[0]!,
  }, { status: 201 });
}

// ── PUT: Update custom field definition ─────────────────────────────────────

export async function PUT(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const rawBody = await req.json();
  const validated = validateBody(updateCustomFieldSchema, rawBody);
  if (validated instanceof NextResponse) return validated;
  const v = validated.data;
  const { fieldId, fieldLabel, fieldType, fieldOptions, isRequired, isSearchable, displayOrder, isCalculated, formula } = v;

  if (!fieldId) {
    return NextResponse.json({ error: 'fieldId is required' }, { status: 400 });
  }

  const setValues: any = {
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
      eq(customFieldDefs.tenantId, ctx.tenantId)
    ))
    .returning();

  if (results.length === 0) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }

  return NextResponse.json({ message: 'Field updated', field: results[0]! });
}

// ── DELETE: Remove custom field definition ──────────────────────────────────

export async function DELETE(req: NextRequest) {
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
    results = await db.delete(customFieldDefs)
      .where(and(
        eq(customFieldDefs.id, fieldId),
        eq(customFieldDefs.tenantId, ctx.tenantId)
      ))
      .returning();
  } else {
    results = await db.delete(customFieldDefs)
      .where(and(
        eq(customFieldDefs.tenantId, ctx.tenantId!),
        eq(customFieldDefs.entityType, entityType!),
        eq(customFieldDefs.fieldKey, fieldKey!)
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
}
