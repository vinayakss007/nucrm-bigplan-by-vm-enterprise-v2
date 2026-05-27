# NuCRM — Workflow Plan (Phases 0 → 8)

> Canonical phase numbering for the project. Use this doc — **not**
> `REMAINING_BUILD_PLAN.md` or `WORKING_PLAN.md` — to discuss progress.
> Phases were originally defined in steering across earlier sessions; this
> file collects them so the state is auditable.
>
> Status legend: ✅ shipped · ⏳ in progress · 🟡 partial · 🔲 not started

| Phase | Theme | Status |
|---|---|---|
| 0 | Foundation (23 baseline gaps — TS, Zod, XSS, rate-limit, CI, a11y, i18n, mobile, OpenAPI, DLQ, RLS, bundle) | ✅ |
| 1 | Enterprise CRM build (PR #1: module enforcement, usage limits, per-user restore, SDK, settings layout) | ✅ |
| 2 | Industry templates · Stripe core · white-label · multi-frontend gateway · advanced RBAC · SSO · webhooks v2 | ✅ |
| 3 | GDPR/SOC2 · SSO/RBAC/Compliance UIs · SLA · auto-assignment · documents · reports · SMS/chat/email-tracking · currency/tax/e-sign · leaderboards · territories · hierarchy · visitor-tracking | ✅ |
| **4** | **Offers** (new entity surface backed by existing `quotes` schema) | 🔲 |
| **5** | **AI multi-provider gateway** + secrets vault + activity log | ✅ (PR #27) |
| **6** | **Approval-workflow surfaces** (engine + table exist; routes + UI missing) | 🟡 |
| **7** | **AI surfaces** (Score lead · Suggest follow-up · Draft email · Predict outcome · AI digest) — depend on #5 + #6 | 🔲 |
| **8** | **Cleanups** (independent — TS sweep, drift fixes, AWS SDK, build hygiene) | 🔲 |

---

## Phase 0 — Foundation ✅

23 GAPs closed for `v1.0.0`. Detailed in `REMAINING_GAPS.txt`. Includes:
TypeScript zero-error baseline, Zod validation, DOMPurify XSS, strong dev
secrets, Redis-backed rate limit, central `apiError` boundary, v1 API
deprecation, cache layer, pagination, real Drizzle migrations, GitHub
Actions CI/CD, Sentry+Grafana+Prometheus, backup integrity tests, k6 load
tests, WCAG 2.1 AA accessibility, `next-intl` i18n, mobile-first
(swipeable, pull-to-refresh, bottom-sheet, 44 px tap targets), OpenAPI,
webhook DLQ + manual retry, audit-log SHA-256 chain, RLS pen tests,
bundle splitChunks.

## Phase 1 — Enterprise CRM build (PR #1) ✅

`task-enterprise-crm-build` task: TS errors 63 → 0, `requireModule` /
`requireFeature` gates, `userUsage` + `planLimits` tables, threshold
notifications (80/90/100 %), per-user selective restore, NuCRM SDK
foundation (typed client, 8 resources, HMAC webhook verifier), settings
layout `max-w` cleanup, plan-based auto-install on signup.

## Phase 2 — Industry templates · Stripe · gateway · RBAC · SSO ✅

`task-enterprise-crm-phase2`: 13 industry templates with custom fields,
pipelines, automations and module assignments; raw-fetch Stripe client +
checkout / portal / webhook with HMAC; white-label branding engine
(per-tenant CSS variables, custom-domain validation, sanitised CSS);
multi-frontend `/api/v2/` gateway (API key, X-Tenant-ID, custom-domain,
subdomain resolution); advanced RBAC (field-level, record-level,
approval-workflow tables); SSO/SAML/OIDC core with state-cookie CSRF
defence; webhook expansion (11 → 25 events) with exponential backoff +
DLQ.

## Phase 3 — Compliance · vertical modules · channels · billing ✅

`task-enterprise-crm-phase3`: GDPR + SOC 2 + retention; SSO / RBAC /
Compliance UI pages; SLA management; auto-assignment rules; documents;
report builder; SMS via Twilio with template interpolation; live chat
with session lifecycle; email open/click pixel + redirect; currency /
tax / e-signature; leaderboards / territories / hierarchy / visitor
tracking. Closed by FEAT-006 fixing 8 review-found security holes
(chat-widget, visitor-tracking, email-tracking, assignment+SLA spread,
leaderboards module gate, e-sign HMAC, public-endpoint rate limits).

---

## Phase 4 — Offers 🔲

> **Note.** The phrase "schema is already in place from Phase 0" maps to
> the existing `quotes` family — `quotes`, `quoteLineItems`, `priceBooks`,
> `priceBookEntries` in `drizzle/schema/crm.ts`. There is **no separate
> `offers` table**. Phase 4 reframes that schema as a customer-facing
> "offer" surface: a quote that has been sent, optionally tied to an
> approval flow, that the buyer can accept or decline.

### 4.1 — Schema delta (small)
- Confirm `quotes` row supports `status` `draft|submitted|accepted|declined|expired`.
- Add `metadata.offer` jsonb scope: `{ accepted_at, accepted_by_email, decline_reason, expires_at, public_token }` (no migration; uses existing `metadata` jsonb).

### 4.2 — Endpoints
- `POST /api/tenant/offers/[quoteId]/send`   — finalise + email link with public token
- `GET  /api/public/offers/[publicToken]`     — buyer view (read-only)
- `POST /api/public/offers/[publicToken]/accept`
- `POST /api/public/offers/[publicToken]/decline`
- Reuse `/api/tenant/quotes/*` for the seller-side CRUD (already exists).

### 4.3 — UI
- `/tenant/offers` — list (filter by `status`)
- `/tenant/offers/[id]` — seller detail with Send / Resend / Cancel
- `/p/offers/[publicToken]` — public buyer page (mobile-first, no auth)

### 4.4 — Workflow integration
- Emit `activities` row on send / accept / decline so the contact timeline
  reflects the lifecycle.
- Wire to **Phase 6 approval workflow** when amount > tenant threshold.
- Wire to **Phase 7 AI digest** so reps see "5 offers awaiting buyer".

---

## Phase 5 — AI multi-provider gateway ✅ (PR #27)

Shipped in `feat/phase-4-ai-gateway-foundation` → PR #27.

### What landed
- `drizzle/schema/ai.ts` — `ai_provider_secrets` (encrypted, AES-256-GCM)
  + `ai_activity` (per-call log) registered in `_registry.ts`.
- `lib/ai/secrets.ts` — `setProviderKey / getProviderKey /
  getProviderKeyMeta / listProviderKeyMeta / deleteProviderKey`.
- `lib/ai/gateway.ts` — `chat({ provider?, model?, system?, messages,
  ... })` with OpenAI / Anthropic / Groq / Ollama, fallback chain,
  per-attempt logging, typed `GatewayError`.
- `app/api/tenant/admin/ai-providers/route.ts` GET / PATCH / DELETE —
  splits config (jsonb) from keys (vault).
- `app/api/tenant/ai/route.ts` — refactored to call `gateway.chat`,
  preserves all 4 actions and the legacy `recordUsage` bookkeeping.
- `app/api/tenant/ai/status/route.ts` — typed Drizzle query against
  `ai_activity`.
- `app/api/tenant/ai/activity/route.ts` GET (paged, filtered, summary)
  + PATCH (mark accepted).
- `app/tenant/ai/activity/page.tsx` — replaces the shell page with a
  real audit table (5 stat cards · 3 filters · pagination · per-row
  thumbs-up/down).

`tsc --noEmit`: 78 errors total (= main baseline; 0 introduced).
`vitest run`: 435 passed; 2 pre-existing PG/backup failures.

---

## Phase 6 — Approval-workflow surfaces 🟡

`drizzle/schema/core.ts` already defines `approvalRequests` with
`{ entityType, entityId, ruleId, status: pending|approved|rejected,
requestedBy, approvedBy, approvedAt, rejectionReason, metadata }`.
Engine code lives at `lib/rbac/approval-workflows.ts` (`checkNeedsApproval`,
`requestApproval`, `approveRequest`, `rejectRequest`).

Missing — to ship in this phase:

### 6.1 — Routes
- `GET  /api/tenant/approvals` — list pending/all
- `PATCH /api/tenant/approvals/[id]` — `{ action: 'approve'|'reject', reason? }`

### 6.2 — UI
- `/tenant/approvals` — manager inbox with filters (status, entity, requester)
- Inline "Pending approval" banner on the source entity (deal, offer, refund)
- Notification matrix entry for `approval_requested` / `approval_approved`

### 6.3 — Wire-in points
- **Phase 4 Offer send** above some `tenants.settings.approval_thresholds.offer_amount`
- Bulk transfer (Phase 3 lift) for sensitive pools
- Manual rule editor in `/tenant/settings/approvals` (small)

---

## Phase 7 — AI surfaces 🔲

Five capability pages exist as `<AIComingSoon />` shells today
(`/tenant/ai/{draft,lead-scoring,at-risk,summarize,activity}`). Activity
is now real (Phase 5). The other four need backend wiring on top of the
gateway shipped in Phase 5 and the approval engine in Phase 6.

### 7.1 — Score lead
- `drizzle/schema/ai.ts` (extension): `lead_scoring_rules` table
  (factor, weight, condition, active).
- `app/api/tenant/admin/lead-scoring/*` — CRUD + recompute.
- `/tenant/settings/lead-scoring` — drag-orderable factor list, recompute, distribution preview.
- `/tenant/ai/lead-scoring` — ranked-leads table with "why this score" panel.
- Cron `process-lead-scoring` — nightly recompute via `gateway.chat`.

### 7.2 — Suggest follow-up
- `/tenant/ai/suggest` (or in-place on contact detail) — calls existing
  `gateway.chat({ action: 'suggest_followup' })` (already wired).
- One-click "Add as task" / "Draft email" / "Schedule meeting" actions.

### 7.3 — Draft email
- `drizzle/schema/ai.ts` (extension): `ai_draft_templates` (per-tenant
  prompts).
- `app/api/tenant/admin/ai-templates/*` — CRUD.
- `/tenant/settings/ai-templates` page.
- `app/api/tenant/ai/draft/route.ts` — `{ entity_type, entity_id,
  template_id }` → context-hydrated prompt → gateway → diff editor →
  Send via existing email pipe.
- `/tenant/ai/draft` — entity picker + template select + diff editor.

### 7.4 — Predict outcome
- `drizzle/schema/ai.ts` (extension): `at_risk_rules` (stage, max_days_idle, sentiment_threshold).
- `app/api/tenant/admin/at-risk/*` — CRUD.
- `/tenant/settings/at-risk-rules` page.
- `/tenant/ai/at-risk` — flagged-deals table with manager nudge action.
- Cron `process-at-risk` — daily flag run.
- Reuse `gateway.chat({ action: 'predict_deal' })` for per-deal calls.

### 7.5 — AI digest
- New `/tenant/ai/digest` — per-user daily / weekly summary built from
  `ai_activity` + recent contact / deal / lead activity.
- Optional email digest (uses Phase 7.3 once it lands).

---

## Phase 8 — Cleanups 🔲

Independent items — can land in any order, no dependencies.

### 8.1 — TypeScript debt
- Sweep the 78 `tsc --noEmit` errors carried across recent PRs as
  "unchanged from main".
- Fix the bulk-transfer / user-data routes that import non-existent
  schema columns (`tickets`, `contacts.ownerId`, `deals.ownerId`,
  `deals.value`, `deals.stage`, `activities.type`) — these block
  `npm run build` on Next 16.

### 8.2 — Test stabilisation
- `tests/integration/backup-integrity.test.ts` — needs real Postgres on
  127.0.0.1:5432 + a `tmp/backup-test-corrupt.sql` fixture. Either
  ship a Postgres-in-Docker harness for CI or move these tests behind a
  `INTEGRATION=1` gate.
- `tests/integration/tenant-isolation.test.ts` — same Postgres need.

### 8.3 — Build / dependency hygiene
- `@aws-sdk/client-s3` vs `@aws-sdk/s3-request-presigner` version
  mismatch (currently bridged with `as any` since Phase 3).
- Document `JWT_SECRET` and `ENCRYPTION_KEY` build-time requirement in
  `MAINTENANCE_UPDATE_GUIDE.md`.
- Sweep stale `STRIPE_PRICE_ID_MONTHLY/_YEARLY` placeholders.

### 8.4 — Lint / warning sweep
- The "9 pre-existing warnings on touched files" bag carried through
  every PR.

### 8.5 — Pre-existing `noPropertyAccessFromIndexSignature` violations
- Several `Record<string, unknown>` writes use dot notation; convert to
  `obj['key']` to match strict tsconfig (PR #27 hit this on `cfg`).

---

## Build order (next 5 PRs)

| # | Phase | Branch | Notes |
|---|---|---|---|
| 1 | 8.1 + 8.3 (subset) | `chore/phase-8-build-fixes` | Unblock `npm run build` first — without it nothing else can be verified end-to-end. |
| 2 | 6 | `feat/phase-6-approval-surfaces` | Tables exist, just needs routes + UI. |
| 3 | 4 | `feat/phase-4-offers` | Reuses `quotes` schema. Public buyer page is small. |
| 4 | 7.3 | `feat/phase-7-3-draft-email` | Highest impact AI surface. |
| 5 | 7.1 | `feat/phase-7-1-lead-scoring` | Then the other AI surfaces in parallel. |

7.2, 7.4, 7.5 can run in parallel after 7.3.

---

## Cross-references

- Detailed sub-task breakdown: `REMAINING_BUILD_PLAN.md`
  (older numbering — this doc is canonical).
- Engineering-stage map: `WORKING_PLAN.md` (different concern: infra /
  tests / UI tracks rather than feature phases).
- Customer journey: `WORKFLOW.md` (the lead → contact → deal → ... map).
- Competitive frame: `POSITIONING.md`.
- Ops gap log: `BULK_AND_SETTINGS_GAPS.md`, `REMAINING_GAPS.txt`.
