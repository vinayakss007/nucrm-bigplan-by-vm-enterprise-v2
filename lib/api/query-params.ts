/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Standardized Query Parameter Parser
 *
 * Parses common REST API query parameters for list endpoints:
 * - sort: `?sort=createdAt:desc,name:asc`
 * - filter: `?filter[status]=active&filter[assignedTo]=user-1`
 * - fields: `?fields=id,name,email` (sparse fieldsets)
 * - search: `?q=searchterm`
 * - pagination: `?page=2&limit=50` (offset) or `?cursor=...&limit=50` (cursor)
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
const MAX_FILTERS = 10;

/**
 * Parse sort string: "createdAt:desc,name:asc" → SortField[]
 */
function parseSort(raw: string | null, config: QueryParamsConfig): SortField[] {
  if (!raw || !raw.trim()) {
    return config.defaultSort || [];
  }

  const maxSorts = config.maxSorts ?? MAX_SORTS;
  const parts = raw.split(',').slice(0, maxSorts);
  const results: SortField[] = [];

  for (const part of parts) {
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
 * Minimal, safe page/limit/offset parser for list endpoints that only need
 * offset pagination (not the full sort/filter/fields interface).
 *
 * Guarantees:
 * - `limit` is clamped to [1, maxLimit] (default cap 200) — prevents
 *   `?limit=999999` table dumps / DoS.
 * - `page` is clamped to >= 1 — prevents `?page=0`/`?page=-5` producing a
 *   negative OFFSET (Postgres 500) or a divide-by-zero in `totalPages`.
 * - NaN/`"0"`/empty inputs fall back to sane defaults.
 *
 * Accepts either a URLSearchParams or a NextRequest.
 */
export function parsePageLimit(
  input: URLSearchParams | NextRequest,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): { page: number; limit: number; offset: number } {
  const searchParams =
    input instanceof URLSearchParams ? input : new URL(input.url).searchParams;
  const defaultLimit = opts.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = opts.maxLimit ?? MAX_LIMIT;

  const pageRaw = parseInt(searchParams.get('page') ?? '1', 10);
  const limitRaw = parseInt(searchParams.get('limit') ?? String(defaultLimit), 10);

  const page = Math.max(1, Number.isNaN(pageRaw) ? 1 : pageRaw);
  const limit = Math.min(Math.max(1, Number.isNaN(limitRaw) ? defaultLimit : limitRaw), maxLimit);
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Minimal, safe limit/offset parser for list endpoints that page with an
 * explicit `offset` cursor instead of a `page` number (e.g. timeline,
 * whatsapp messages, entity history).
 *
 * Guarantees:
 * - `limit` is clamped to [1, maxLimit] (default cap 200) — prevents
 *   `?limit=999999` table dumps / DoS.
 * - `offset` is clamped to >= 0 — prevents `?offset=-5` producing an invalid
 *   negative OFFSET (Postgres 500).
 * - NaN/`"0"` limit / empty inputs fall back to sane defaults.
 *
 * Accepts either a URLSearchParams or a NextRequest.
 */
export function parseLimitOffset(
  input: URLSearchParams | NextRequest,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): { limit: number; offset: number } {
  const searchParams =
    input instanceof URLSearchParams ? input : new URL(input.url).searchParams;
  const defaultLimit = opts.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = opts.maxLimit ?? MAX_LIMIT;

  const limitRaw = parseInt(searchParams.get('limit') ?? String(defaultLimit), 10);
  const offsetRaw = parseInt(searchParams.get('offset') ?? '0', 10);

  const limit = Math.min(Math.max(1, Number.isNaN(limitRaw) ? defaultLimit : limitRaw), maxLimit);
  const offset = Math.max(0, Number.isNaN(offsetRaw) ? 0 : offsetRaw);

  return { limit, offset };
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
