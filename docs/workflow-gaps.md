# Workflow & Org-Model Gaps — Deep Audit

**Date:** 2026-07-27
**Scope:** Lead → team → project → product → reporting workflow. How records relate,
who can route/own/reclaim work, and where the product behaves as isolated silos
instead of one connected flow.

Every finding below is backed by a specific file:line. Severity reflects
data/business impact, not effort.

---

## Summary

The CRM has a large amount of **half-built** enterprise workflow. The tables,
engines, and columns exist, but they are not connected to the UI or to each
other. The missing spine is:

> **teams → team-scoped assignment → project/deal/product grouping → per-team reporting**

Fixing this is mostly _wiring_ and _a few additive tables_, not a rewrite.

| #     | Gap                                                                         | Severity | State      |
| ----- | --------------------------------------------------------------------------- | -------- | ---------- |
| WF-01 | Leads and Contacts are two parallel models; UI writes leads into `contacts` | CRITICAL | half-built |
| WF-02 | No product/service selection at lead intake (column exists, UI ignores it)  | HIGH     | half-built |
| WF-03 | Auto-assignment engine is orphaned — admin rules do nothing                 | CRITICAL | half-built |
| WF-04 | No "team" concept at all (no teams/departments table)                       | CRITICAL | missing    |
| WF-05 | Projects are an island — no link to leads/deals/contacts/companies          | HIGH     | missing    |
| WF-06 | Reporting has no per-rep or per-team performance                            | HIGH     | missing    |
| WF-07 | Admin has no org-level lead take-back / reassignment control                | MEDIUM   | partial    |
| WF-08 | UI wastes vertical space; flows are isolated, not linked                    | MEDIUM   | ux         |

---

## WF-01 — Leads and Contacts are two parallel models; the UI uses the wrong one

**Severity:** CRITICAL

There is a dedicated `leads` table (`drizzle/schema/crm.ts:132`) with pipeline
fields (`leadStatus`, `score`, `value`, `budget`), BANT fields
(`authorityLevel`, `needDescription`, `timeline`), a human-readable `leadOid`,
a `productId`, and a full assignment lifecycle.

But the primary **"Add Lead"** action in `components/tenant/leads-client.tsx`
POSTs to `/api/tenant/contacts` and reloads from `/api/tenant/contacts`. So the
main lead-capture UI writes into the `contacts` table (using `contacts.leadStatus`),
**bypassing the `leads` table entirely.**

**Impact:** two lead systems that disagree; pipeline reports read one, the UI
feeds the other; `leadOid`, lead scoring, and lead assignment history are never
populated from the main screen.

**Fix:** decide the source of truth (recommendation: dedicated `leads` table,
converting into a contact on qualification — the Salesforce/HubSpot model) and
route the UI accordingly.

---

## WF-02 — No product/service at lead intake, though the column already exists

**Severity:** HIGH

- `leads.productId` exists (`drizzle/schema/crm.ts:199`).
- The POST route accepts it (`app/api/tenant/leads/route.ts:272`).
- CSV import maps it (`app/api/tenant/leads/import/route.ts:63`).

But **no lead-creation form surfaces a product or service picker.** The quick-add
collects only name, email, phone, company, source, tags. You cannot record "this
lead is for Product X / Service Y" through the UI. There is also no
lead→deal→product carry-through: `deal_products` (`crm.ts:531`) has **zero
writers**.

**Fix:** add a product/service selector to lead + deal forms; carry the product
through lead→deal→quote→order→invoice so revenue is attributable to a product.

---

## WF-03 — The auto-assignment engine is orphaned; admin rules silently do nothing

**Severity:** CRITICAL

`lib/assignment.ts` implements `round_robin`, `territory`, `skill_based`, and
`weighted` routing. **Nothing imports it** (verified: no import of
`@/lib/assignment` anywhere outside its own tests).

`assignment_rules` (`drizzle/schema/assignment.ts:11`) has full admin CRUD
(`app/api/tenant/assignment-rules/route.ts`), so an org admin can create routing
rules — and they have **zero effect**. New leads default to
`assignedTo = creator` (`app/api/tenant/leads/route.ts:236`).

**Impact:** the "give leads to the sales team / marketing team automatically"
capability appears to exist in the admin UI but does nothing. `assignment_logs`
is never written.

**Fix:** invoke the engine on lead (and ticket/deal) creation; persist
`assignment_logs`; respect rule priority and `isActive`.

---

## WF-04 — There is no "team" concept anywhere

**Severity:** CRITICAL

No `teams` or `departments` table exists. `tenant_members` (`core.ts:129`) has a
single flat `roleSlug`. Yet `contacts.leadAccess` defaults to `'team'`
(`crm.ts:107`) — referencing a "team" scope that **has no backing table.**

**Impact:** you cannot create a Sales / Marketing / Support team, route leads to
a team, restrict a rep to their team's records, or report by team. This is the
single biggest structural gap behind the whole request.

**Fix:** add `teams` + `team_members` (with a `manager` role), make `leadAccess`
resolve against real teams, and thread `teamId` into assignment + reporting.

---

## WF-05 — Projects are an island

**Severity:** HIGH

`projects` (`drizzle/schema/projects.ts`) links only to `tasks` (via
`project_tasks`) and an `ownerId`. There is **no** `leadId` / `dealId` /
`contactId` / `companyId` relationship. "All leads related to this project" is
impossible today.

**Fix:** link projects to CRM records — either dedicated FK columns for the
common cases (company, primary deal) or the existing polymorphic `record_links`
table (`drizzle/schema/record-links.ts`) for any-to-any grouping.

---

## WF-06 — Reporting has no per-rep or per-team performance

**Severity:** HIGH

`app/api/tenant/reports/route.ts` joins users only on `tasks.assignedTo`. There
is no lead-conversion-by-rep, no pipeline-by-owner, no "Marketing sourced X,
Sales converted Y." The handoff history (`lead_assignments`) is written on every
reassignment but **never surfaced in any report.**

**Fix:** add per-rep and per-team dashboards: leads assigned/worked/converted,
pipeline value by owner, SLA compliance by team, and a handoff timeline.

---

## WF-07 — Admin has no org-level take-back / reassignment control

**Severity:** MEDIUM

`app/api/tenant/leads/[id]/assign/route.ts` and bulk
`app/api/tenant/leads/assign/route.ts` correctly reassign, write handoff
history, and notify. But:

- No admin flow to reclaim a departed rep's entire book of leads.
- No team-scoped reassignment ("team lead may reassign only within their team").
- Role permissions are a free-form JSONB blob (`roles.permissions`), so there is
  no structured notion of team-scoped authority.

**Fix:** admin "reassign all from user → user/team" action; team-scoped
permission checks layered on the assignment routes.

---

## WF-08 — UI wastes space and flows are isolated

**Severity:** MEDIUM (UX)

Detail pages show a single record with no inline panel of related records (a
lead's product, its company, its activities, its owner's team). Navigation
between related entities requires leaving the page. Layout density is loose —
large padding, single-column forms — so few features fit on screen.

**Fix:** denser layout grid; inline "related records" panels on detail pages
(lead → company → deals → project); consistent cross-entity navigation so the
product feels like one flow.

---

## Build order

1. **Phase A — wire what's already built (low risk):** route lead creation
   through the real `leads` table; product/service at intake; invoke
   `lib/assignment.ts` so admin rules route leads. _(WF-01, WF-02, WF-03)_
2. **Phase B — teams model:** `teams` + `team_members`, team-scoped
   `leadAccess`, admin team management UI. _(WF-04)_
3. **Phase C — grouping:** link projects/deals to leads/contacts/companies.
   _(WF-05)_
4. **Phase D — reporting:** per-rep and per-team dashboards; surface handoff
   history. _(WF-06, WF-07)_
5. **UI/UX pass:** density + inline related-record panels + cross-entity nav.
   _(WF-08)_

Each phase ships as its own PR off `origin/main`. None are stacked on the
still-open #753.
