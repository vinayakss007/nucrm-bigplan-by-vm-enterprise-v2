import { NextResponse } from 'next/server';

/**
 * Optimistic concurrency check.
 *
 * Compares the client-provided `updated_at` timestamp against the record's
 * current `updatedAt`. If they don't match, another user has modified the
 * record since the client last read it.
 *
 * Usage in PATCH handlers:
 * ```ts
 * const conflict = checkConcurrency(record.updatedAt, body._updated_at);
 * if (conflict) return conflict;
 * ```
 *
 * The check is opt-in: if the client doesn't send `_updated_at`, no conflict
 * is raised (backward-compatible).
 */
export function checkConcurrency(
  currentUpdatedAt: Date | null | undefined,
  clientUpdatedAt: string | null | undefined
): NextResponse | null {
  // Skip check if client doesn't provide the field (backward compat)
  if (!clientUpdatedAt) return null;
  if (!currentUpdatedAt) return null;

  const clientTime = new Date(clientUpdatedAt).getTime();
  const serverTime = new Date(currentUpdatedAt).getTime();

  if (isNaN(clientTime)) return null; // invalid date string — skip

  if (clientTime !== serverTime) {
    return NextResponse.json(
      {
        error: 'Conflict: this record was modified by another user. Please refresh and try again.',
        code: 'CONFLICT',
        server_updated_at: currentUpdatedAt.toISOString(),
        client_updated_at: clientUpdatedAt,
      },
      { status: 409 }
    );
  }

  return null;
}
