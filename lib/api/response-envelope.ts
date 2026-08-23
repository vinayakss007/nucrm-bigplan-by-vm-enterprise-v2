/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Standardized API Response Envelope
 *
 * Provides a consistent response structure for all new endpoints.
 * Existing endpoints are not refactored (too risky), but all new
 * endpoints should use these helpers for contract stability.
 *
 * Response shapes:
 *   Success:    { data: T }
 *   Paginated:  { data: T[], meta: { page, limit, total, totalPages } }
 *   Error:      { error: { code, message, details? } }
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApiEnvelope<T> {
  data: T;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedEnvelope<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ErrorEnvelope {
  error: ApiErrorDetail;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Wrap a single resource or result in the standard envelope.
 */
export function envelope<T>(data: T): ApiEnvelope<T> {
  return { data };
}

/**
 * Wrap a paginated list in the standard envelope with pagination metadata.
 */
export function paginatedEnvelope<T>(
  data: T[],
  meta: { page: number; limit: number; total: number }
): PaginatedEnvelope<T> {
  return {
    data,
    meta: {
      page: meta.page,
      limit: meta.limit,
      total: meta.total,
      totalPages: Math.ceil(meta.total / Math.max(meta.limit, 1)),
    },
  };
}

/**
 * Create a structured error envelope. Use with NextResponse.json(errorEnvelope(...), { status }).
 */
export function errorEnvelope(
  code: string,
  message: string,
  details?: unknown
): ErrorEnvelope {
  const err: ApiErrorDetail = { code, message };
  if (details !== undefined) {
    err.details = details;
  }
  return { error: err };
}
