/**
 * Cursor-based Pagination
 *
 * Replaces offset-based pagination for large datasets. Cursor pagination
 * is O(1) regardless of page depth (no OFFSET scanning), making it ideal
 * for CRM data (contacts, activities, audit logs) that can grow to millions.
 *
 * How it works:
 * - Client sends `?cursor=...&limit=50`
 * - Server decodes the cursor → (sortValue, id) tuple
 * - Queries WHERE (sort_col, id) > (cursorValue, cursorId) ORDER BY sort_col, id LIMIT N+1
 * - Returns N items + a `nextCursor` if there's a (N+1)th item
 *
 * Cursor format: Base64-encoded JSON `{ v: sortValue, id: lastId }`
 * (opaque to the client — they just pass it back)
 *
 * Usage:
 * ```ts
 * import { parseCursor, encodeCursor, paginatedResponse } from '@/lib/api/cursor-pagination';
 *
 * export async function GET(req: NextRequest) {
 *   const { cursor, limit } = parseCursor(req);
 *   // ... fetch limit+1 rows using cursor values ...
 *   return paginatedResponse(rows, limit, (row) => ({
 *     v: row.createdAt.toISOString(),
 *     id: row.id,
 *   }));
 * }
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';

export interface CursorData {
  /** Sort column value (ISO date, number, or string) */
  v: string | number;
  /** Record ID (for tie-breaking when sort values are equal) */
  id: string;
}

export interface ParsedCursor {
  /** Decoded cursor data, or null if no cursor provided (first page) */
  cursor: CursorData | null;
  /** Number of items to return (clamped between 1 and maxLimit) */
  limit: number;
}

export interface PaginationMeta {
  /** Cursor for the next page (null if this is the last page) */
  nextCursor: string | null;
  /** Whether there are more results */
  hasMore: boolean;
  /** Number of items returned in this page */
  count: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Encode cursor data to an opaque string.
 */
export function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

/**
 * Decode an opaque cursor string back to cursor data.
 * Returns null if the cursor is invalid (client tampered with it).
 *
 * Note on cursor stability: If many records share the same sort value and
 * records are inserted between pages, items may be skipped because
 * tie-breaking uses the record ID (UUID) which is not sequential. This is
 * an inherent trade-off of cursor-based pagination with non-sequential IDs.
 */
export function decodeCursor(cursor: string): CursorData | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!('v' in parsed) || !('id' in parsed)) return null;
    if (typeof parsed['id'] !== 'string') return null;
    // Reject empty string IDs as invalid cursors
    if (parsed['id'] === '') return null;
    const v = parsed['v'];
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    return { v: v as string | number, id: parsed['id'] as string };
  } catch {
    return null;
  }
}

/**
 * Parse cursor and limit from request query parameters.
 *
 * @param req - NextRequest
 * @param maxLimit - Maximum allowed limit (default: 200)
 */
export function parseCursor(req: NextRequest, maxLimit = MAX_LIMIT): ParsedCursor {
  const { searchParams } = new URL(req.url);
  const cursorParam = searchParams.get('cursor');
  const limitParam = searchParams.get('limit');

  const limit = Math.min(
    Math.max(parseInt(limitParam || '', 10) || DEFAULT_LIMIT, 1),
    maxLimit,
  );

  const cursor = cursorParam ? decodeCursor(cursorParam) : null;

  return { cursor, limit };
}

/**
 * Build a paginated response from a fetched result set.
 *
 * IMPORTANT: Fetch `limit + 1` rows from the database. This function uses
 * the extra row to determine if there's a next page, then removes it from
 * the response.
 *
 * @param rows - Array of fetched rows (should be limit+1 if there's a next page)
 * @param limit - The page size requested
 * @param getCursorData - Function to extract cursor data from the last row
 * @param extraFields - Additional fields to include in the response
 */
export function paginatedResponse<T>(
  rows: T[],
  limit: number,
  getCursorData: (row: T) => CursorData,
  extraFields: Record<string, unknown> = {},
): NextResponse {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const lastItem = items[items.length - 1]!;
    nextCursor = encodeCursor(getCursorData(lastItem));
  }

  const meta: PaginationMeta = {
    nextCursor,
    hasMore,
    count: items.length,
  };

  return NextResponse.json({
    data: items,
    pagination: meta,
    ...extraFields,
  });
}
