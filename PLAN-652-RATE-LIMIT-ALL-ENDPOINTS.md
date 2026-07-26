# Rate Limiting on PATCH/DELETE Endpoints — Issue #652

## Summary

Add rate limiting to all PATCH/DELETE API route handlers that currently lack `checkRateLimit()`. Use a new `rateLimitMutating()` helper that wraps `checkRateLimit` with per-entity default configs.

## Context

- **Audit result:** 82 PATCH/DELETE routes across the tenant API surface have no rate limiting
- **Why it matters:** Without rate limits, an authenticated user can spam PATCH/DELETE requests to manipulate or delete data at unlimited speed
- **Key insight:** Read endpoints (GET) are lower risk since they don't modify state; the critical gap is mutating operations

## Plan

### Phase 1: Create shared rate-limit helper (1 file)

Create `lib/api/mutating-rate-limit.ts`:

```typescript
import { checkRateLimit } from "@/lib/rate-limit";

const MUTATING_LIMITS = {
  contacts: { patch: 60, delete: 15 },
  deals: { patch: 60, delete: 15 },
  // ... per-entity configs
};

export async function rateLimitMutating(
  request: Request,
  entity: string,
  method: "patch" | "delete",
) {
  const limits = MUTATING_LIMITS[entity] || { patch: 30, delete: 10 };
  return checkRateLimit(request, {
    action: `${entity}_${method}`,
    max: limits[method],
    windowMinutes: 1,
  });
}
```

### Phase 2: Bulk-apply to all 82 routes (Python script)

For each file in the audit list, insert **import + rate limit call** at the top of the PATCH and DELETE handlers:

```typescript
// Add import at top of file
import { rateLimitMutating } from "@/lib/api/mutating-rate-limit";

// Add at top of PATCH/DELETE handler (after try { if present)
const limited = await rateLimitMutating(request, "ENTITY_NAME", "METHOD");
if (limited) return limited;
```

### Phase 3: Fix issues from bulk-apply

Potential issues the Python script may introduce:

- **Parameter name mismatch:** If the handler uses `req` instead of `request`, the script inserts `rateLimitMutating(request, ...)` which won't compile
- **Import placement:** If the script inserts import inside a multi-line import block
- **SSO DELETE:** The DELETE function declaration was stripped — restore it

Fix approach: Run `npx tsc --noEmit` to catch type errors, fix each one.

## Scope — All 82 Files

### Core CRM (7)

- `app/api/tenant/contacts/[id]/route.ts`
- `app/api/tenant/deals/[id]/route.ts`
- `app/api/tenant/companies/[id]/route.ts`
- `app/api/tenant/leads/[id]/route.ts`
- `app/api/tenant/leads/assign/route.ts`
- `app/api/tenant/tickets/[id]/route.ts`
- `app/api/tenant/tasks/[id]/route.ts`

### Communication (4)

- `app/api/tenant/meetings/[id]/route.ts`
- `app/api/tenant/calls/[id]/route.ts`
- `app/api/tenant/follow-ups/[id]/route.ts`
- `app/api/tenant/contacts/[id]/notes/route.ts`

### Documents (8)

- `app/api/tenant/documents/[id]/route.ts`
- `app/api/tenant/documents/route.ts`
- `app/api/tenant/quotes/[id]/route.ts`
- `app/api/tenant/invoices/[id]/route.ts`
- `app/api/tenant/contracts/[id]/route.ts`
- `app/api/tenant/orders/[id]/route.ts`
- `app/api/tenant/files/route.ts`
- `app/api/tenant/products/[id]/route.ts`

### Config & Admin (10)

- `app/api/tenant/roles/[id]/route.ts`
- `app/api/tenant/forms/[id]/route.ts`
- `app/api/tenant/sequences/[id]/route.ts`
- `app/api/tenant/email-templates/[id]/route.ts`
- `app/api/tenant/webhooks/[id]/route.ts`
- `app/api/tenant/views/[id]/route.ts`
- `app/api/tenant/tax/route.ts`
- `app/api/tenant/territories/route.ts`
- `app/api/tenant/modules/route.ts`
- `app/api/tenant/hierarchy/route.ts`

### Admin (9)

- `app/api/tenant/admin/ai-providers/route.ts`
- `app/api/tenant/admin/ai-templates/[id]/route.ts`
- `app/api/tenant/admin/at-risk/[id]/route.ts`
- `app/api/tenant/admin/lead-scoring/[id]/route.ts`
- `app/api/tenant/admin/lead-scoring/route.ts`
- `app/api/tenant/admin/localization/route.ts`
- `app/api/tenant/admin/login-policy/route.ts`
- `app/api/tenant/admin/picklists/route.ts`
- `app/api/tenant/admin/user-defaults/route.ts`

### AI & Automation (6)

- `app/api/tenant/ai-keys/route.ts`
- `app/api/tenant/ai/activity/route.ts`
- `app/api/tenant/admin/ai-auto-followup/route.ts`
- `app/api/tenant/automation/workflows/route.ts`
- `app/api/tenant/automations/[id]/route.ts`
- `app/api/tenant/workflows/[id]/route.ts`

### Projects & Misc (10)

- `app/api/tenant/projects/[id]/route.ts`
- `app/api/tenant/projects/[id]/milestones/route.ts`
- `app/api/tenant/projects/[id]/tasks/route.ts`
- `app/api/tenant/kb/articles/[id]/route.ts`
- `app/api/tenant/kb/categories/[id]/route.ts`
- `app/api/tenant/canned-responses/[id]/route.ts`
- `app/api/tenant/assignment-rules/route.ts`
- `app/api/tenant/integrations/[id]/route.ts`
- `app/api/tenant/plugins/[id]/route.ts`
- `app/api/tenant/services/[id]/route.ts`

### Others (18)

- `app/api/tenant/analytics/churn/route.ts`
- `app/api/tenant/api-keys/[id]/route.ts`
- `app/api/tenant/approvals/[id]/route.ts`
- `app/api/tenant/backup/config/route.ts`
- `app/api/tenant/contacts/[id]/enroll/route.ts`
- `app/api/tenant/contacts/[id]/status/route.ts`
- `app/api/tenant/custom-fields/route.ts`
- `app/api/tenant/data-explorer/route.ts`
- `app/api/tenant/email-warmup/route.ts`
- `app/api/tenant/invite/[id]/route.ts`
- `app/api/tenant/jobs/dead-letter/route.ts`
- `app/api/tenant/lead-warming/campaigns/[id]/route.ts`
- `app/api/tenant/members/route.ts`
- `app/api/tenant/notification-prefs/route.ts`
- `app/api/tenant/notifications/matrix/route.ts`
- `app/api/tenant/notifications/route.ts`
- `app/api/tenant/onboarding/route.ts`
- `app/api/tenant/plugin-engine/route.ts`
- `app/api/tenant/portal/clients/route.ts`
- `app/api/tenant/reports/[id]/route.ts`
- `app/api/tenant/reports/custom/route.ts`
- `app/api/tenant/reports/scheduled/route.ts`
- `app/api/tenant/security/ip-whitelist/route.ts`
- `app/api/tenant/sms/templates/route.ts`
- `app/api/tenant/sso/providers/[id]/route.ts`
- `app/api/tenant/subscriptions/[id]/route.ts`
- `app/api/tenant/trash/route.ts`

## Rate Limit Defaults

| Entity                           | PATCH/min | DELETE/min |
| -------------------------------- | --------- | ---------- |
| Core CRM (contacts, deals, etc.) | 60        | 15         |
| Communication                    | 30        | 10         |
| Documents                        | 30        | 10         |
| Config/Admin                     | 10        | 5          |
| AI/Automation                    | 10        | 5          |
| Default                          | 30        | 10         |

## Verification

- `npx tsc --noEmit` — zero type errors
- `npx vitest run tests/integration/critical-coverage.test.ts` — 25/25 pass
- PR: #729
- Issue: #652 — closed
