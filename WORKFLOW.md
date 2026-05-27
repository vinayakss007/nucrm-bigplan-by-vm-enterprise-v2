# NuCRM End-to-End Customer Workflow

This is the canonical map of how a customer flows through the system, the
files that implement each step, and the gaps still to close. Update it
whenever you change a workflow stage so AI sessions stay aligned with the
existing UI/UX.

---

## Stages

```
                   AI scoring + enrichment + draft email + suggest follow-up
                                          │
                                          ▼
[ Form / Import / Manual ]   ──►   [ LEAD ]   ──►   [ CONTACT ]   ──►   [ DEAL ]   ──►   [ QUOTE / ORDER / INVOICE / SUBSCRIPTION / CONTRACT ]
        ▲                              │              ▲                    ▲                                    │
        │                              │              │                    │                                    ▼
   Industry templates          Discovery (BANT)   Activity timeline   Products / services                  Revenue + ops
   drive intake form           captured here      (manual + system)   tied via line items
```

---

## 1. Lead

| Concern | Path |
|---|---|
| Schema | `drizzle/schema/crm.ts` → `leads` table (has `budget`, `budgetCurrency`, `authorityLevel`, `needDescription`, `timeline`, `timelineTargetDate`, `companyIndustry`, `value` for BANT) |
| List API | `app/api/tenant/leads/route.ts` |
| Detail API | `app/api/tenant/leads/[id]/route.ts` (GET + PATCH + DELETE) |
| Bulk API | `app/api/tenant/leads/bulk/route.ts` |
| Convert API | `app/api/tenant/leads/[id]/convert/route.ts` |
| Import API | `app/api/tenant/leads/import/route.ts` |
| List UI | `app/tenant/leads/page.tsx` + `components/tenant/leads-client.tsx` |
| Detail UI | `app/tenant/leads/[id]/page.tsx` + `components/tenant/lead-detail-client.tsx` |
| AI hooks | `app/api/tenant/ai/route.ts` action `score_lead` + `app/api/tenant/ai/score/route.ts` |

**Discovery (BANT) capture**: `lead-detail-client.tsx` exposes an inline editor for
`budget`, `budget_currency`, `authority_level`, `need_description`, `timeline`,
`timeline_target_date`. This is **the** place reps record "what does the client want".
The PATCH route accepts all of these fields.

---

## 2. Contact

| Concern | Path |
|---|---|
| Schema | `drizzle/schema/crm.ts` → `contacts` table |
| List API | `app/api/tenant/contacts/route.ts` |
| Detail API | `app/api/tenant/contacts/[id]/route.ts` |
| Bulk API | `app/api/tenant/contacts/bulk/route.ts` (`action`: `delete`/`tag`/`untag`/`assign`/`status`) |
| Timeline API | `app/api/tenant/contacts/[id]/timeline/route.ts` (reads `activities` table) |
| List UI | `app/tenant/contacts/page.tsx` + `components/tenant/contacts-client.tsx` |
| Detail UI | `app/tenant/contacts/[id]/page.tsx` + `components/tenant/contact-detail-client.tsx` |
| AI hooks | `score_contact` (POST `/api/tenant/ai/score`), `enrich_contact`, `suggest_followup`, `draft_email` |

**Activity tab on the contact detail page** shows two stacked feeds:

1. **Manual log** — note / call / email / meeting entries the rep types in.
2. **System events** (`<ContactTimeline contactId={...} />`) — auto-tracked
   email opens/clicks, calls logged, meetings scheduled, deals created/won/lost,
   lifecycle stage changes, form submissions, automations fired, webhooks sent,
   contact status changes, contact merges.

The contact detail page is the **single pane of glass** for a customer. Everything
written below this section must surface here.

---

## 3. Lead → Contact conversion (the critical handoff)

`POST /api/tenant/leads/[id]/convert` in `app/api/tenant/leads/[id]/convert/route.ts`:

1. Resolves or creates the company.
2. Dedupes contact by email (merges into existing contact if present).
3. Marks the lead `is_converted=true`, `lead_status='converted'`, sets
   `converted_contact_id`, logs a `lead_activities` row.
4. Optionally creates a deal in the requested or default pipeline+stage,
   pulling the value from the request body or falling back to `lead.value`.
5. **Carries discovery forward**: any of `budget`/`authorityLevel`/
   `needDescription`/`timeline`/`timelineTargetDate`/`companyIndustry`/`value`
   that are populated on the lead are:
   - appended as a "Discovery (carried over from lead)" block to the contact's
     `notes` (or merged into existing notes for the merge path);
   - written to `contact.metadata.discovery` and `contact.metadata.source_lead_id`;
   - written to `deal.metadata.discovery` and `deal.metadata.source_lead_id`
     (when a deal is created).
6. Logs an `activities` row of type `deal_created` so the new deal shows up
   in the contact timeline immediately.
7. Fires `contact.created` webhook with `lead_id` for traceability.
8. Notifies the assignee.

**Rule**: never add a "what does the client want" field on the lead without
also wiring it through this convert route. Otherwise the discovery dies at
conversion.

---

## 4. Communication trail

All channels write to `activities` (`drizzle/schema/infra.ts`) with a polymorphic
`entityType`/`entityId` plus convenience `contactId`/`dealId`/`companyId` columns,
an `eventType` string, and a `metadata` JSON blob.

| Channel | Schema | API | UI |
|---|---|---|---|
| Email send | `email_logs` (`drizzle/schema/comm.ts`) | `app/api/tenant/email/*` | `app/tenant/email-templates`, `app/tenant/sequences` |
| Email open/click | `email_tracking` (`drizzle/schema/email-tracking.ts`) | `/api/tenant/email-tracking/*` | timeline event types `email_opened`/`email_clicked` |
| Calls | `calls` (`drizzle/schema/comm.ts`) | `app/api/tenant/calls/route.ts` | `app/tenant/calls/page.tsx` |
| SMS / WhatsApp | `sms_logs` (`drizzle/schema/sms.ts`) | `app/api/tenant/sms/*`, `app/api/tenant/whatsapp/*` | `app/tenant/sms` |
| Live chat | `chat_sessions`, `chat_messages` (`drizzle/schema/chat.ts`) — sessions can convert to leads | `app/api/tenant/chat/*` | `app/tenant/chat` |
| Meetings | `meetings` (`drizzle/schema/crm.ts`) | `app/api/tenant/meetings/*` | embedded on contact detail |
| Notes | `activities` rows with `eventType='note_added'` | inline `POST /api/tenant/contacts/[id]/notes` | contact-detail-client manual log |

Each channel's writer **must** also insert an `activities` row so it appears
in `<ContactTimeline />`. The event type strings used by the UI are documented
in `components/tenant/contact-timeline.tsx` `EVENT_TYPE_CONFIG`.

---

## 5. Requirements / "what does the client want"

Captured in three layers. From most structured to least:

1. **BANT on the lead** — `lead.budget` / `authority_level` / `need_description` /
   `timeline` / `timeline_target_date`. Edited inline on the lead detail page.
2. **Discovery on the contact + deal** (post-conversion) — copied into
   `contact.metadata.discovery`, `deal.metadata.discovery`, and the contact's
   notes summary. Source of truth for "what the client wants" once the lead
   becomes a contact.
3. **Custom fields** — `app/tenant/settings/custom-fields/page.tsx` lets a
   tenant define industry-specific fields (property type, role, condition,
   loan amount, etc.) that are stored in `customFields` JSON on
   leads / contacts / deals.

When you add a new structured requirements field at the lead level, also:
- accept it in the leads PATCH route mapper;
- carry it forward in the convert route's `discovery` block;
- surface it on `contact-detail-client.tsx` (sidebar or activity tab).

---

## 6. Products & Services

| Concern | Path |
|---|---|
| Product registry (per-industry entry points + sidebar + dashboard cards) | `lib/products/registry.ts` |
| Product entry pages | `app/tenant/products/*` |
| Industry templates (which products+modules a tenant gets) | `app/api/tenant/industry-templates/*`, `drizzle/schema/templates.ts` |
| Catalog (services / SKUs) | `app/api/tenant/services/*`, `app/tenant/services` |
| Quote line items | `app/api/tenant/quotes/[id]/route.ts` |
| Order line items | `app/api/tenant/orders/[id]/route.ts` |
| Subscriptions | `app/api/tenant/subscriptions/[id]/route.ts` |

**How a product/service connects to a client**: through deals → quotes → orders →
invoices → subscriptions. Each line item carries a `service_id` (or freeform
`description`) and a `quantity` × `unit_price`. The contact detail page's
"Billing" tab aggregates all five entity types tied to that contact.

The 8 products in `PRODUCT_REGISTRY` (proposal-generator, ai-sales-crm,
whatsapp-automation, helpdesk, recruitment-ats, real-estate-crm, ecommerce-crm,
invoice-billing) are presentation overlays — they bind to the same underlying
CRM tables but expose a curated sidebar, dashboard cards, and quick actions
matching that vertical.

---

## 7. Templates

| Concern | Path |
|---|---|
| Industry templates schema | `drizzle/schema/templates.ts` |
| Template registry (built-in 13 industries) | `lib/industry-templates/*` |
| Apply on signup | `app/api/tenant/onboarding/route.ts` |
| Custom templates (super admin) | `app/api/superadmin/templates/*` + `app/superadmin/templates/page.tsx` |
| Tenant-side onboarding wizard | `app/tenant/onboarding/page.tsx` |

A template defines:
- which **modules** to install (`tenantModules` table);
- the default **pipeline + stages**;
- the default **custom fields** for leads/contacts/deals;
- the default **email/SMS templates** and **automation templates**;
- the **product entry** (one of `PRODUCT_REGISTRY` keys).

---

## 8. AI Gateway

| Endpoint | Actions |
|---|---|
| `POST /api/tenant/ai` | `draft_email`, `score_lead`, `predict_deal`, `enrich_contact`, `suggest_followup` |
| `POST /api/tenant/ai/score` | persists a contact score row |
| `GET /api/tenant/ai/score` | reads contact scores |
| `POST /api/tenant/ai/email-draft` | quick-action email generator |
| `POST /api/tenant/ai/insights` | dashboard / forecast insights |

Implementation in `app/api/tenant/ai/route.ts`. Token tracking + rate limit in
`lib/ai/common.ts`. AI usage is gated on the `ai-assistant` module being
installed for the tenant.

---

## Tracked workflow gaps (intentional next-iteration items)

These are **not** bugs to be fixed silently — they are documented gaps so the
team can prioritise and so AI sessions don't accidentally regress them.

1. **AI gateway is Anthropic-only** — `app/api/tenant/ai/route.ts` calls Claude
   directly. The product policy is "single AI gateway supporting OpenAI,
   Anthropic, Groq, Ollama, any OpenAI-compatible API with model switching,
   streaming, and multi-provider fallback". Refactor target: extract a
   provider-agnostic `lib/ai/gateway.ts` that picks the provider per tenant
   setting.
2. **Industry templates do not yet drive the lead intake form** — different
   verticals need different fields (property type, role, condition, loan
   amount). The `customFields` plumbing exists but the public form builder
   doesn't render them by template. Target: a per-template form schema in
   `lib/industry-templates/*` that renders into the public form pages and
   into the inline lead "Add" modal.
3. **Product entry pages don't yet expose a "Clients" view scoped to the
   product's main pipeline** — the registry declares
   `sidebarItems: [{ label: 'Clients', href: '/products/...' }]` but each
   product currently shows the same global contacts list. Target: a
   `pipeline_id` / `lifecycle_stage` filter applied per product.
4. **Communication channels write to channel-specific tables but not always
   to the unified `activities` table** — for example new SMS / WhatsApp
   sends should always emit an `activities` row of `eventType='sms_sent'`
   (and a corresponding `EVENT_TYPE_CONFIG` entry in `contact-timeline.tsx`)
   so they show in the contact's system-events feed.
5. **Bulk action bar pattern lives only on contacts** — `companies-data-table`,
   `deals-data-table`, `tasks-data-table` and `users-data-table` enable row
   selection but don't render `BulkActionBar`. Target: lift the contacts
   pattern into a shared hook + render `BulkActionBar` on each table.

---

## How to extend this safely

Whenever you touch any workflow stage, run through this checklist:

- [ ] Schema column added with a Drizzle migration?
- [ ] Detail-route GET returns it?
- [ ] Detail-route PATCH accepts it (snake_case → camelCase mapping)?
- [ ] Lead-side capture UI surfaces it?
- [ ] **Lead convert route copies it forward** to contact + deal metadata?
- [ ] Contact detail page renders it (sidebar or activity tab)?
- [ ] An `activities` row is emitted on change so the contact timeline
      reflects it?
- [ ] An entry in `EVENT_TYPE_CONFIG` (`contact-timeline.tsx`) if it's a
      new event type?
- [ ] AI gateway sees it (passed in the prompt context for `score_lead` /
      `score_contact` / `predict_deal` / `suggest_followup`)?
- [ ] Webhook payload includes it?
- [ ] Custom-fields migration path documented for tenants who already
      defined a same-purpose custom field?
