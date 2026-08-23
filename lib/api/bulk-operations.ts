/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Bulk Operations Helper
 *
 * Provides a standardized pattern for bulk API operations (create/update/delete)
 * with partial-failure semantics. Unlike transactions (all-or-nothing), bulk
 * operations process each item independently and report per-item success/failure.
 *
 * Why partial-failure instead of transactions:
 * - A CSV import of 500 contacts shouldn't fail entirely because row 247 has
 *   a validation error
 * - The client needs to know WHICH items succeeded and which failed
 * - Failed items can be retried individually
 *
 * Usage:
 * ```ts
 * import { executeBulk, BulkItem } from '@/lib/api/bulk-operations';
 *
 * export async function POST(req: NextRequest) {
 *   const items: BulkItem[] = body.contacts.map((c, i) => ({
 *     index: i,
 *     data: c,
 *   }));
 *
 *   const result = await executeBulk(items, async (item) => {
 *     const validated = contactSchema.parse(item.data);
 *     const [created] = await db.insert(contacts).values(validated).returning();
 *     return created;
 *   });
 *
 *   return NextResponse.json(result, { status: result.hasErrors ? 207 : 201 });
 * }
 * ```
 */

import { NextResponse } from 'next/server';

export interface BulkItem<T = unknown> {
  /** Index in the original array (for error reporting) */
  index: number;
  /** The data to process */
  data: T;
}

export interface BulkSuccess<R = unknown> {
  index: number;
  status: 'success';
  result: R;
}

export interface BulkError {
  index: number;
  status: 'error';
  error: string;
  code?: string;
}

export type BulkItemResult<R = unknown> = BulkSuccess<R> | BulkError;

export interface BulkResult<R = unknown> {
  /** Total items processed */
  total: number;
  /** Number of successful items */
  succeeded: number;
  /** Number of failed items */
  failed: number;
  /** Whether any errors occurred */
  hasErrors: boolean;
  /** Per-item results (in original order) */
  results: BulkItemResult<R>[];
}

export interface BulkOptions {
  /** Maximum items allowed in a single bulk request (default: 1000) */
  maxItems?: number;
  /** Whether to stop on first error (default: false) */
  stopOnError?: boolean;
  /** Concurrency limit for parallel processing (default: 1, sequential) */
  concurrency?: number;
}

const DEFAULT_MAX_ITEMS = 1000;

/**
 * Validate that a bulk request doesn't exceed limits.
 * Returns a NextResponse error if invalid, null if valid.
 */
export function validateBulkSize(
  items: unknown[],
  maxItems = DEFAULT_MAX_ITEMS,
): NextResponse | null {
  if (!Array.isArray(items)) {
    return NextResponse.json(
      { error: 'Request body must contain an array of items' },
      { status: 400 },
    );
  }
  if (items.length === 0) {
    return NextResponse.json(
      { error: 'At least one item is required' },
      { status: 400 },
    );
  }
  if (items.length > maxItems) {
    return NextResponse.json(
      { error: `Bulk operations limited to ${maxItems} items per request`, maxItems },
      { status: 413 },
    );
  }
  return null;
}

/**
 * Execute a bulk operation with partial-failure semantics.
 *
 * Each item is processed independently. Failures don't affect other items
 * (unless stopOnError is true).
 *
 * @param items - Array of items to process
 * @param handler - Async function that processes a single item
 * @param options - Configuration
 */
export async function executeBulk<T, R>(
  items: BulkItem<T>[],
  handler: (item: BulkItem<T>) => Promise<R>,
  options: BulkOptions = {},
): Promise<BulkResult<R>> {
  const { stopOnError = false, concurrency = 1 } = options;
  const results: BulkItemResult<R>[] = [];
  let succeeded = 0;
  let failed = 0;

  if (concurrency <= 1) {
    // Sequential processing
    for (const item of items) {
      try {
        const result = await handler(item);
        results.push({ index: item.index, status: 'success', result });
        succeeded++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const code = (err as { code?: string })?.code;
        results.push({ index: item.index, status: 'error', error: message, code });
        failed++;

        if (stopOnError) break;
      }
    }
  } else {
    // Parallel processing with concurrency limit
    const queue = [...items];
    const inFlight = new Set<Promise<void>>();

    while (queue.length > 0 || inFlight.size > 0) {
      while (queue.length > 0 && inFlight.size < concurrency) {
        const item = queue.shift()!;
        const promise = (async () => {
          try {
            const result = await handler(item);
            results.push({ index: item.index, status: 'success', result });
            succeeded++;
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            const code = (err as { code?: string })?.code;
            results.push({ index: item.index, status: 'error', error: message, code });
            failed++;
          }
        })();
        inFlight.add(promise);
        promise.then(() => inFlight.delete(promise));
      }

      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }

      if (stopOnError && failed > 0) break;
    }
  }

  // Sort results by original index for deterministic output
  results.sort((a, b) => a.index - b.index);

  return {
    total: items.length,
    succeeded,
    failed,
    hasErrors: failed > 0,
    results,
  };
}
