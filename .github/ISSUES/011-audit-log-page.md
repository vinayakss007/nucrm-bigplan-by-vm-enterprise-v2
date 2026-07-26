# Tenant-Level Audit Log Page + API Not Accessible (Issue #432)

We discovered that while the database schema and unit tests exist for tenant-level audit logging, the actual UI page and the respective API route to serve this data to the end user are either incomplete or missing entirely.

## Issue Details
- The underlying tracking for `auditLogs` is defined in the Drizzle schema (`drizzle/schema/core.ts` or similar).
- The `Tenant Audit Log API` is covered by `tests/unit/tenant-audit-api.test.ts`.
- However, there is no UI component or exposed page (e.g., `app/tenant/settings/audit/page.tsx`) that effectively presents this information to tenant administrators.
- Without a visible audit log, tenant admins lack compliance visibility and cannot self-audit user actions.

## Recommendation
Implement a data table UI at `/tenant/settings/audit` that fetches and securely displays the tenant's audit logs via the existing API endpoints. Ensure it supports filtering (by user, action, date) and pagination.
