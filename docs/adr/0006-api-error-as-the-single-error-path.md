# ADR-0006: `apiError()` is the single API error path

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Issue #643 reported three or four overlapping error systems — `lib/errors.ts`
(`AppError` + `handleError()`), `lib/errors-client.ts`, `lib/errors-shared.ts`
and `lib/api-error.ts` (`apiError()`) — and proposed standardising on
`AppError` + `handleError()`.

Measured against the actual routes:

```
routes using apiError()      319
routes using handleError()     0
total route files            430
```

`handleError()` has no callers. The convention the codebase actually converged on
is `apiError()`. The issue proposed migrating 319 working call sites onto an
abstraction nothing uses.

The one flagged "leaks `err.message`" site
(`app/api/tenant/ai/summarize/route.ts`) turned out to be a false positive: it
returns a `GatewayError`, whose messages are deliberately authored user-facing
strings such as `No AI provider is enabled. Configure one at
/tenant/settings/ai-providers.` That is an intended API contract, not an
internals leak.

## Decision

`apiError()` is the single error path for API routes. New routes use it.

`apiError()` never exposes an internal message in production, reports 5xx to
Sentry, and — since this change — maps `InvalidJsonBodyError` to a 400 without
paging anyone.

The other modules keep narrow, non-overlapping roles: `errors-shared.ts` holds
the `ErrorCode` enum and `ApiError` type used on both sides;
`errors-client.ts` holds `logError` for client components; `errors.ts` holds
`logError` for server code. `handleError()` and the `AppError` hierarchy are
**not** the route convention and should not be introduced into routes.

Returning a hand-built `NextResponse.json({ error: '<generic message>' }, { status: 500 })`
is acceptable in the 111 route files that do it — the messages are already
generic — but `apiError()` is preferred because it also reports.

## Consequences

- Error responses stay `{ error: string }`. There is still no machine-readable
  error code on most responses; `ErrorCode` exists but is not threaded through
  `apiError()`. That is the remaining half of #643 and is worth doing when a
  client actually needs to branch on error type.
- `handleError()` and `AppError` are dead weight. Left in place rather than
  deleted because removing exports is a separate, riskier change.

## Alternatives considered

- **Migrate all 319 routes to `AppError` + `handleError()`**, as #643 proposed.
  Rejected: a 319-route change to adopt an abstraction with zero current users,
  with no behavioural improvement over `apiError()`.
- **Delete `lib/api-error.ts` and keep `errors.ts`.** Rejected for the same
  reason, in reverse: `apiError()` is the one with the users.
- **Introduce a discriminated `Result` return type instead of throwing.**
  Rejected: every route already has a try/catch ending in `apiError()`, and
  changing the control flow of 430 handlers buys type-safety the tests already
  provide.
