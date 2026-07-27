# API response envelope: current state and why the obvious fix is wrong

Relates to #655 (HG-23, MG-02, MG-03).

## Summary

The API has three response shapes, and **the SDK is silently broken for most
resources because of it**. The fix is not the one-line unwrap it looks like.

## Shape inventory

Measured across `app/api/tenant/**/route.ts`:

| Shape                    | Count            | Example                              |
| ------------------------ | ---------------- | ------------------------------------ |
| `{ data: entity }`       | 74 routes        | `GET /contacts/:id`                  |
| `{ success: true, ... }` | 8 routes         | `DELETE /leads/:id`                  |
| bare entity              | at least `leads` | `GET /leads/:id`, `PATCH /leads/:id` |

List routes answer `{ data, total, offset, limit }`.

## The live SDK bug

`lib/sdk/client.ts` builds its URL as `${baseUrl}/api/tenant${path}` — the same
routes above — and finishes with:

```ts
return (await response.json()) as T;
```

No unwrapping. But the resource methods declare the bare entity:

```ts
// lib/sdk/resources/contacts.ts
async get(id: string): Promise<Contact> {
  return this.request<Contact>('GET', `/contacts/${id}`);
}
```

`GET /api/tenant/contacts/:id` answers `{ data: {...} }`. So the caller receives
`{ data: contact }` while TypeScript insists it is a `Contact`:

```ts
const contact = await sdk.contacts.get(id);
contact.firstName; // undefined at runtime, no type error
```

That applies to every resource whose route wraps — `contacts`, `deals`, `tasks`,
`companies`, `invoices`, `quotes`, `orders` and the rest.

`leads` is the accident that works: because its route returns the entity flat, the
absence of unwrapping is correct there. **The one inconsistent route is the only
one whose SDK method behaves.**

## Why unwrapping in `_request()` does not work

The tempting fix is to unwrap a `{ data }` envelope centrally. It was implemented,
tested, and reverted, because no structural rule can separate the two cases.

"Unwrap when `data` is the only key" seemed safe, since list routes have
`total`/`offset`/`limit` siblings. But several collection endpoints return only
`{ data: [...] }` with no pagination at all:

```
reports (5 routes), policies, messages, workflows, views, templates, rules,
topScoredResults, tree
```

Unwrapping those yields a bare array where the caller's declared
`PaginatedResponse<T>` expects `.data`, so `result.data` becomes `undefined` —
trading one silent breakage for another.

The existing test `tests/unit/sdk-client.test.ts` pins the current behaviour with a
`{ data: [] }` mock, and it failed under the heuristic. That failure was the useful
signal: the ambiguity is real, not hypothetical.

## The correct fix

Unwrapping has to be **explicit per method**, because only the method knows
whether it asked for one entity or a page.

1. Extend `RequestFn` with an unwrap flag, or add a sibling `requestOne`.
2. Update single-entity methods (`get`, `create`, `update`) across the 18 files in
   `lib/sdk/resources/` to use it. `list` keeps the envelope.
3. Normalise the outliers: `leads` GET/PATCH to `{ data }`, and the 8
   `{ success: true }` responses to one agreed acknowledgement shape.
4. Fix `PaginatedResponse`, which declares `page` and `hasMore` while the routes
   actually return `offset` and `limit` — a second, independent type/route
   mismatch.
5. Version it. Steps 1–3 change the public API contract, so they need either a
   major SDK bump or an `/api/v2` route (`app/api/v2` already exists).

`lib/sdk/envelope.ts` and its 16 tests are kept: `unwrapEnvelope()` is the vetted
primitive step 1 needs. It is simply not wired into `_request()`, and the file says
why.

## Not fixed here, deliberately

Steps 1–5 are a breaking public-API change. Landing half of it — standardising the
route without the SDK, or vice versa — converts a _silent_ bug into a _loud_ one
for whichever side moves first. That is worse than the status quo until both move
together, behind a version boundary.

`safeJson` in `lib/api/validate.ts:102` is also still unused (#655 MG-02): routes
parse bodies with a bare `await request.json()`, so malformed JSON produces a
generic 500 instead of a 400. That is a safe, non-breaking fix and a good companion
to step 3.
