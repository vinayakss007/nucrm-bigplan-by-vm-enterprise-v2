# ADR-0010: Line coverage is not the quality target

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

"100% test coverage" was set as a goal, and issues #668–#672 break that down into
phases. Meanwhile an audit of this repository found the following defects, none of
which line coverage would have caught:

- Migration `0034` enabled RLS on 164 tables and, because one `DO` block aborted,
  delivered it on **zero**. No line of application code is involved.
- The tenant GUC evaporated before any query ran (ADR-0003). The code executed
  successfully every time.
- The S3 upload block never ran under Docker because of an env var name mismatch
  (`S3_ACCESS_KEY_ID` vs `S3_ACCESS_KEY`), while the status said `completed`.
- `0042` was missing from `meta/_journal.json`, so a column the code writes to
  would never have been created.
- `PATCH /api/tenant/deals/:id` referenced a variable that no longer existed and
  returned 500 on every call. Typecheck caught this; no test did.
- The deals `PATCH` handler spread snake_case keys into a Drizzle `SET` clause, so
  those fields silently never persisted.
- 75 tests asserted `expect(true).toBe(true)` — full coverage, zero verification.

Coverage was high in several of these files while the behaviour was wrong.

## Decision

Coverage thresholds stay as a floor, not a target. Current settings in
`vitest.config.ts` (`lines 70`, `functions 70`, `branches 80`, `statements 70`)
are the floor and should not be lowered.

Test effort goes to invariants rather than lines:

- **Schema invariants** — `tests/unit/schema/*` introspect the Drizzle schema via
  `getTableConfig` and assert `tenant_id` presence/type/nullability, FK presence
  and `ON DELETE` semantics. No database needed.
- **Structural invariants** — `tests/unit/route-boundaries.test.ts` walks the
  route tree and asserts loading/error coverage _by ancestry_, and fails any page
  using `useSearchParams` without Suspense.
- **Behaviour against a real engine** — the RLS and rollback behaviours were
  verified against PostgreSQL 16, because that is where the bugs lived.
- **Fail-closed assertions** — tests must prove the safe path is taken on failure,
  not merely that the failure branch executed.

A new test must be able to fail for a reason someone cares about. If flipping the
implementation to something wrong still passes it, it is not a test.

## Consequences

- Reported coverage will not reach 100%, and that is intentional. Chasing the last
  30% pulls effort towards trivially-testable code and away from the integration
  seams where these defects actually were.
- Issues #668–#672 remain useful as a way to find _untested behaviour_, but
  hitting their percentage targets is not itself evidence of quality.
- Invariant tests are more expensive to write and need real domain understanding.

## Alternatives considered

- **Mandate 100% line coverage.** Rejected: every defect above is a
  counter-example, and it creates pressure to write assertions that execute code
  without checking it — which is how the 75 `expect(true).toBe(true)` assertions
  came to exist.
- **Drop thresholds entirely.** Rejected: the floor stops coverage silently
  eroding, and CI needs an objective gate.
