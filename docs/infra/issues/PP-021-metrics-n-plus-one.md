# N+1 query on the dashboard metrics endpoint (PP-021)

**Severity:** LOW — performance, not a fault
**Area:** API · Performance
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-021](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)
**Sentry:** `NUCRM-1` — `GET /api/metrics` (12 events, most recent 2026-09-14T23:43Z)

## Summary

`GET /api/metrics` issues one query per metric instead of aggregating them. Sentry reports it as a
performance signal (no exception attached). It is harmless at pre-prod scale, but it is a scaling risk:
the metric count grows with the dashboard, so the request cost grows linearly per page load.

## Steps to reproduce

1. Log in and open the dashboard (or `curl` `GET /api/metrics` with a session cookie).
2. With Postgres statement logging enabled, count the queries in the request window and note that the
   `GROUP BY`/`COUNT` statements differ only by the metric they select.
3. Cross-check in Sentry: `NUCRM-1` reports the transaction duration growing with tenant data volume.

## Expected vs actual

- **Expected:** one (or a constant number of) aggregate query serving all metrics.
- **Actual:** N queries for N metrics.

## Why

Each metric is fetched by its own `SELECT … COUNT(*) … GROUP BY created_at` call, so there is no shared
scan.

## File / route

- `app/api/metrics/route.ts` (and the query helpers it calls)

## Proposed fix

Batch the counters into a single query (`COUNT(*) FILTER (WHERE …)` per metric, or a `UNION ALL` over the
metric list) and/or cache the response for a short TTL, since dashboards tolerate slightly stale numbers.
Confirm by re-measuring the request: the query count must drop, and `NUCRM-1` must stop reporting the
endpoint.
