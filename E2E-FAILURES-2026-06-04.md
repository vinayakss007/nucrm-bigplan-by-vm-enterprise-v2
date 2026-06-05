# E2E Test Failures — 2026-06-04

**5 tests fail** out of 24. All failures are **missing seed data** (not code bugs).

## Failure 1: contacts.spec.ts — "view contacts list"
- **File:** `tests/e2e/contacts.spec.ts:17`
- **Root Cause:** `npm run seed:e2e` creates the user but does NOT seed contact records. The test navigates to `/tenant/contacts` which renders empty state; it then asserts a contact count that never comes.
- **Fix:** Add contact seeding to `scripts/seed-e2e-user.ts`, or skip this test when no contacts exist.

## Failure 2: deals.spec.ts — "view deals pipeline"
- **File:** `tests/e2e/deals.spec.ts:17`
- **Root Cause:** No pipeline or deal records exist for the test tenant. The deals page loads but has no stages/deals to render.
- **Fix:** Seed a default pipeline + stages + sample deals for the E2E test tenant.

## Failure 3: deals.spec.ts — "create new deal"
- **File:** `tests/e2e/deals.spec.ts:22`
- **Root Cause:** The "New Deal" form requires a pipeline/stage to exist. Since none are seeded, the form submission fails or the page errors.
- **Fix:** Seed a default pipeline before running deal-related tests.

## Failure 4: deals.spec.ts — "deal pipeline stages are visible"
- **File:** `tests/e2e/deals.spec.ts:40`
- **Root Cause:** Same as #2 — no pipeline stages seeded.
- **Fix:** Seed default stages (Lead, Qualified, Proposal, Negotiation, Won, Lost) for the E2E test tenant.

## Failure 5: notifications.spec.ts — "landing/login/signup pages are accessible"  
- **File:** `tests/e2e/notifications.spec.ts:36`
- **Error:** Page navigation timeout (page did not load within 10s)
- **Root Cause:** Likely a slow page load or redirect loop on `/` for authenticated users. The test expects public pages to load quickly but the app may redirect to `/tenant/` for already-authenticated sessions.
- **Fix:** Either clear auth state before navigating public pages, or increase the navigation timeout.

---

## All 5 failures are DATA/SETUP issues, not code defects.
Once `scripts/seed-e2e-user.ts` is extended to also seed:
- 1 default pipeline with 6 stages
- 5-10 sample contacts
- 3-5 sample deals

...all 24 E2E tests should pass.
