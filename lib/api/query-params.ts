/**
 * Standardized Query Parameter Parser
 *
 * Parses common REST API query parameters for list endpoints:
 * - sort: `?sort=createdAt:desc,name:asc`
 * - filter: `?filter[status]=active&filter[assignedTo]=user-1`
 * - fields: `?fields=id,name,email` (sparse fieldsets)
 * - search: `?q=searchterm`
 * - pagination: `?page=2&limit=50` (offset-based)
 *
 * Field names (sort/filter/fields) are reduced to [A-Za-z0-9_], so they are safe to
 * interpolate as identifiers. Filter *values* are returned raw and are attacker
 * controlled -- always bind them as query parameters, never interpolate them.
 *
 * Note the whitelists are fail-open: if allowedSorts/allowedFilters/allowedFields is
 * omitted or empty, ANY column name is accepted. List endpoints should pass explicit
 * whitelists so that e.g. `?fields=password_hash` cannot reach the query builder.
 *
 * This provides a uniform interface that any list endpoint can use,
 * ensuring consistent API behavior across all resources.
 *
 * Usage:
 * ```ts
 * import { parseQueryParams } from '@/lib/api/query-params';
 *
 * export async function GET(req: NextRequest) {
 *   const params = parseQueryParams(req, {
 *     allowedSorts: ['createdAt', 'name', 'updatedAt'],
 *     allowedFilters: ['status', 'assignedTo', 'type'],
 *     defaultSort: [{ field: 'createdAt', direction: 'desc' }],
 *     maxLimit: 100,
 *   });
 *   // params.sort, params.filters, params.fields, params.search, params.pagination
 * }
 * ```
 */

import { NextRequest } from 'next/server';

export interface SortField {
  field: string;
  direction: 'asc' | 'desc';
}

export interface QueryFilter {
  field: string;
  value: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'like';
}

export interface Pagination {
  offset: number;
  limit: number;
  page: number;
}

export interface ParsedQueryParams {
  /** Parsed sort directives */
  sort: SortField[];
  /** Parsed filters */
  filters: QueryFilter[];
  /** Selected fields (empty = all fields) */
  fields: string[];
  /** Free-text search query */
  search: string | null;
  /** Pagination parameters */
  pagination: Pagination;
}

export interface QueryParamsConfig {
  /** Allowed sort field names (whitelist). If empty, all fields allowed. */
  allowedSorts?: string[];
  /** Allowed filter field names (whitelist). If empty, all fields allowed. */
  allowedFilters?: string[];
  /** Allowed field names for sparse fieldsets. If empty, all allowed. */
  allowedFields?: string[];
  /** Default sort if none specified */
  defaultSort?: SortField[];
  /** Default page size (default: 50) */
  defaultLimit?: number;
  /** Maximum page size (default: 200) */
  maxLimit?: number;
  /** Maximum number of sort fields (default: 3) */
  maxSorts?: number;
  /** Maximum number of filters (default: 10) */
  maxFilters?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_SORTS = 3;
const MAX_RAW_SORT_PARTS = 25;
const MAX_FILTERS = 10;

/**
 * Parse sort string: "createdAt:desc,name:asc" → SortField[]
 */
function parseSort(raw: string | null, config: QueryParamsConfig): SortField[] {
  if (!raw || !raw.trim()) {
    return config.defaultSort || [];
  }

  const maxSorts = config.maxSorts ?? MAX_SORTS;
  // Cap the raw split so a pathological ?sort= cannot make us do unbounded work,
  // but spend the maxSorts budget on *valid* fields only. Slicing to maxSorts up
  // front let a few unknown names crowd out a legitimate sort, which then fell
  // through to defaultSort with no indication the request had been ignored.
  const parts = raw.split(',').slice(0, MAX_RAW_SORT_PARTS);
  const results: SortField[] = [];

  for (const part of parts) {
    if (results.length >= maxSorts) break;
    const [field, dir] = part.trim().split(':');
    if (!field) continue;

    const cleanField = field.replace(/[^a-zA-Z0-9_]/g, '');
    if (!cleanField) continue;

    // Whitelist check
    if (config.allowedSorts?.length && !config.allowedSorts.includes(cleanField)) {
      continue;
    }

    const direction: 'asc' | 'desc' = dir === 'desc' ? 'desc' : 'asc';
    results.push({ field: cleanField, direction });
  }

  return results.length > 0 ? results : (config.defaultSort || []);
}

/**
 * Parse filter parameters: filter[status]=active → QueryFilter[]
 */
function parseFilters(searchParams: URLSearchParams, config: QueryParamsConfig): QueryFilter[] {
  const maxFilters = config.maxFilters ?? MAX_FILTERS;
  const results: QueryFilter[] = [];

  for (const [key, value] of searchParams.entries()) {
    if (results.length >= maxFilters) break;

    // Match filter[field] or filter[field][operator]
    const match = key.match(/^filter\[([a-zA-Z0-9_]+)\](?:\[([a-z]+)\])?$/);
    if (!match) continue;

    const field = match[1]!;
    const operatorRaw = match[2] || 'eq';

    // Whitelist check
    if (config.allowedFilters?.length && !config.allowedFilters.includes(field)) {
      continue;
    }

    const validOperators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'like'] as const;
    const operator = validOperators.includes(operatorRaw as typeof validOperators[number])
      ? (operatorRaw as QueryFilter['operator'])
      : 'eq';

    results.push({ field, value, operator });
  }

  return results;
}

/**
 * Parse fields parameter: "id,name,email" → string[]
 */
function parseFields(raw: string | null, config: QueryParamsConfig): string[] {
  if (!raw || !raw.trim()) return [];

  const parts = raw.split(',').map((f) => f.trim().replace(/[^a-zA-Z0-9_]/g, '')).filter(Boolean);

  if (config.allowedFields?.length) {
    return parts.filter((f) => config.allowedFields!.includes(f));
  }

  return parts;
}

/**
 * Parse all query parameters from a request.
 */
export function parseQueryParams(req: NextRequest, config: QueryParamsConfig = {}): ParsedQueryParams {
  const { searchParams } = new URL(req.url);
  const defaultLimit = config.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = config.maxLimit ?? MAX_LIMIT;

  // Sort
  const sort = parseSort(searchParams.get('sort'), config);

  // Filters
  const filters = parseFilters(searchParams, config);

  // Fields
  const fields = parseFields(searchParams.get('fields'), config);

  // Search
  const search = searchParams.get('q') || searchParams.get('search') || null;

  // Pagination
  const pageParam = parseInt(searchParams.get('page') || '1', 10);
  const limitParam = parseInt(searchParams.get('limit') || String(defaultLimit), 10);

  const page = Math.max(1, isNaN(pageParam) ? 1 : pageParam);
  const limit = Math.min(Math.max(1, isNaN(limitParam) ? defaultLimit : limitParam), maxLimit);
  const offset = (page - 1) * limit;

  return {
    sort,
    filters,
    fields,
    search,
    pagination: { offset, limit, page },
  };
}
