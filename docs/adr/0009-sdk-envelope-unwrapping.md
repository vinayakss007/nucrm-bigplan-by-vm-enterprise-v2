# ADR-0009: Unwrap API envelopes per SDK method, not centrally

- **Status:** Proposed
- **Date:** 2026-07-27

## Context

`lib/sdk/client.ts` requests the same routes the app uses and ends with:

```ts
return (await response.json()) as T;
```

No unwrapping. But the resource methods declare the bare entity:

```ts
async get(id: string): Promise<Contact> {
  return this.request<Contact>('GET', `/contacts/${id}`);
}
```

`GET /api/tenant/contacts/:id` answers `{ data: {...} }`, so:

```ts
const contact = await sdk.contacts.get(id);
contact.firstName; // undefined at runtime. No type error.
```

That affects **74 routes**. `leads` is the only resource that works, precisely
_because_ it is the non-conforming flat route flagged in #655 HG-23 — the one
inconsistency in the API is what makes its SDK method behave.

The obvious central fix — unwrap when `data` is the response's only key — was
implemented and passed 16 tests. Then the existing `tests/unit/sdk-client.test.ts`
failed against a `{ data: [] }` mock, which gave the real answer:

```
Collection endpoints returning only { data: [...] }, no pagination:
reports (×5), policies, messages, workflows, views, templates, rules,
topScoredResults, tree
```

Unwrapping those hands back a bare array where the caller's declared
`PaginatedResponse<T>` expects `.data`, so `result.data` becomes `undefined`. It
trades one silent breakage for another. **No structural heuristic can separate a
single-entity `{ data }` from a collection `{ data }`.**

## Decision (proposed)

Unwrap explicitly in each resource method, because only the method knows whether
it asked for one entity or a page. Across the 18 files in `lib/sdk/resources/`,
behind a version boundary — `app/api/v2` already exists.

`lib/sdk/envelope.ts` + its 16 tests are kept as the vetted primitive this needs.
It is deliberately **not** wired into `_request()`.

`tests/unit/sdk-client.test.ts` is left pinning current behaviour. Its failure was
the useful signal; rewriting it to match the heuristic would have destroyed the
evidence that the heuristic was wrong.

## Consequences

- The bug stays live until this is done. Documented in
  `docs/api-envelope-state.md` with the full shape inventory (74 `{data}`,
  8 `{success}`, some bare).
- The `leads` route standardisation (#655 HG-23) is **coupled** to this and must
  not land first: fixing `leads` alone breaks the one SDK method that currently
  works.
- Two further mismatches recorded while investigating: `PaginatedResponse`
  declares `page`/`hasMore` while routes return `offset`/`limit`.

## Alternatives considered

- **Central heuristic unwrap.** Implemented, tested, then reverted for the reason
  above.
- **Standardise every route to a single envelope shape.** The cleanest end state,
  but it is a breaking API change for existing consumers and needs the version
  boundary and a client sweep regardless.
- **Ship the `leads` fix now and the SDK fix later.** Rejected: half of this
  change is worse than none.
