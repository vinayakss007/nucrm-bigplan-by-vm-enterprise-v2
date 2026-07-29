import { NextResponse } from 'next/server';

/**
 * Optimistic concurrency check.
 *
 * Compares the client-provided version timestamp against the record's current
 * `updatedAt`. If they differ, another user has modified the record since the
 * client last read it, so the write is rejected with 409 rather than silently
 * overwriting their change.
 *
 * Usage in PATCH handlers:
 * ```ts
 * const conflict = checkConcurrency(record.updatedAt, clientVersion(rawBody));
 * if (conflict) return conflict;
 * ```
 *
 * The check is opt-in: a client that sends no version is not protected, which
 * keeps existing callers working. A client that *does* send one is protected,
 * including when the value is unusable — see below.
 */
export function checkConcurrency(
  currentUpdatedAt: Date | null | undefined,
  clientUpdatedAt: string | null | undefined
): NextResponse | null {
  // No version supplied: caller has opted out. Backward compatible.
  if (!clientUpdatedAt) return null;

  // The row has no updatedAt to compare against, so there is nothing to
  // conflict with. Guarded because a non-null assertion here would throw a
  // TypeError on .getTime() and surface as a 500.
  if (!currentUpdatedAt) return null;

  const clientTime = new Date(clientUpdatedAt).getTime();

  if (Number.isNaN(clientTime)) {
    // Deliberately a 400 and not a silent skip. Skipping would mean a client
    // that sends a malformed version gets no concurrency protection at all
    // while believing it is protected — the guard would fail open on exactly
    // the input it cannot verify. Better to reject the request outright.
    return NextResponse.json(
      {
        error: 'Invalid version timestamp. Send the value of updated_at as returned by the API.',
        code: 'INVALID_VERSION',
        client_version: clientUpdatedAt,
      },
      { status: 400 }
    );
  }

  if (clientTime !== currentUpdatedAt.getTime()) {
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

/**
 * Pull the client's version token out of a request body.
 *
 * `_updated_at` is canonical. `_version` and `updated_at` are accepted because
 * both spellings were introduced in parallel (#843 used `_version` / `updated_at`,
 * #847 used `_updated_at`); accepting all three means neither client shape
 * silently loses its concurrency protection by sending the "wrong" key — which
 * would be indistinguishable from opting out.
 */
export function clientVersion(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const b = body as Record<string, unknown>;
  for (const key of ['_updated_at', '_version', 'updated_at'] as const) {
    const value = b[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}
