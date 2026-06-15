# NuCRM — Competitive Positioning

> How we play differently from HubSpot / Zoho / Salesforce / Pipedrive,
> mapped to the CRM market trends and the failure modes that kill CRMs.
> Living document — keep in sync with `MASTER_PLAN.md`, learnings, and the
> code that ships.

## TL;DR — Where we win

1. **AI as the engine, not a paid bolt-on.** Hybrid AI gateway with OpenAI / Anthropic / Groq / Ollama and multi-provider fallback. Every AI output is user-editable. The product is AI-powered at its core (per learnings).
2. **Multi-tenant operations at 100-user scale.** Bulk Transfer, OOO with auto-reassign, 5 bulk-action APIs, granular admin policy, super-admin Adoption & Drift dashboards.
3. **Settings packed but organised.** 36+ pages across Personal / Workspace / Admin scopes with status badges, search and breadcrumb. Mobile-first.
4. **LeadWorks loop.** ABetWorks lead discovery → CRM → conversion in one product. Vertical templates (industry pre-sets) make verticalising a config exercise, not a fork.

---

## Trend × incumbent matrix

| Trend | HubSpot | Zoho | Salesforce | Pipedrive | **NuCRM** |
|---|---|---|---|---|---|
| **AI as actor** — drafts, at-risk, next-best-call | Breeze AI add-ons, paywalled tier | Zia: uneven across modules | Einstein: $$$, needs DataCloud | Smart Docs / suggestions, light | **Hybrid AI gateway core** — OpenAI / Anthropic / Groq / Ollama, multi-provider fallback. Lead scoring + automation engine + AI-summary plumbing already in `lib/ai/`. **Differentiator:** AI is the engine, not a feature. |
| **Unified 360 view** | Strong in-suite, weak external email | Good in Zoho One; cross-suite shines | Best via DataCloud, 18-month impl | Limited — sales-only by design | **Contacts × Companies × Deals × Tasks × Tickets × Activities × Calendar × Email × Chat × Telegram** in one tenant DB with tag manager, custom fields, picklists. Coming: social ingest, billing-source, full email threading. |
| **Vertical-specific CRM** | Generic; "industry pages" = marketing | Same | Same — industry clouds cost extra | Generic | **Industry templates + picklists + custom fields + pipelines per workspace.** Vertical = config preset, not a fork. LeadWorks angle: ABetWorks consulting closes the loop from discovery to conversion. |
| **Conversational / voice** | Limited mobile UX | Cliq + Zia voice, Zoho-only | Slack + Einstein Voice, paywalled | Mobile-decent | **Telegram bot per user shipped.** WhatsApp on roadmap. Voice not yet. ⌘K palette + g/n keyboard sequences make desktop low-friction. |

## Adoption hurdles × our defenses

CRMs fail because of UX, integrations, data quality, price pressure and compliance. Each one we counter with concrete shipped features:

| Hurdle | Why it kills CRMs | **Our defense** |
|---|---|---|
| **Adoption / UX** | Salespeople hate forms — bad UX = empty database | Bulk ops on every record (tag, assign, transfer, stage, complete, due) so reps never open 50 records one by one. Font size · density · accent · reduce motion · keyboard shortcuts (⌘K + g·d / n·c sequences) · sticky filters · auto-save drafts. Out-of-office auto-reassign so work doesn't stall. Workspace User Defaults so admins set the standard while users override. |
| **Integration complexity** | Every SME's stack is different | Webhooks + API keys + integrations page + plugin/module system + per-tenant feature flags. Bulk Transfer flow built for the migration-in scenario (someone just left, reassign 1,200 records to Bob in 3 clicks). |
| **Data quality** | Bad data → broken AI → lost trust | Tags Manager (rename / merge / delete in one SQL across leads-contacts-companies). Contact merge modal. Custom fields. Field permissions. Picklists (so "loss reason" is a controlled vocabulary not free text). Soft delete + Trash + audit log. RBAC. |
| **Competing against free / cheap** | HubSpot Free / Zoho Bigin | (1) **AI-as-engine** (not a $$$ add-on). (2) **100-user multi-tenant ops** — bulk transfer, OOO, granular settings, super-admin adoption/drift dashboards — HubSpot Pro doesn't expose this. (3) **LeadWorks loop** — discovery to conversion in one product. |
| **Privacy / compliance** | GDPR / NDPR / data residency / IT will block | Login Policy (password rules, 2FA enforcement, IP allowlist, allowed/blocked email domains, session caps), field permissions, audit log with bulk-op + settings-change feeds, compliance page with retention, backup & restore, per-tenant settings audit for super-admin oversight. Multi-tenant isolation enforced at every PATCH endpoint. |

## Concrete proof — what's already in the codebase

| Differentiator | Where it lives |
|---|---|
| Hybrid AI gateway, OpenAI-compatible | `lib/ai/` — multi-provider fallback per the learnings |
| Bulk operations across 5 entities | `app/api/tenant/{contacts,leads,companies,deals,tasks}/bulk/route.ts` |
| Bulk Transfer (offboarding) | `app/api/tenant/admin/bulk-transfer/route.ts` + `/tenant/settings/bulk-transfer` |
| Out-of-office with auto-reassign | `app/api/user/out-of-office/route.ts` + `/tenant/settings/out-of-office` |
| Granular per-user UI prefs | `app/api/user/preferences/route.ts` + `<UserPreferencesApplier />` (font size, accent, density, motion) |
| Workspace User Defaults | `app/api/tenant/admin/user-defaults/route.ts` + `/tenant/settings/user-defaults` |
| Login & Security Policy | `app/api/tenant/admin/login-policy/route.ts` + `/tenant/settings/login-policy` |
| Tags Manager + Picklists | `app/api/tenant/admin/{tags,picklists}/route.ts` + matching pages |
| Localization (timezone, fiscal, holidays, business hours) | `app/api/tenant/admin/localization/route.ts` + `/tenant/settings/localization` |
| Notification matrix (event × channel) | `app/api/tenant/notifications/matrix/route.ts` + `/tenant/settings/notifications` |
| Settings index = control center (3-col scope grid + status badges) | `app/tenant/settings/page.tsx` + `/api/tenant/settings-status` |
| Super-admin Adoption & Drift | `/superadmin/adoption` + `/api/superadmin/adoption` + `/api/superadmin/recent-activity` |
| Per-tenant settings audit | `/superadmin/tenants/[id]/settings` + `/api/superadmin/tenant-settings` |
| Audit log with bulk-op + settings-change cross-tenant feeds | `/api/superadmin/recent-activity` |

## Gap log — what we still need to keep up with the trend

| Gap | Status | Priority |
|---|---|---|
| AI auto-draft follow-up emails | Gateway exists, page wiring not yet | High — top demo win |
| At-risk deal flagging in pipeline | Metrics present, no model card | High |
| Next-best-action / lead prioritisation | Scoring code exists, surface UI not | High |
| WhatsApp inbound + outbound | Telegram shipped, WhatsApp pending | High in Africa / India / LatAm |
| Voice → CRM updates | Not started | Medium — emerging differentiator |
| Stripe / accounting 2-way sync | Webhooks foundation only | High — most-asked SME ask |
| LinkedIn / social ingest | Not started | Medium — part of 360-view promise |
| Saved views / saved searches | Not started | Medium — productivity baseline |
| Bulk update custom field value | Not started | Medium — closes the bulk-ops set |
| Bulk add-to-sequence / list / segment | Not started | Medium — sales adoption |
| Field permissions UI (DB exists) | API yes, UI no | Medium — compliance demo |
| Lead scoring rules editor UI | Engine yes, editor no | Medium |
| Maintenance mode + global feature flags (super-admin) | Not started | Medium — operational hygiene |
| AI provider keys UI for super-admin | Backend yes, UI no | Medium — onboarding self-serve |

## How we use this doc

1. **Sales / proposal calls** — the trend matrix is a one-slide answer to *"why not HubSpot?"*.
2. **Roadmap planning** — the gap log is the queue. Top of the list is what closes the deal in the next demo.
3. **Engineering reviews** — every PR description should reference whether it advances a row in the gap log or strengthens a row in the proof table.
4. **Onboarding new team members** — read this before `MASTER_PLAN.md` to understand what game we're playing.

---

## AI is **one place**, not "this AI thing, that AI thing"

A common failure mode of AI features in CRMs is sprinkling them across the
product — drafting in email, scoring on the lead page, summaries on the
contact panel, providers buried in admin settings. Users can't find them and
admins can't govern them.

We deliberately consolidate. Every AI capability lives under `/tenant/ai` with
a shared shell, and admin-side configuration lives under one settings group.

| Capability | Page | Admin config | Depends on |
|---|---|---|---|
| AI Hub (overview + quick actions) | `/tenant/ai` | — | provider |
| Auto-Draft (emails, replies, notes) | `/tenant/ai/draft` | `/tenant/settings/ai-templates` | provider · email |
| Lead Scoring | `/tenant/ai/lead-scoring` | `/tenant/settings/lead-scoring` | provider · leads · picklists |
| At-Risk Deals | `/tenant/ai/at-risk` | `/tenant/settings/at-risk-rules` | provider · deals · stages |
| Summarize | `/tenant/ai/summarize` | — | provider · activities |
| Activity Log | `/tenant/ai/activity` | `/tenant/settings/ai-activity` | provider |
| Providers | — | `/tenant/settings/ai-providers` | — |

Each capability page declares its dependencies right on the screen, so the
user always sees *why* something isn't ready. No more hunting through three
settings pages to make a single feature work.

## Per-user views (not just per-role)

CRMs add features non-stop. The result on most products is a sidebar with 40
items and a salesperson scrolling past 35 they don't use. We solved this two
ways:

1. **Six role presets** in Preferences > Sidebar — Sales Rep, SDR/BDR,
   Customer Success, Manager, Admin, Minimal — flip many toggles at once to
   match a persona.
2. **Per-item hide toggle** — every nav item has its own switch. Persisted
   to `users.metadata.prefs.hidden_nav_items[]`, applied live by the same
   `<UserPreferencesApplier />` that handles font size & theme.

Pinned items override hiding (so a hidden item the user pinned still appears
at the top of the rail).

## Channels live together

Telegram was sitting in personal **Communications** alongside Notifications
and OOO — wrong neighbourhood. Channels (Telegram, Email, future WhatsApp /
SMS / Slack) belong in **Integrations**. That's where they are now:

- Personal **My Connections** group — per-user channel hooks (Telegram bot,
  Slack DM, Calendar OAuth)
- Workspace **Channels & Customer-Facing** — Email Sending, Customer Portal
- Admin **Integrations & Developer** — Connected apps, Webhooks

## Updated gap log

| Gap | Status | Priority |
|---|---|---|
| AI auto-draft email — UI shell live | Page exists w/ shell + dep tracker | High — wire backend |
| At-risk deal flagging — UI shell + 14d default | Page + dep tracker shipped | High |
| Lead scoring — UI shell + dep tracker | Page + dep tracker shipped | High |
| AI activity log — schema TODO | UI ready, table not | High |
| WhatsApp inbound + outbound | Foundation only | High in Africa / India / LatAm |
| Voice → CRM updates | Not started | Medium |
| Stripe / accounting 2-way sync | Webhooks foundation only | High |
| LinkedIn / social ingest | Not started | Medium |
| Saved views / saved searches | Not started | Medium |
| Bulk update custom field value | Not started | Medium |
| Bulk add-to-sequence / list / segment | Not started | Medium |
| Field permissions UI (DB exists) | Not started | Medium |
| Maintenance mode + global feature flags | Not started | Medium |
| AI provider keys — secrets vault | Stored in jsonb (presence flag only); needs proper secrets table | High — security |
| Per-team / per-role sidebar override (admin sets) | User-level done; team-level not | Medium |
