/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Dynamic segment evaluation engine (#1633).
 *
 * Compiles a segment's stored `config` filters into a SAFE, tenant-scoped SQL
 * query and returns the matching entity ids. Safety model (mirrors the #1412
 * injection-safe approach in app/api/tenant/reports/builder/route.ts):
 *   - entityType and every filter field are validated against a static
 *     per-entity ALLOWLIST before use; unknown fields/entities are rejected.
 *   - column identifiers only ever reach SQL via `sql.identifier(...)`.
 *   - all filter VALUES are bound as parameters via `${...}` interpolation,
 *     never string-concatenated.
 *   - queries are always constrained to the caller's tenant and exclude
 *     soft-deleted rows.
 *
 * The stored filter shape (defined here — the codebase had none before):
 *   { match?: 'all' | 'any', rules: Array<{ field, operator, value? }> }
 */
import { db } from '@/drizzle/db';
import { sql, type SQL } from 'drizzle-orm';

export type SegmentEntityType = 'contact' | 'company' | 'lead' | 'deal';

export type SegmentOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'starts_with'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'is_true'
  | 'is_false'
  | 'is_set'
  | 'is_empty'
  | 'has_tag';

export interface SegmentRule {
  field: string;
  operator: SegmentOperator;
  value?: unknown;
}

export interface SegmentConfig {
  match?: 'all' | 'any';
  rules?: SegmentRule[];
}

/** Physical table name per entity type (static allowlist — never user input). */
const ENTITY_TABLE: Record<SegmentEntityType, string> = {
  contact: 'contacts',
  company: 'companies',
  lead: 'leads',
  deal: 'deals',
};

/**
 * Kinds drive which operators are valid for a field and how the value is bound.
 *   text   — string comparisons (eq/neq/contains/starts_with/is_set/is_empty)
 *   number — numeric comparisons (eq/neq/gt/gte/lt/lte/in)
 *   bool   — is_true / is_false
 *   date   — date comparisons (gt/gte/lt/lte on a timestamp)
 *   tags   — text[] membership (has_tag / is_set / is_empty)
 *   enum   — text equality set (eq/neq/in)
 */
type FieldKind = 'text' | 'number' | 'bool' | 'date' | 'tags' | 'enum';

/**
 * Per-entity field allowlist mapping the PUBLIC filter field name to the real
 * DB COLUMN name + its kind. Only fields listed here are queryable; anything
 * else is rejected. Column names are the physical snake_case columns.
 */
const FIELD_ALLOWLIST: Record<SegmentEntityType, Record<string, { column: string; kind: FieldKind }>> = {
  contact: {
    email: { column: 'email', kind: 'text' },
    first_name: { column: 'first_name', kind: 'text' },
    last_name: { column: 'last_name', kind: 'text' },
    job_title: { column: 'job_title', kind: 'text' },
    city: { column: 'city', kind: 'text' },
    state: { column: 'state', kind: 'text' },
    country: { column: 'country', kind: 'text' },
    lead_source: { column: 'lead_source', kind: 'enum' },
    lead_status: { column: 'lead_status', kind: 'enum' },
    lifecycle_stage: { column: 'lifecycle_stage', kind: 'enum' },
    score: { column: 'score', kind: 'number' },
    company_id: { column: 'company_id', kind: 'text' },
    assigned_to: { column: 'assigned_to', kind: 'text' },
    is_customer: { column: 'is_customer', kind: 'bool' },
    do_not_contact: { column: 'do_not_contact', kind: 'bool' },
    unsubscribed: { column: 'unsubscribed', kind: 'bool' },
    tags: { column: 'tags', kind: 'tags' },
    created_at: { column: 'created_at', kind: 'date' },
    last_activity_at: { column: 'last_activity_at', kind: 'date' },
  },
  company: {
    name: { column: 'name', kind: 'text' },
    domain: { column: 'domain', kind: 'text' },
    industry: { column: 'industry', kind: 'enum' },
    company_size: { column: 'company_size', kind: 'enum' },
    city: { column: 'city', kind: 'text' },
    country: { column: 'country', kind: 'text' },
    status: { column: 'status', kind: 'enum' },
    lifecycle_stage: { column: 'lifecycle_stage', kind: 'enum' },
    assigned_to: { column: 'assigned_to', kind: 'text' },
    is_customer: { column: 'is_customer', kind: 'bool' },
    tags: { column: 'tags', kind: 'tags' },
    created_at: { column: 'created_at', kind: 'date' },
  },
  lead: {
    email: { column: 'email', kind: 'text' },
    first_name: { column: 'first_name', kind: 'text' },
    last_name: { column: 'last_name', kind: 'text' },
    company_name: { column: 'company_name', kind: 'text' },
    lead_source: { column: 'lead_source', kind: 'enum' },
    lead_status: { column: 'lead_status', kind: 'enum' },
    lifecycle_stage: { column: 'lifecycle_stage', kind: 'enum' },
    score: { column: 'score', kind: 'number' },
    value: { column: 'value', kind: 'number' },
    assigned_to: { column: 'assigned_to', kind: 'text' },
    company_id: { column: 'company_id', kind: 'text' },
    tags: { column: 'tags', kind: 'tags' },
    created_at: { column: 'created_at', kind: 'date' },
  },
  deal: {
    title: { column: 'title', kind: 'text' },
    amount: { column: 'amount', kind: 'number' },
    stage_id: { column: 'stage_id', kind: 'text' },
    pipeline_id: { column: 'pipeline_id', kind: 'text' },
    assigned_to: { column: 'assigned_to', kind: 'text' },
    contact_id: { column: 'contact_id', kind: 'text' },
    company_id: { column: 'company_id', kind: 'text' },
    close_date: { column: 'close_date', kind: 'date' },
    created_at: { column: 'created_at', kind: 'date' },
  },
};

/** Operators permitted for each field kind. */
const KIND_OPERATORS: Record<FieldKind, Set<SegmentOperator>> = {
  text: new Set(['eq', 'neq', 'contains', 'starts_with', 'in', 'is_set', 'is_empty']),
  enum: new Set(['eq', 'neq', 'in', 'is_set', 'is_empty']),
  number: new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is_set', 'is_empty']),
  bool: new Set(['is_true', 'is_false']),
  date: new Set(['gt', 'gte', 'lt', 'lte', 'is_set', 'is_empty']),
  tags: new Set(['has_tag', 'is_set', 'is_empty']),
};

export class SegmentFilterError extends Error {}

export function isSegmentEntityType(v: unknown): v is SegmentEntityType {
  return v === 'contact' || v === 'company' || v === 'lead' || v === 'deal';
}

/**
 * Build the SQL condition for a single validated rule. `tableName` is a static
 * allowlisted value; `column` came from the allowlist; `value` is always bound
 * as a parameter.
 */
function buildRuleCondition(
  tableName: string,
  meta: { column: string; kind: FieldKind },
  rule: SegmentRule,
): SQL {
  const col = sql`${sql.identifier(tableName)}.${sql.identifier(meta.column)}`;
  const op = rule.operator;

  if (!KIND_OPERATORS[meta.kind].has(op)) {
    throw new SegmentFilterError(`Operator "${op}" not allowed for field "${rule.field}"`);
  }

  // Presence checks need no value.
  if (op === 'is_set') return sql`${col} IS NOT NULL`;
  if (op === 'is_empty') return sql`${col} IS NULL`;
  if (op === 'is_true') return sql`${col} = true`;
  if (op === 'is_false') return sql`(${col} = false OR ${col} IS NULL)`;

  if (meta.kind === 'tags') {
    // text[] membership; value is a single tag bound as a parameter.
    const tag = String(rule.value ?? '');
    if (!tag) throw new SegmentFilterError(`Tag value required for field "${rule.field}"`);
    return sql`${col} @> ARRAY[${tag}]::text[]`;
  }

  if (op === 'in') {
    const arr = Array.isArray(rule.value) ? rule.value : [rule.value];
    const vals = arr.filter((v) => v !== undefined && v !== null).map((v) => String(v));
    if (vals.length === 0) throw new SegmentFilterError(`"in" requires a non-empty list for "${rule.field}"`);
    return sql`${col} IN (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`;
  }

  if (op === 'contains') {
    return sql`${col} ILIKE ${'%' + String(rule.value ?? '') + '%'}`;
  }
  if (op === 'starts_with') {
    return sql`${col} ILIKE ${String(rule.value ?? '') + '%'}`;
  }

  // Comparison operators. Bind numbers/dates as their native parameter types.
  let bound: unknown = rule.value;
  if (meta.kind === 'number') {
    const n = Number(rule.value);
    if (Number.isNaN(n)) throw new SegmentFilterError(`Numeric value required for field "${rule.field}"`);
    bound = n;
  } else if (meta.kind === 'date') {
    const d = new Date(String(rule.value));
    if (Number.isNaN(d.getTime())) throw new SegmentFilterError(`Date value required for field "${rule.field}"`);
    bound = d;
  }

  switch (op) {
    case 'eq':
      return sql`${col} = ${bound}`;
    case 'neq':
      return sql`(${col} IS DISTINCT FROM ${bound})`;
    case 'gt':
      return sql`${col} > ${bound}`;
    case 'gte':
      return sql`${col} >= ${bound}`;
    case 'lt':
      return sql`${col} < ${bound}`;
    case 'lte':
      return sql`${col} <= ${bound}`;
    default:
      throw new SegmentFilterError(`Unsupported operator "${op}"`);
  }
}

/**
 * Validate a raw config object into a typed SegmentConfig, rejecting anything
 * whose field/operator isn't in the allowlist for the given entity type.
 * Exposed so the API layer can validate on write as well as on evaluation.
 */
export function validateSegmentConfig(
  entityType: SegmentEntityType,
  rawConfig: unknown,
): SegmentConfig {
  const cfg = (rawConfig ?? {}) as Record<string, unknown>;
  const match = cfg.match === 'any' ? 'any' : 'all';
  const rawRules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const allow = FIELD_ALLOWLIST[entityType];

  const rules: SegmentRule[] = rawRules.map((r, i) => {
    const rule = (r ?? {}) as Record<string, unknown>;
    const field = String(rule.field ?? '');
    const operator = String(rule.operator ?? '') as SegmentOperator;
    const meta = allow[field];
    if (!meta) {
      throw new SegmentFilterError(`Unknown field "${field}" for ${entityType} (rule ${i + 1})`);
    }
    if (!KIND_OPERATORS[meta.kind].has(operator)) {
      throw new SegmentFilterError(`Operator "${operator}" not allowed for "${field}" (rule ${i + 1})`);
    }
    return { field, operator, value: rule.value };
  });

  return { match, rules };
}

/**
 * Evaluate a segment's filters and return the matching entity ids (tenant-scoped,
 * soft-delete excluded). An empty rule set matches ALL live rows of the entity.
 */
export async function evaluateSegment(params: {
  tenantId: string;
  entityType: SegmentEntityType;
  config: unknown;
  /** Cap the result set to protect against pathological segments. */
  limit?: number;
}): Promise<string[]> {
  const { tenantId, entityType } = params;
  if (!isSegmentEntityType(entityType)) {
    throw new SegmentFilterError(`Unsupported entity type "${entityType}"`);
  }
  const tableName = ENTITY_TABLE[entityType];
  const allow = FIELD_ALLOWLIST[entityType];
  const parsed = validateSegmentConfig(entityType, params.config);
  const limit = Math.min(Math.max(1, params.limit ?? 50_000), 100_000);

  // Base conditions: tenant scope + soft-delete exclusion (always applied).
  const conditions: SQL[] = [
    sql`${sql.identifier(tableName)}.tenant_id = ${tenantId}`,
    sql`${sql.identifier(tableName)}.deleted_at IS NULL`,
  ];

  const ruleConds = parsed.rules!.map((rule) =>
    buildRuleCondition(tableName, allow[rule.field]!, rule),
  );

  let whereClause: SQL;
  if (ruleConds.length === 0) {
    whereClause = sql`${sql.join(conditions, sql` AND `)}`;
  } else {
    const joiner = parsed.match === 'any' ? sql` OR ` : sql` AND `;
    const ruleGroup = sql`(${sql.join(ruleConds, joiner)})`;
    whereClause = sql`${sql.join([...conditions, ruleGroup], sql` AND `)}`;
  }

  const query = sql`
    SELECT id FROM ${sql.identifier(tableName)}
    WHERE ${whereClause}
    LIMIT ${limit}
  `;

  const result = await db.execute(query);
  return (result.rows as Array<{ id: string }>).map((r) => r.id);
}
