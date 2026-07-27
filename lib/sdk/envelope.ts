/**
 * Response envelope handling for the SDK.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Single-entity routes answer with the entity wrapped in an envelope:
 *
 *     GET /api/tenant/contacts/:id  ->  { "data": { ...contact } }
 *
 * The SDK returned `await response.json() as T` with no unwrapping, while typing
 * the result as the bare entity. So `sdk.contacts.get(id).firstName` was
 * `undefined` — the caller actually held `{ data: contact }`. That applied to
 * every resource whose route wraps, which is 74 of them.
 *
 * `leads` was the exception: it returned the entity flat, so `sdk.leads.get()`
 * happened to work. Fixing the inconsistency in the route without fixing the SDK
 * would have broken the one resource that worked, so both change together.
 *
 * WHY THE RULE IS SHAPED THIS WAY
 * List routes answer `{ data, total, offset, limit }`, and callers need the whole
 * thing for pagination. Single-entity routes answer `{ data }` and nothing else.
 * So: unwrap only when `data` is the *sole* key. That distinction is structural
 * rather than a guess, and it leaves paginated responses untouched.
 *
 * An entity that legitimately has its own `data` field would still be safe,
 * because the envelope check looks at the top-level object, not the entity.
 */

/**
 * Return `body.data` when `body` is a single-key `{ data }` envelope, otherwise
 * return `body` unchanged.
 */
export function unwrapEnvelope<T>(body: unknown): T {
  if (isSingleDataEnvelope(body)) {
    return body.data as T;
  }
  return body as T;
}

/**
 * True only for a plain object whose one and only own enumerable key is `data`.
 *
 * Arrays are excluded: a bare array response is already the payload. `null` is
 * excluded because `typeof null === 'object'`.
 */
function isSingleDataEnvelope(body: unknown): body is { data: unknown } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return false;
  }
  const keys = Object.keys(body);
  return keys.length === 1 && keys[0] === 'data';
}
