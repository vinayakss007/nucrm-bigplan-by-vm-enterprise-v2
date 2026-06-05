# NuCRM — Remaining Build Plan (Phase 4 → Phase 10)

> Single source of truth for every gap not yet closed.  
> Compiled from `WORKFLOW.md`, `BULK_AND_SETTINGS_GAPS.md`, `POSITIONING.md`,  
> `BUGS.md`, `REMAINING_GAPS.txt` and the merged-PR history.  
> Update this doc when a row ships. Anything not on this list is **not** in scope.

## Status snapshot

| Layer | Status |
|---|---|
| **Phase 0** — 23 baseline gaps (TS / Zod / XSS / rate-limit / CI / a11y / i18n / mobile / OpenAPI / DLQ / RLS / bundle) | ✅ done (`v1.0.0`) |
| **Phase 1** — `task-enterprise-crm-build` (PR #1): module enforcement, usage limits, per-user restore, SDK foundation, settings layout | ✅ done |
| **Phase 2** — `task-enterprise-crm-phase2`: 13 industry templates, Stripe core, white-label, multi-frontend gateway, advanced RBAC, SSO, webhook expansion | ✅ done |
| **Phase 3** — `task-enterprise-crm-phase3`: GDPR/SOC2, SSO/RBAC/Compliance UIs, SLA, auto-assignment, documents, reports, SMS/chat/email-tracking, currency/tax/e-sign, leaderboards, territories, hierarchy, visitor-tracking + FEAT-006 security fixes | ✅ done |
| **Side tasks** — product-pages-sdk, frontend-gaps-fix, remaining-features-sentry, perf/scaling/PWA/Stripe-full/SSO-admin/landing/aesthetic/recovery/onboarding/bulk-ops/lead-workflow/contacts-bulk (PRs #14–#25) | ✅ done |
| **Phase 4** — AI Gateway, Secrets Vault, Activity Log | ⏳ in progress |
| **Phase 5** — Workflow completeness | ⏳ |
| **Phase 6** — Bulk-ops completion | ⏳ |
| **Phase 7** — Settings UI closures | ⏳ |
| **Phase 8** — Super-admin operations | ⏳ |
| **Phase 9** — Channels & integrations | ⏳ |
| **Phase 10** — Tech debt | ⏳ |

---

## Phase 4 — AI Gateway, Secrets Vault, Activity Log  (HIGHEST PRIORITY)

> Source: `POSITIONING.md` "AI as the engine, not a paid bolt-on" + `WORKFLOW.md` gap #1 + 5 AI shell pages already shipped (`/tenant/ai/draft`, `/lead-scoring`, `/at-risk`, `/summarize`, `/activity`).

### 4.1  Foundation (this PR)

- [ ] `drizzle/schema/ai.ts` — `ai_provider_secrets` (encrypted) + `ai_activity` (per-call log)
- [ ] `lib/ai/secrets.ts` — `setProviderKey / getProviderKey / hasProviderKey / deleteProviderKey` using AES-256-GCM via `lib/crypto.ts` (same pattern as SSO `client_secret`)
- [ ] `lib/ai/gateway.ts` — provider-agnostic `chat({ provider, messages, system, max_tokens, temperature })`
  - OpenAI (`/v1/chat/completions`)
  - Anthropic (`/v1/messages`)
  - Groq (OpenAI-compatible at `api.groq.com`)
  - Ollama (`/api/chat` at configurable base URL)
  - Fallback chain by `fallback_priority`
  - Writes one `ai_activity` row per attempt (provider, model, tokens, cost, latency, success)
  - Honours existing `checkTokenAndLimits` / `recordUsage`
- [ ] Refactor `app/api/tenant/admin/ai-providers/route.ts` PATCH to call `setProviderKey` (drop the jsonb-only `api_key_set` marker)
- [ ] Refactor `app/api/tenant/ai/route.ts` to call `gateway.chat()` instead of `callClaude()` — preserve all 5 actions (`draft_email`, `score_lead`, `predict_deal`, `enrich_contact`, `suggest_followup`)
- [ ] `/api/tenant/ai/status` reads real `ai_activity` rows for today
- [ ] `/api/tenant/ai/activity` GET — paged list of recent calls
- [ ] `/tenant/ai/activity` page — replace shell with real table
- [ ] Verify: `tsc --noEmit` 0 new errors, `vitest run` passes, `npm run build` green

### 4.2  Auto-Draft backend (next PR)

- [ ] `drizzle/schema/ai.ts` — `ai_draft_templates` table (per-tenant prompts)
- [ ] `app/api/tenant/admin/ai-templates/*` — CRUD
- [ ] `/tenant/settings/ai-templates` page
- [ ] `app/api/tenant/ai/draft/route.ts` — accepts `{ entity_type, entity_id, template_id }`, hydrates context, calls `gateway.chat()`, returns draft + lets user save / send via existing email pipe
- [ ] `/tenant/ai/draft` page — entity picker + template select + diff editor + Send

### 4.3  Lead-scoring rules editor (next PR)

- [ ] `drizzle/schema/ai.ts` — `lead_scoring_rules` (factor, weight, condition, active)
- [ ] `app/api/tenant/admin/lead-scoring/*` — CRUD + recompute
- [ ] `/tenant/settings/lead-scoring` page — drag-orderable factor list, recompute button, score-distribution preview
- [ ] `/tenant/ai/lead-scoring` page — replace shell with ranked-leads table + per-row "why this score"
- [ ] Cron `process-lead-scoring` — nightly recompute

### 4.4  At-risk deals (next PR)

- [ ] `drizzle/schema/ai.ts` — `at_risk_rules` (stage, max_days_idle, sentiment_threshold)
- [ ] `app/api/tenant/admin/at-risk/*`
- [ ] `/tenant/settings/at-risk-rules` page
- [ ] `/tenant/ai/at-risk` page — flagged-deals table + manager nudge action
- [ ] Cron `process-at-risk` — daily flag

### 4.5  Summarize-anywhere (small follow-up)

- [ ] `app/api/tenant/ai/summarize/route.ts` — accepts entity, returns TL;DR via gateway
- [ ] `/tenant/ai/summarize` shell → real entity picker

---

## Phase 5 — Workflow completeness  (`WORKFLOW.md` tracked gaps)

- [ ] **5.1** Industry templates drive lead-intake forms — per-vertical field schema in `lib/industry-templates/*`, rendered in public form pages and the inline lead "Add" modal
- [ ] **5.2** Per-product Clients views — registry's `sidebarItems: [{ label: 'Clients' }]` filtered by `pipeline_id` / `lifecycle_stage` per product
- [ ] **5.3** Unified communications-to-activities emission — every SMS / WhatsApp / email writer also writes an `activities` row with the right `eventType`; add the matching `EVENT_TYPE_CONFIG` entries to `contact-timeline.tsx`
- [ ] **5.4** Bulk action bar lifted from contacts to companies / deals / tasks / users data-tables (shared hook)
- [ ] **5.5** BANT custom fields documented migration path (when a tenant already defined a same-purpose custom field, surface a one-click "promote to native" tool)

---

## Phase 6 — Bulk-ops completion  (`BULK_AND_SETTINGS_GAPS.md` §5)

- [ ] **6.1** Bulk add to sequence (contacts, leads)
- [ ] **6.2** Bulk add to list / segment (contacts, leads, companies)
- [ ] **6.3** Bulk update custom field value (all entities) — single-field PATCH via `/bulk` `action: 'update_field'`
- [ ] **6.4** Bulk note / activity — adds the same note across N records
- [ ] **6.5** Bulk merge for leads & companies (contacts has partial)
- [ ] **6.6** Bulk archive / restore (counterpart to existing soft-delete)
- [ ] **6.7** Bulk email send (with template + merge tags)
- [ ] **6.8** Bulk SMS / WhatsApp send
- [ ] **6.9** Cross-resource bulk-invite users (paste CSV in admin)
- [ ] **6.10** Bulk role change / deactivate / force-relogin / 2FA-enforce

---

## Phase 7 — Settings UI closures  (`BULK_AND_SETTINGS_GAPS.md` TODO)

- [ ] **7.1** Field-permissions UI — table `field_permissions` exists, per-role × per-field grid still missing
- [ ] **7.2** Saved views & saved searches — list page + share-with-team toggle (engine via `views` table from FEAT remaining-features-sentry)
- [ ] **7.3** Sidebar pinned-shortcuts server-side persistence (currently `localStorage` only)
- [ ] **7.4** Tags Manager extended to `deals.metadata.tags` and `tickets.metadata.tags`
- [ ] **7.5** Per-team admin-set sidebar override (admin chooses defaults for a team; users can still customise)
- [ ] **7.6** Email signature WYSIWYG (currently plain-text textarea)
- [ ] **7.7** `default_record_view` honoured on every list page (kanban / list / card / calendar)
- [ ] **7.8** `confirm_destructive` honoured across every destructive modal
- [ ] **7.9** Per-team prefs override layer (currently user > workspace; teams sit in between)

---

## Phase 8 — Super-admin operations  (`BULK_AND_SETTINGS_GAPS.md` §9 + `POSITIONING.md` gap log)

- [ ] **8.1** Settings-drift dashboard — diff each tenant against platform defaults
- [ ] **8.2** Bulk-operation live audit feed — already partial in `/superadmin/recent-activity`, surface as a dedicated page
- [ ] **8.3** OOO heatmap — number of users currently away across tenants
- [ ] **8.4** API-key entropy report — old / unused / over-scoped
- [ ] **8.5** Email/SMS provider key health — credentials missing, rate-limited, expired
- [ ] **8.6** Provider keys super-admin UI — SMTP / SendGrid / Twilio / **AI** (covered by Phase 4 secrets vault — needs the super-admin overlay)
- [ ] **8.7** White-label branding super-admin UI
- [ ] **8.8** Maintenance mode toggle + global feature flags
- [ ] **8.9** Rate-limits UI (per-tenant overrides)
- [ ] **8.10** Sentry / monitoring keys UI
- [ ] **8.11** Tenant-onboarding defaults (default trial length, default plan, default modules)
- [ ] **8.12** Tenant settings JSONB shape watcher — schema-drift alarm for unexpected keys

---

## Phase 9 — Channels & integrations  (`POSITIONING.md` gap log)

- [ ] **9.1** WhatsApp 2-way sync — inbound webhook + outbound API + activity emission (Telegram is already shipped as the template)
- [ ] **9.2** Stripe / accounting 2-way sync — webhook foundation only today; needs invoice/sub mirror back into NuCRM
- [ ] **9.3** Voice → CRM updates — call recording → transcription → activity → AI summary
- [ ] **9.4** LinkedIn / social ingest — contact enrichment + lead capture
- [ ] **9.5** Calendar 2-way sync (Google / Microsoft) — meetings already exist; bind external calendars
- [ ] **9.6** Slack notifications + slash-commands

---

## Phase 10 — Tech debt

- [ ] **10.1** Knock out the 63 lingering TS errors (every PR notes "unchanged from main")
- [ ] **10.2** Stabilise the 2 always-failing integration tests — `tests/integration/backup-integrity.test.ts` + `tests/integration/tenant-isolation.test.ts` need real Postgres + `tmp/backup-test-corrupt.sql`
- [ ] **10.3** AWS SDK version mismatch fix — `@aws-sdk/client-s3` vs `@aws-sdk/s3-request-presigner` (currently an `as any` cast)
- [ ] **10.4** Document `JWT_SECRET` requirement at build-time (not just at runtime) in `MAINTENANCE_UPDATE_GUIDE.md`
- [ ] **10.5** Remove the still-unused `STRIPE_PRICE_ID_MONTHLY/_YEARLY` placeholders if any references remain
- [ ] **10.6** Pre-existing eslint warnings on touched files (every PR notes them) — sweep
- [ ] **10.7** `tmp/` test fixtures folder — generate at test-runtime so backup tests pass in sandboxes without manual setup

---

## Build order rules

1. **One PR per phase sub-bullet** unless they're tightly coupled (e.g. 4.1 must land as a single PR because the gateway is useless without the secrets vault).
2. **Every PR** runs `tsc --noEmit`, `vitest run`, `JWT_SECRET=test npm run build` and reports the deltas.
3. **Every PR** updates this file's checkboxes when work lands.
4. **Never push to `main`** — branch + PR every time.
5. **No new `max-w-2xl` / `max-w-3xl`** wrappers (per `SETTINGS_LAYOUT_REDESIGN.md`).
6. **Every admin PATCH** re-checks `ctx.isAdmin` server-side. UI gating is never the only check.
7. **Every settings PATCH** uses `jsonb_set` so it never clobbers sibling keys.
8. **Every bulk endpoint** caps at 500 ids, validates against the active tenant, writes an audit-log row.
9. **Every workflow-stage change** runs through the `WORKFLOW.md` "How to extend this safely" checklist.
10. **Mobile-first** on every new page (`grid-cols-1 md:grid-cols-N`, sticky save bars, flex-wrap pills, ≥44px tap targets).

---

## Active queue

| # | Phase | Item | PR target |
|---|---|---|---|
| 1 | 4.1 | AI Gateway foundation | `feat/phase-4-ai-gateway-foundation` |
| 2 | 4.2 | Auto-Draft backend | `feat/phase-4-auto-draft` |
| 3 | 4.3 | Lead-scoring rules editor | `feat/phase-4-lead-scoring` |
| 4 | 4.4 | At-risk deals | `feat/phase-4-at-risk` |
| 5 | 4.5 | Summarize-anywhere | `feat/phase-4-summarize` |
| 6 | 5.3 | Unified comms-to-activities emission | `feat/phase-5-comms-activities` |
| 7 | 5.4 | Bulk-action-bar lifted to all tables | `feat/phase-5-bulk-bar-everywhere` |
| 8 | 6.3 | Bulk update custom field | `feat/phase-6-bulk-update-field` |
| 9 | 7.1 | Field-permissions UI | `feat/phase-7-field-permissions-ui` |
| 10 | 7.2 | Saved views list page | `feat/phase-7-saved-views` |
| 11 | 8.6/8.7/8.8 | Super-admin: provider keys + maintenance mode + white-label | `feat/phase-8-superadmin-ops` |
| 12 | 9.1 | WhatsApp 2-way | `feat/phase-9-whatsapp` |
| 13 | 10.1 | TS error sweep | `chore/phase-10-ts-cleanup` |

PR #1 (4.1) is the only one open right now. The rest stack behind it.
