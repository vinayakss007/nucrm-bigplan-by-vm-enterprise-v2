/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * NuCRM SDK — pagination, error, and the internal request-function shape.
 */

// ─── Pagination ─────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface ListOptions {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, unknown>;
}

// ─── Error ──────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  code?: string;
  status: number;
  details?: Record<string, unknown>;
}

// ─── Internal Request Function Type ─────────────────────────────────────────

export type RequestFn = <T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>
) => Promise<T>;
