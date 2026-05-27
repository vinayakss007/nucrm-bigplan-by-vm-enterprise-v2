# Bulk Operations + Granular Settings + Sidebar — Gap Analysis & Rearrangement Strategy

> Audit of `nucrm-bigplan-by-vm-enterprise-v2` for a multi-tenant CRM serving 100s of users per workspace. The AI-generated layout missed a lot of the day-to-day muscle that a real CRM team needs (bulk ops, transfer-of-ownership, granular settings). This doc lists every gap and the plan to close it.

---

## 1. Sidebar — what's wrong now

File: `components/tenant/layout/sidebar.tsx`

| Problem | Current state |
|---|---|
| **Mixed concerns in one bucket** | `TOOLS_NAV` has Leads, Companies, Services, Automation, Forms, Integrations, Analytics, Modules, Notifications, API Docs, Trash — these are 4 different categories crammed together |
| **No inline search** | Footer says "⌘K Quick search" but the sidebar itself has no filter input. With 30+ links, users scroll & guess. |
| **Leads buried in "Tools"** | Leads is core CRM, should be Primary |
| **Companies buried in "Tools"** | Same — Companies is core |
| **Settings has 19 sub-links flat** | One collapse with 3 group headers, but no scope (User vs Org vs Admin) |
| **No pinned/favorites** | Users have no way to surface their own most-used pages |
| **No role-aware compaction** | Non-admin users still see admin items (filtered, but the chrome stays the same) |
| **Settings `SETTINGS_GROUPS` and `settings-nav.tsx` duplicate the list** | Two sources of truth, drift risk |

### Rearrangement strategy

```
┌─ Sidebar (220px) ─────────────────────┐
│ [Workspace logo + name]               │
│ ┌───────────────────────────────────┐ │
│ │ 🔍 Filter nav…             ⌘K     │ │  ← inline filter
│ └───────────────────────────────────┘ │
│                                       │
│ ★ PINNED              (user-editable) │
│   ◦ Dashboard                         │
│   ◦ My Tasks                          │
│                                       │
│ ▾ WORK                                │
│   ◦ Dashboard      ⌘1                 │
│   ◦ Leads          ⌘2  ← promoted     │
│   ◦ Contacts       ⌘3                 │
│   ◦ Companies      ⌘4  ← promoted     │
│   ◦ Deals          ⌘5                 │
│   ◦ Tasks          ⌘6                 │
│   ◦ Calendar                          │
│                                       │
│ ▾ SALES                               │
│   ◦ Quotes / Orders / Contracts       │
│   ◦ Invoices / Subscriptions          │
│   ◦ Products / Services               │
│                                       │
│ ▾ SUPPORT & KNOWLEDGE                 │
│   ◦ Helpdesk / Tickets                │
│   ◦ Knowledge Base                    │
│   ◦ Customer Portal                   │
│                                       │
│ ▾ AUTOMATE                            │
│   ◦ Sequences / Workflows / Forms     │
│   ◦ Automation                        │
│                                       │
│ ▾ ANALYZE                             │
│   ◦ Reports / Analytics               │
│   ◦ Leaderboards                      │
│                                       │
│ ▾ DATA & TRASH                        │
│   ◦ Import / Export Center  (NEW)     │
│   ◦ Bulk Tools              (NEW)     │
│   ◦ Trash                             │
│                                       │
│ ▾ DEVELOPER                           │
│   ◦ API Docs / Webhooks               │
│   ◦ Integrations / Modules / Plugins  │
│                                       │
│ ▾ ⚙ SETTINGS                          │
│   (collapsed; full nav shown on       │
│   /tenant/settings layout sub-rail)   │
│                                       │
│ [Crown] Super Admin (if isSuperAdmin) │
│ [User chip + role]                    │
└───────────────────────────────────────┘
```

**Filter behaviour:** typing in the search box filters every link in every collapsed group simultaneously, auto-expands groups that have a hit, persists last query for the session.

---

## 2. Bulk operations — what's covered vs missing

### What exists today

| Resource | API | UI wired |
|---|---|---|
| Contacts | `app/api/tenant/contacts/bulk` — tag, untag, assign, status, delete, export, do_not_contact | ✅ `contacts-data-table.tsx` |
| Leads | `app/api/tenant/leads/bulk` — status, assign, tag, delete, convert | ⚠ `leads-client-new.tsx` only exposes Delete + Qualify in toolbar |
| Companies | `app/api/tenant/companies/bulk` — assign, status, delete, tag | ❌ table has row-selection but **no bulk-action UI** |
| Deals | — | ❌ no API, table has selection but **no bulk action UI** |
| Tasks | — | ❌ no API, table has selection but **no bulk action UI** |

### Bulk operations needed for a 100-user, multi-tenant CRM

#### CRM records — per resource

| Operation | Contacts | Leads | Companies | Deals | Tasks |
|---|---|---|---|---|---|
| Bulk delete (soft) | ✅ | ✅ | ✅ | **add** | **add** |
| Bulk assign owner | ✅ | ✅ | ✅ | **add** | **add** |
| Bulk add tag | ✅ | ✅ | ✅ | **add** | — |
| Bulk remove tag | ✅ | — | — | — | — |
| Bulk change status / stage | ✅ | ✅ | ✅ | **add** (stage) | **add** (priority) |
| Bulk export CSV | ✅ | partial | **add** | **add** | **add** |
| Bulk add to sequence | ❌ | ❌ | n/a | n/a | n/a |
| Bulk add to list / segment | ❌ | ❌ | ❌ | ❌ | n/a |
| Bulk add note / activity | ❌ | ❌ | ❌ | ❌ | ❌ |
| Bulk update custom field | ❌ | ❌ | ❌ | ❌ | ❌ |
| Bulk merge duplicates | partial (modal exists) | ❌ | ❌ | n/a | n/a |
| Bulk archive / restore | ❌ | ❌ | ❌ | ❌ | ❌ |
| Bulk close-won / close-lost (with reason) | n/a | n/a | n/a | **add** | n/a |
| Bulk reschedule due date | n/a | n/a | n/a | n/a | **add** |
| Bulk mark complete | n/a | n/a | n/a | n/a | **add** |

#### Cross-resource (org-admin level) — currently zero

1. **Bulk transfer ownership** — the single most-requested ops feature when someone leaves the team. "Take everything owned by Alice and reassign to Bob (optionally only records in stage X / created after Y)." ⭐
2. **Bulk reassign by rule** — round-robin, by territory, by load-balance.
3. **Bulk invite users** — paste emails / CSV, assign role, optionally team.
4. **Bulk role change** — select N members, change role.
5. **Bulk deactivate / reactivate users**.
6. **Bulk force re-login** — invalidate sessions for selected users.
7. **Bulk 2FA enforcement** — flip a flag for selected users.
8. **Bulk territory assignment**.
9. **Bulk email** (with template + merge tags). Schema partly there; no UI.
10. **Bulk SMS / WhatsApp**.

### Phase plan (this PR)

- **Add** `app/api/tenant/deals/bulk` — assign, stage, delete, tag, close (with reason).
- **Add** `app/api/tenant/tasks/bulk` — assign, priority, complete, due, delete.
- **Wire** bulk-action toolbar via existing `<DataTable bulkActions>` API into deals, companies, tasks tables.
- **Add** Bulk Transfer page at `app/tenant/settings/bulk-transfer` with companion API.

Items not in this PR are listed as TODO at the bottom of this doc.

---

## 3. Settings — what we have, what's missing

The product has 29 settings directories under `app/tenant/settings/` and 1 superadmin settings page. They're flat, mixed scopes, and missing many of the granular toggles real teams expect.

### 3.1 Current settings (existing)

```
profile · general · team · billing · admin
security · roles · sessions · api-keys · audit
email · integrations · pipelines · webhooks · custom-fields
industry-templates · portal · backup · telegram
assignment-rules · branding · compliance · currency
hierarchy · rbac · sla · sso · tax · territories
```

### 3.2 Three scopes — user vs org vs super

The biggest fix is making the **scope** of each setting obvious. Today admin and personal items are mixed in a flat tab strip.

```
┌───────────────────────────────────────────────────────────┐
│ Settings sub-rail (left, 220px)        │  Page content     │
├────────────────────────────────────────┤                   │
│ 🔍 Filter…                             │                   │
│                                        │                   │
│ ◯ PERSONAL  (just me)                  │                   │
│   • Profile                            │                   │
│   • Preferences         (NEW)          │                   │
│   • Notifications       (NEW)          │                   │
│   • Out of Office       (NEW)          │                   │
│   • Email Signature     (NEW)          │                   │
│   • Sessions & Devices                 │                   │
│   • My API tokens       (NEW)          │                   │
│   • Connected Apps                     │                   │
│   • Telegram                           │                   │
│   • Security & 2FA                     │                   │
│                                        │                   │
│ ◯ WORKSPACE  (everyone here)           │                   │
│   • Workspace info / branding          │                   │
│   • Localization        (NEW)          │                   │
│   • Business Hours      (NEW)          │                   │
│   • Holidays            (NEW)          │                   │
│   • Currency / Tax                     │                   │
│   • Team & Invites                     │                   │
│   • Pipelines                          │                   │
│   • Custom Fields                      │                   │
│   • Picklists           (NEW)          │                   │
│   • Tags Manager        (NEW)          │                   │
│   • Industry Templates                 │                   │
│   • Customer Portal                    │                   │
│                                        │                   │
│ ◯ ADMIN  (admins only)                 │                   │
│   • Org overview                       │                   │
│   • Billing & Plan                     │                   │
│   • Roles & Permissions                │                   │
│   • Field Permissions   (NEW UI)       │                   │
│   • Login & Security    (NEW)          │                   │
│   • SSO / SAML                         │                   │
│   • Hierarchy / Territories            │                   │
│   • Assignment Rules                   │                   │
│   • SLA Policies                       │                   │
│   • Email (org sending)                │                   │
│   • Webhooks / API keys                │                   │
│   • Integrations                       │                   │
│   • Audit Log                          │                   │
│   • Compliance / Retention             │                   │
│   • Backup                             │                   │
│   • Bulk Transfer       (NEW)          │                   │
│   • Modules / Plugins                  │                   │
└────────────────────────────────────────┴───────────────────┘
```

### 3.3 Granular settings missing — full list

#### Personal (per user)

| Setting | Status | Notes |
|---|---|---|
| Locale (`users.locale`) | DB ✅ / UI ❌ | exists in schema, no UI |
| Theme (`users.theme`) | DB ✅ / UI partial | currently only header toggle, no persisted user pref |
| UI density (compact / cozy / comfy) | ❌ | new `users.metadata.ui_density` |
| Date format / Time format / Week start | ❌ | new keys in `users.metadata` |
| Default landing page | ❌ | new key |
| Notification matrix (event × channel) | partial | profile page has 3 toggles; need full grid |
| Out-of-Office (away dates + auto-reassign target) | ❌ | new |
| Email signature | ❌ | new |
| Personal API tokens (separate from org keys) | ❌ | new |
| Saved views / saved searches | ❌ | larger feature |
| Pinned sidebar items | ❌ | new |

#### Workspace (everyone)

| Setting | Status | Notes |
|---|---|---|
| Workspace name / logo / favicon / color | ✅ | |
| Subdomain / custom domain | ✅ | |
| Default timezone / currency | partial | only in `tenants.settings` JSON |
| Fiscal year start | ❌ | |
| Week start / weekend days | ❌ | |
| Business hours | ❌ | |
| Holiday calendar | ❌ | |
| Number / address format | ❌ | |
| Picklists: lead sources, loss reasons, win reasons, activity types, deal types, industries | ❌ | currently hard-coded in components |
| Tag manager (rename / merge / delete) | ❌ | tags exist on every entity, no admin UI |
| Lead scoring rules | ❌ | scoring runs but no admin-editable rules |
| Default views per role | ❌ | |

#### Admin (org-level)

| Setting | Status | Notes |
|---|---|---|
| Roles & Permissions | ✅ | |
| Field permissions (per role × field) | DB ✅ / UI ❌ | `field_permissions` table exists, no UI |
| Password policy (min length, expiry, history, complexity) | ❌ | |
| 2FA enforcement (off / optional / required) | ❌ | individual user 2FA exists |
| Session policy (idle timeout, max concurrent) | ❌ | |
| IP allowlist | ❌ | |
| Login policy (allow self-signup, allowed email domains) | ❌ | |
| Bulk transfer / re-assign on offboarding | ❌ | NEW PAGE |
| Bulk invite (paste CSV) | ❌ | team page has single invite |
| Data retention policy (auto-delete after N days) | ❌ | |
| Email sending: org SPF/DKIM, from-domain | partial | compliance page has some |
| Module / feature flags | partial | `/modules` exists |
| Webhook routing | ✅ | |
| Audit retention | ❌ | |
| Trash retention | ❌ | |

#### Super-admin (platform)

The single super-admin settings page is currently `max-w-3xl` and looks like a single form. Needs:

| Setting | Status |
|---|---|
| Default trial length / default plan | ❌ |
| Plans & Limits CRUD | ✅ partial |
| Email provider (SMTP / SendGrid keys, from-domain, DKIM) | ❌ UI |
| SMS provider keys | ❌ |
| Storage provider (S3) | ❌ UI |
| AI providers (OpenAI / Anthropic / Groq / Ollama) | ❌ UI (per `learnings`: must be hybrid AI gateway) |
| Feature flags global | ❌ |
| White-label branding | ❌ |
| Maintenance mode | ❌ |
| Rate limits | ❌ |
| Sentry / monitoring keys | ❌ |
| Tenant onboarding defaults | ❌ |
| Global announcement banner | ✅ |

---

## 4. What this PR delivers

| # | Deliverable | Type |
|---|---|---|
| 1 | This gap document | doc |
| 2 | Sidebar rewrite with inline filter, neat 7-section layout, pinned shortcuts | UI |
| 3 | `app/api/tenant/deals/bulk/route.ts` | API |
| 4 | `app/api/tenant/tasks/bulk/route.ts` | API |
| 5 | Bulk-action toolbars wired on deals / companies / tasks tables | UI |
| 6 | Settings layout rewrite: 3-scope sub-rail (Personal / Workspace / Admin), inline filter | UI |
| 7 | `app/tenant/settings/preferences` — locale, theme, density, formats, default landing | page |
| 8 | `app/tenant/settings/notifications` — event × channel matrix | page |
| 9 | `app/tenant/settings/out-of-office` — away dates + auto-reassign | page |
| 10 | `app/tenant/settings/bulk-transfer` — admin offboarding tool | page + API |
| 11 | `app/tenant/settings/localization` — fiscal, week start, business hours, holidays | page |
| 12 | `app/tenant/settings/login-policy` — password / 2FA / IP / sessions | page |
| 13 | `app/tenant/settings/tags-manager` — rename / merge / delete tags | page |
| 14 | `app/tenant/settings/picklists` — lead sources, loss reasons, win reasons, activity types | page |

All new pages persist into `tenants.settings` (JSONB) or `tenant_members.notification_prefs` / `users.metadata` so no DB migration is required for the first cut. Where a column already exists (`users.locale`, `users.theme`), it's used.

---

## 5. TODO (later iterations, not in this PR)

- Bulk add to sequence / list / segment
- Bulk update custom field value
- Bulk note / activity
- Bulk merge for leads & companies
- Bulk email send + bulk SMS / WhatsApp
- Lead scoring rules editor UI
- Field permissions UI (table exists)
- Saved views & saved searches
- Sidebar pinned-shortcuts persistence (cookies → server-side per-user)
- Super-admin settings expansion (provider keys UI, white-label, maintenance mode)
- Tags manager backend execution (rename across tables — currently UI-only stub for first cut)

---

## 6. Implementation notes

- All bulk routes share a 500-id ceiling, tenant-scoped validation, audit log entry, RBAC via `requirePerm`, soft-delete only.
- Sidebar filter is purely client-side (no API). Persisted in `localStorage` under `nucrm.sidebar.query`.
- Settings sub-rail uses the same filter pattern, persisted under `nucrm.settings.query`.
- New settings pages all start at full width — no `max-w-2xl` regressions per the existing `SETTINGS_LAYOUT_REDESIGN.md`.
- Permissions: every admin-only setting checks `isAdmin` server-side and hides server-side from the nav (don't rely on UI gating alone).



---

## 7. Mobile responsiveness (steering follow-up)

Every new page in this PR was built mobile-first:

- Settings shell (`app/tenant/settings/layout.tsx`) — `flex-col` on mobile, `lg:flex-row` from 1024px. The settings nav stacks above content on phones.
- Settings nav (`components/tenant/settings/settings-nav.tsx`) — `w-full lg:w-64`, sticky only on `lg+`.
- All new admin pages — `grid-cols-1 md:grid-cols-2/3` for form fields, `flex-wrap` for pill groups, sticky save bars on `bottom: 0` survive small viewports.
- Tags Manager — switches between a card list (mobile) and a full table (desktop) at `sm:` breakpoint.
- Bulk Transfer — resource cards re-flow `2 → 3 → 5` columns (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`).
- Sidebar inline filter, pinned section, per-section open state — all touch-friendly with 32px+ tap targets.

Mobile tap-area regression risk areas (call out for QA):

| Area | Risk | Mitigation |
|---|---|---|
| Notification matrix grid | Cells very narrow on mobile | Row "On/Off/~" toggle compresses; consider a per-row sheet on phone in a follow-up |
| Picklists order arrows | Tiny ▲▼ chars | Acceptable on phone tap; replace with full drag handle in v2 |
| Bulk action toolbar in DataTable | Horizontal scroll | DataTable already `flex-wrap`s actions |

## 8. Super-admin oversight (steering follow-up)

Every per-tenant setting (localization, login policy, picklists, etc.) is also visible to platform owners via:

- **`/api/superadmin/tenant-settings?tenant_id=…`** — read-only JSON dump of every settings sub-tree on a tenant + member counts.
- **`/superadmin/tenants/[id]/settings`** — UI drill-in: stats strip + Localization / Login policy / Picklists summaries with a clear "Read-only — use impersonation to make changes" banner so super admins can audit a tenant's config without flipping its values silently.

Future enhancements (out of this PR but tracked here):

- Impersonation-already-exists routing tied to this audit page (one-click "Open as admin").
- Diff viewer comparing each tenant's settings to platform defaults so configuration drift is visible.
- Saved-search by feature-flag value (e.g. "show me every tenant with 2FA still optional").

## 9. Super-admin monitoring page expansion (TODO)

The super-admin sidebar already lists Monitoring, Health, Errors, Backups, Token-Control, Usage, Revenue, Analytics. Gaps to close in a follow-up PR:

- **Adoption metrics** per feature — % of tenants who configured Localization, Login Policy, Picklists, Tags Manager, Bulk Transfer.
- **Settings drift dashboard** — tenants whose policy is weaker than recommended (password length < 12, 2FA off, IP allowlist disabled).
- **Bulk-operation audit feed** — every bulk_* audit entry across tenants in real-time.
- **OOO heatmap** — number of users currently away across tenants.
- **API key entropy** — keys older than N days, never-used keys, scopes that are too broad.
- **Email/SMS provider key health** — credentials missing, rate-limited, expired.
- **Tenant settings JSONB shape watcher** — schema-drift alarm if a tenant somehow stores unexpected keys in `settings`.

## 10. Hierarchy-aware setting visibility (steering follow-up)

The 3-scope settings sub-rail (`Personal / Workspace / Admin`) is already role-aware. Concrete behavior:

| Role          | Sees Personal | Sees Workspace | Sees Admin | Sees Super Admin |
|---------------|--------------|----------------|------------|------------------|
| Member        | ✓            | partial *      | ✗          | ✗                |
| Manager       | ✓            | ✓              | partial ** | ✗                |
| Admin         | ✓            | ✓              | ✓          | ✗                |
| Super Admin   | ✓            | ✓              | ✓          | ✓ (separate UI)  |

\* Members see read-only / view-only items in Workspace (industry templates, branding view).
\** Managers can be granted scoped admin items via `roles.permissions` JSONB.

The UI today checks `is_admin` from `/api/tenant/me` to show/hide. Server-side every PATCH endpoint re-checks `ctx.isAdmin` and returns 403 if not — UI gating is never relied upon for security.
