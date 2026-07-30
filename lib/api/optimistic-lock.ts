import { NextResponse } from 'next/server';

/**
 * Optimistic concurrency guard for PATCH/PUT handlers.
 *
 * Compares the client-supplied `updatedAt` timestamp against the current
 * database value. If they diverge the record was modified by another user
 * between read and write, so we reject with 409 Conflict.
 *
 * When the client does NOT supply an `updatedAt` value the check is skipped
 * for backward compatibility - existing callers that omit the field continue
 * working as before.
 *
 * Usage in a route handler:
 *   const conflict = checkConcurrency(prev.updatedAt, body._version ?? body.updated_at);
 *   if (conflict) return conflict;
 */
export function checkConcurrency(
  currentUpdatedAt: Date,
  clientUpdatedAt: string | undefined
): NextResponse | null {
  if (!clientUpdatedAt) return null; // skip check if not provided (backward compat)

  const clientTime = new Date(clientUpdatedAt).getTime();

  if (Number.isNaN(clientTime)) {
    return NextResponse.json(
      { error: 'Invalid _version / updated_at timestamp.' },
      { status: 400 }
    );
  }

  if (clientTime !== currentUpdatedAt.getTime()) {
    return NextResponse.json(
      { error: 'Conflict: record was modified by another user. Please refresh and try again.' },
      { status: 409 }
    );
  }

  return null;
}
