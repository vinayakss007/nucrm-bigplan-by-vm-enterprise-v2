# NuCRM Production Rollout Plan — Phases 0 → 8

This is the canonical, sequenced plan for shipping the end-to-end customer
workflow + AI multi-provider rollout. Each phase is mergeable on its own,
verified with `tsc --noEmit`, `vitest run`, and `npm run build` before push.

Phases marked **DONE** have shipped on a branch (PR linked).
Phases marked **NEXT SESSION** are queued and described in enough detail
that any session can pick them up cleanly.

---

## Mental model

```
  Person (Contact)                              ← one record per real person/email
  ├── Lead LD-2025-001  (product: AI CRM)       ← a sales conversation
  │   ├── BANT discovery                        ← what does the client want
  │   ├── Assignments: Alice → Bob → Carol      ← handoff trail (lead_assignments)
  │   ├── Offers (services/products + qty + price + status)   ← Phase 4
  │   ├── Communications: 12 emails, 3 calls, 1 meeting       ← activities table
  │   └── Status: qualified → proposal → won/lost
  ├── Lead LD-2025-007  (product: Helpdesk)     ← same person, new conversation
  │   └── Status: nurturing
  └── Lead LD-2026-003  (product: Real Estate)
      └── Status: new

  → Contact detail page surfaces ALL of this in a single view.
```

The shift from the old model: **lead intake immediately attaches to a
contact** (existing-by-email or new). "Convert" stops meaning "create
contact" and starts meaning "promote this conversation into a deal".

---

## Phase 0 — Schema additions + migration + backfill — **DONE**

**Branch**: `feat/workflow-foundation` (current)
**Migration**: `drizzle/migrations/0010_workflow_foundation.sql`

Schema (additive only, no destructive ops):
- `leads.contact_id`  nullable FK → `contacts.id` (one contact, many leads)
- `leads.lead_oid`    text — human-readable per-tenant id (`LD-2025-001`)
- `leads.product_id`  text — `lib/products/registry.ts` key
- New `lead_offers`             — what was offered to the client per lead
- New `ai_providers`            — super-admin provider allow-list + flags
- New `tenant_ai_credentials`   — per-tenant BYO key + approval workflow

Backfill: `UPDATE leads SET contact_id = converted_contact_id WHERE
contact_id IS NULL AND converted_contact_id IS NOT NULL`.

Seeds: 6 canonical AI providers (`openai`, `anthropic`, `groq`, `mistral`,
`ollama`, `openai-compatible`).

Journal entries added for `0008`, `0009`, `0010` (journal was stale).

**Verified**: `tsc --noEmit` 0 errors, `vitest run` 435 passed (2 pre-existing
PG-not-running failures unchanged), `npm run build` succeeded.

---

## Phase 1 — Lead intake auto-attaches to contact — **DONE**

**Branch**: same as Phase 0 — shipped together as PR-A.

Files:
- `lib/contacts/resolve.ts`           — `resolveOrCreateContactForLead({ tx, tenantId, userId, lead })` + `resolveOrCreateCompany`
- `lib/leads/oid.ts`                  — `generateLeadOid({ tx, tenantId })` → `LD-{year}-{NNN}`
- `app/api/tenant/leads/route.ts`     — POST runs in a transaction:
  1. `resolveOrCreateContactForLead` (email dedup)
  2. `generateLeadOid`
  3. insert lead with `contactId`, `leadOid`, `productId`
  4. emit `lead_activities` row + unified `activities` row (`event_type='lead_created'`)
- `app/api/tenant/leads/import/route.ts` — rewritten cleanly: per-row
  transaction; uses helper for each row; skipDuplicates / updateExisting
  preserved; reports `newContacts` / `mergedContacts` counts; the broken
  `db.insert().values()` activity-log call at the end is removed.
- `app/api/tenant/leads/[id]/convert/route.ts` — now respects an existing
  `lead.contact_id` (skips email dedup if already linked), backfills
  `lead.contact_id` for legacy leads. Convert is no longer the contact-creation
  path; for new leads it only updates the contact and creates the deal.

**Form submit** (`app/api/forms/submit/route.ts`) is intentionally left alone —
it creates contacts directly (newsletter / marketing forms), not leads.
Sales-intent forms that should create a lead instead are a future
"form intent type" feature handled in Phase 8.

---

## Phase 2 — Contact "Leads" tab + GET API — **DONE**

**Branch**: same as Phase 0/1.

Files:
- `app/api/tenant/contacts/[id]/leads/route.ts` — `GET` returns every lead
  linked to the contact, enriched with `assigned_name`, `assigned_avatar`,
  `offer_total`, `offer_count`, `offer_currency` (open offers only), plus
  status / stage / score / value / BANT summary fields.
- `components/tenant/contact-detail-client.tsx` — adds a `Leads` tab to the
  tab bar; lazy-fetches when activated; renders one row per lead with:
  - lead OID + status pill + product chip
  - BANT summary line (budget · timeline · need)
  - assignee, last-activity time, score
  - open offer total (or estimated value as fallback)
  - click → navigate to `/tenant/leads/{id}`

**Acceptance**: opening any contact shows every lead (past + present),
one-click jump into each.

---

## Phase 3 — Handoff trail visible — **DONE**

**Branch**: same as Phase 0/1/2.

Files:
- `app/api/tenant/leads/[id]/assign/route.ts` — `POST { assigned_to, reason? }`:
  1. validates `assigned_to` is a member of the tenant via `tenant_members`
  2. flips `leads.assigned_to`
  3. inserts `lead_assignments` row (handoff history)
  4. inserts `lead_activities` row (`activity_type='reassigned'`)
  5. inserts unified `activities` row (`event_type='lead_reassigned'`,
     metadata: `from_user_id`, `from_user_name`, `to_user_id`,
     `to_user_name`, `reason`)
  6. fires audit log + assignee notification
- `components/tenant/lead-detail-client.tsx` — adds a "Hand off" button
  next to "Edit"; opens a modal with team-member dropdown + reason textarea;
  calls the new endpoint; toast + `router.refresh()` on success.

**Note**: a future polish is to add `lead_reassigned` to `EVENT_TYPE_CONFIG`
in `components/tenant/contact-timeline.tsx` so the timeline renders a
dedicated icon/color for it (currently uses the `Activity` fallback which
still works correctly).

---

## Phase 4 — Offers system (what the customer was offered) — **NEXT SESSION**

Goal: capture line-item-level offer data per lead so reps can see
"customer wanted X for Y price" without diving into deals.

API (new):
- `GET    /api/tenant/leads/[id]/offers`           — list
- `POST   /api/tenant/leads/[id]/offers`           — create
- `PATCH  /api/tenant/leads/[id]/offers/[offerId]` — update
- `DELETE /api/tenant/leads/[id]/offers/[offerId]` — soft-delete (sets
  `deleted_at`)

UI:
- New `Offers` section on `lead-detail-client.tsx` (card under BANT). Inline
  add/edit/delete; each row picks from `services` catalog or accepts free-form
  description, plus qty, unit price, currency, status (`proposed` / `accepted`
  / `rejected` / `withdrawn`).
- Auto-sum total displayed at bottom; writing back to `lead.value` for
  forecasting.

Activity events:
- `offer_added`, `offer_status_changed` written to `activities` (entityType
  `lead`); show on contact timeline too.
- Add corresponding entries in `EVENT_TYPE_CONFIG`
  (`components/tenant/contact-timeline.tsx`).

Convert hook:
- When a lead is converted to a deal, copy each non-rejected offer into
  `quote_line_items` or `deal_products` (whichever fits the new deal's
  pipeline contract — check both schemas in `drizzle/schema/billing.ts` and
  `drizzle/schema/crm.ts`).

Acceptance: opening a lead shows what was offered; opening the contact
shows offers across all their leads via the existing Leads tab's
`offer_total`/`offer_count` columns; on convert, the deal pre-populates
with the offer line items.

---

## Phase 5 — AI multi-provider gateway — **NEXT SESSION**

Goal: replace the hardcoded Anthropic call with a provider-agnostic
gateway that supports OpenAI, Anthropic, Groq, Mistral, Ollama, and any
OpenAI-compatible base URL.

Files (new):
- `lib/ai/gateway.ts` — single export:
  ```ts
  createCompletion({
    tenantId, userId,
    providerKey?,           // override; otherwise pick tenant default
    model?,                 // override; otherwise tenant default for that provider
    messages,               // OpenAI-style { role, content }[]
    stream?,                // boolean — returns ReadableStream when true
    tools?,                 // function-calling spec, normalised across providers
    fallbackChain?,         // override the credential's own fallbackChain
  }): Promise<{ text, usage } | ReadableStream>
  ```
- `lib/ai/providers/openai.ts`, `anthropic.ts`, `groq.ts`, `mistral.ts`,
  `ollama.ts`, `compatible.ts` — adapters. OpenAI / Groq / Mistral / Ollama
  / openai-compatible all share an OpenAI-shape adapter parameterised on
  base URL + auth header.
- `lib/crypto/secrets.ts` — `encryptSecret` / `decryptSecret` (AES-GCM with
  a key derived from `process.env.SECRETS_MASTER_KEY`). Add to `.env.example`.

Modify:
- `app/api/tenant/ai/route.ts` — calls `createCompletion`; supports
  `?stream=1` for SSE; preserves the existing `score_lead`, `predict_deal`,
  `enrich_contact`, `suggest_followup`, `draft_email` actions but routes
  the prompt through `createCompletion`.
- `lib/ai/common.ts` — keep `checkTokenAndLimits` + `recordUsage` exactly
  as-is; gateway calls them.

Tenant settings shape on `tenantModules['ai-assistant'].settings` (kept
for backwards compat) is **deprecated** and replaced by
`tenant_ai_credentials` rows. Migration path: on first `createCompletion`
call, if a tenant has the legacy `settings.anthropic_api_key` and no
`tenant_ai_credentials` row, create one with `provider_key='anthropic'`
and `status='approved'` (legacy users grandfathered).

Multi-provider fallback:
- On 5xx / timeout / rate-limit, gateway iterates `fallbackChain`. Records
  the failure in `tenantAiCredentials.errorCount` and bumps `lastUsedAt` on
  success.

No mocks anywhere — every adapter hits a real API endpoint or local Ollama.

Acceptance: same `score_lead` action runs against any of the 6 providers
by changing the credential row; streaming works end-to-end with curl;
`tsc` 0 errors; tests still pass.

---

## Phase 6 — AI provider approval workflow — **NEXT SESSION**

Depends on Phase 5.

Super-admin pages:
- `app/superadmin/ai-providers/page.tsx` — toggle each provider's
  `enabled`, `allow_platform_key`; edit `rate_limits`. Server actions on
  the page hit `/api/superadmin/ai-providers`.
- `app/superadmin/ai-credentials/page.tsx` — pending-approval queue with
  one-click approve / reject; reject requires a reason. Approve sets
  `status='approved'`, `approved_by`, `approved_at`. Notify tenant owner
  via in-app + email.

Tenant page:
- `app/tenant/settings/ai/page.tsx` — table of the tenant's
  `tenant_ai_credentials` rows with status badge (pending / approved /
  rejected / revoked). Form to create a new credential (provider dropdown
  filtered to enabled providers + model + key + base URL override). On
  submit, status is `pending`; can be `revoke`d any time.

Gateway enforcement:
- `lib/ai/gateway.ts` refuses to call when:
  1. credential `status !== 'approved'`, OR
  2. linked `ai_providers.enabled === false`.
  Returns a clear `403 { error: 'Provider pending approval' | 'Provider disabled by platform' }`.

Acceptance: tenant saves a key → super-admin sees pending → approves →
tenant's AI calls work. Rejecting blocks them with a clear error.

---

## Phase 7 — AI surfaced in the UI — **NEXT SESSION**

Depends on Phases 5, 6.

Surfaces:
1. **Score this lead with AI** button on `lead-detail-client.tsx` BANT
   card. Calls `score_lead`; writes `lead.score` and appends a
   `score_reason` paragraph to `lead.internalNotes`. User-editable before
   apply.
2. **Suggest next action** panel on `contact-detail-client.tsx` Activity
   tab. Calls `suggest_followup`; renders the
   `{ action, timing, channel, script }` JSON in editable inputs. Apply
   button creates a task / drafts an email / books a meeting depending on
   channel.
3. **Draft email with AI** button in any email composer drawer. Calls
   `draft_email`; fills the textarea, user can edit before sending.
4. **Predict outcome** chip on each deal card in
   `app/tenant/deals/kanban/page.tsx`. Calls `predict_deal`; popover shows
   win probability + risk factors + recommendations.
5. **AI digest** dashboard widget at `app/tenant/dashboard/page.tsx` — top
   3 leads to call today, top 3 deals at risk. Cron-cached for 15 min via
   `lib/cache/redis.ts` to avoid spamming the gateway.

Empty states:
- No provider configured: button shows "Configure AI in Settings → AI"
  with deep link.
- Provider pending approval: button disabled, tooltip "Awaiting super-admin
  approval".

Acceptance: all 5 surfaces live; with an approved tenant credential,
clicking each one produces a real, editable output; with no provider,
the deep link works.

---

## Phase 8 — Cleanups (mergeable any time, in any order) — **NEXT SESSION**

Each item is a small standalone PR.

| ID | Item | Files |
|---|---|---|
| 8a | Industry-template-driven lead intake forms (per-vertical fields) | `lib/industry-templates/*`, `app/forms/[id]/page.tsx`, `components/tenant/lead-import-modal.tsx` |
| 8b | Bulk action bar lift to companies / deals / tasks / users | extract `hooks/useBulkSelection.ts` from `components/tenant/contacts-client.tsx`; render `BulkActionBar` on each `*-data-table.tsx` |
| 8c | Product entry pages scope data to their `mainPipeline` | `app/tenant/products/[productId]/clients/page.tsx`, etc. — filter by `lifecycle_stage` / `pipeline_id` from `lib/products/registry.ts` |
| 8d | Lead-import modal advertised columns reconciled with importer | `components/tenant/lead-import-modal.tsx` (advertised list) ↔ `app/api/tenant/leads/import/route.ts` `LEAD_COLUMN_MAP` |
| 8e | Stale `in_progress` feature metadata flipped to `completed` | `.agents/tasks/*/features/*.json` |
| 8f | Lead-status PATCH activity log uses correct field name | `app/api/tenant/leads/[id]/route.ts` — change `rawBody.lead_status` to `v.status` (one-liner) |
| 8g | SMS / WhatsApp / chat channels emit `activities` rows | `app/api/tenant/sms/*`, `app/api/tenant/whatsapp/*`, `app/api/tenant/chat/*` — insert `activities` row with appropriate event type. Add `EVENT_TYPE_CONFIG` entries in `components/tenant/contact-timeline.tsx`. |
| 8h | Add `lead_created` and `lead_reassigned` to `EVENT_TYPE_CONFIG` | `components/tenant/contact-timeline.tsx` — give them dedicated icons + colors |
| 8i | `convertedContactId` deprecation note in schema | `drizzle/schema/crm.ts` — comment that `contact_id` is the canonical pointer; `convertedContactId` is kept for legacy reads |

---

## Recommended sequencing

```
PR-A  Phase 0+1+2+3   Workflow foundation (this PR)             ← DONE / pending merge
PR-B  Phase 4         Offers system
PR-C  Phase 5         AI multi-provider gateway                  (parallel-safe)
PR-D  Phase 6         AI provider approval workflow              (depends on PR-C)
PR-E  Phase 7         AI surfaced in the UI                      (depends on PR-C, PR-D)
PR-F  Phase 8         Cleanups                                   (each subitem its own small PR)
```

PR-C can start in parallel with PR-B because the AI gateway has no schema
dependency on offers.

---

## Verification commands (run before every push)

```bash
# Type check
npx tsc --noEmit

# Tests (the 2 PG-dependent failures in tests/integration/backup-integrity.test.ts are pre-existing)
npx vitest run

# Production build
JWT_SECRET=test-secret-32-chars-minimum-required npm run build
```

All three must be green before push.

---

## What's currently in `feat/workflow-foundation` (this branch, ready to PR)

Files modified / created:
- `drizzle/schema/crm.ts`                                    (Phase 0)
- `drizzle/schema/ai.ts`                                     (Phase 0, new)
- `drizzle/schema/index.ts`                                  (Phase 0)
- `drizzle/migrations/0010_workflow_foundation.sql`          (Phase 0, new)
- `drizzle/migrations/meta/_journal.json`                    (Phase 0)
- `lib/contacts/resolve.ts`                                  (Phase 1, new)
- `lib/leads/oid.ts`                                         (Phase 1, new)
- `app/api/tenant/leads/route.ts`                            (Phase 1)
- `app/api/tenant/leads/import/route.ts`                     (Phase 1, rewrite)
- `app/api/tenant/leads/[id]/convert/route.ts`               (Phase 1)
- `app/api/tenant/contacts/[id]/leads/route.ts`              (Phase 2, new)
- `components/tenant/contact-detail-client.tsx`              (Phase 2)
- `app/api/tenant/leads/[id]/assign/route.ts`                (Phase 3, new)
- `components/tenant/lead-detail-client.tsx`                 (Phase 3)
- `WORKFLOW_PLAN.md`                                          (this document)
