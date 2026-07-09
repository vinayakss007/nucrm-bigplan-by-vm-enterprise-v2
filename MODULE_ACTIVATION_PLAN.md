# NuCRM — Granular Module Activation Plan

**Created:** 2026-05-21
**Goal:** No tenant gets all features by default. Everything is gated by plan + super admin control.
**Repo:** bigplan (BASE) — fixes flow to bigplan2 and enterprise. Features stay here unless ported upward.

---

## CURRENT PROBLEM

All tenants get ALL features. The module registry exists but:
- `checkPlanGate()` is only called on `install()` — not on route access
- No middleware blocks access to module pages/APIs
- No auto-install on tenant creation based on plan
- Super admin has APIs but no UI to manage modules globally

---

## ACTIVATION HIERARCHY (3 Levels)

```
Level 1: SUPER ADMIN (Platform Owner)
  ├── Sets which modules are globally available (isAvailable)
  ├── Sets pricing per plan for each module
  ├── Sets default modules per plan (auto-installed on signup)
  ├── Force-enables/disables modules for any tenant
  └── Views analytics: which modules are used, revenue from add-ons

Level 2: ORGANIZATION (Tenant Owner / Admin)
  ├── Sees modules allowed by their plan
  ├── Can purchase additional modules (extra charge)
  ├── Can enable/disable modules for their org
  ├── Can enable/disable specific FEATURES within a module
  └── Configures module settings (API keys, webhooks, etc.)

Level 3: TEAM MEMBERS (Inside Organization)
  ├── Only see modules/features enabled by their org admin
  ├── Access controlled by role permissions
  └── Cannot install/uninstall modules
```

---

## MODULE CATALOG (13 Modules)

### Always Included (Core — cannot be disabled)
| ID | Name | Free | Starter | Pro | Enterprise |
|----|------|------|---------|-----|------------|
| `core-crm` | Core CRM | ✅ | ✅ | ✅ | ✅ |
| `automation-basic` | Basic Automation | ✅ | ✅ | ✅ | ✅ |

### Plan-Based (Auto-installed on signup)
| ID | Name | Free | Starter | Pro | Enterprise |
|----|------|------|---------|-----|------------|
| `service-helpdesk` | Helpdesk | ❌ | ✅ | ✅ | ✅ |
| `sales-quotes` | Quotes & Proposals | ❌ | ✅ | ✅ | ✅ |
| `marketing-segments` | Smart Segments | ❌ | ✅ | ✅ | ✅ |
| `automation-pro` | Automation Pro | ❌ | ✅ | ✅ | ✅ |
| `whatsapp-bot` | WhatsApp Bot | ❌ | ✅ | ✅ | ✅ |
| `email-sync` | Email Sync | ❌ | ✅ | ✅ | ✅ |

### Premium Add-Ons (Extra charge on any plan)
| ID | Name | Free | Starter | Pro | Enterprise |
|----|------|------|---------|-----|------------|
| `ai-assistant` | AI Assistant | ❌ | ❌ | $25/mo | Free |
| `analytics-pro` | Analytics Pro | ❌ | ❌ | $15/mo | Free |
| `calculated-fields` | Calculated Fields | ❌ | ❌ | $15/mo | Free |
| `industry-templates` | Industry Templates | ❌ | ❌ | $20/mo | Free |
| `forms-builder` | Forms Builder | ❌ | $10/mo | $10/mo | Free |

---

## DEFAULT MODULES PER PLAN

### Free Plan
- `core-crm` (always)
- `automation-basic` (always)

### Starter Plan ($29/mo)
- `core-crm` (always)
- `automation-basic` (always)
- `service-helpdesk` (included)
- `sales-quotes` (included)
- `marketing-segments` (included)
- `automation-pro` (included)
- `whatsapp-bot` (included)
- `email-sync` (included)
- `forms-builder` (+$10/mo add-on)

### Pro Plan ($79/mo)
- Everything in Starter
- `ai-assistant` (+$25/mo add-on)
- `analytics-pro` (+$15/mo add-on)
- `calculated-fields` (+$15/mo add-on)
- `industry-templates` (+$20/mo add-on)

### Enterprise Plan (Custom)
- ALL modules included free
- Super admin can force-enable any module

---

## DATABASE SCHEMA (Already Exists — Just Needs Enforcement)

### `modules` table
| Column | Purpose |
|--------|---------|
| `id` | Module ID (e.g., `ai-assistant`) |
| `isAvailable` | Global on/off (super admin controls) |
| `manifest` | JSON with pricing per plan, features, settings schema |

### `tenantModules` table
| Column | Purpose |
|--------|---------|
| `tenantId` | Which organization |
| `moduleId` | Which module |
| `status` | `active` or `disabled` (tenant admin controls) |
| `enabledFeatures` | JSON array of feature keys (granular feature toggle) |
| `forceEnabled` | Super admin override (bypasses plan gate) |
| `settings` | Module-specific config (API keys, etc.) |

### `tenants` table
| Column | Purpose |
|--------|---------|
| `planId` | `free`, `starter`, `pro`, `enterprise` |

---

## WHAT NEEDS TO BE BUILT

### 1. Auto-Install on Tenant Creation
**File:** `app/api/setup/create-admin/route.ts` + `app/api/auth/signup/route.ts`
- When tenant signs up, auto-install modules based on their plan
- Use `BUILTIN_MODULES` pricing to determine which modules to install
- Set `forceEnabled: true` for plan-included modules

### 2. Module Access Middleware
**File:** `lib/modules/gate.ts` (new)
- Middleware function `requireModule(tenantId, moduleId)` 
- Checks: `isAvailable` → plan gate → `status === 'active'` → `forceEnabled`
- Returns 403 if module not accessible
- Use in all module-specific API routes

### 3. UI: Super Admin Module Management (Integrated in Monitoring Dashboard)
**File:** `app/superadmin/modules/page.tsx` (new) + `app/superadmin/monitoring/page.tsx` (update)
- Table of all 13 modules
- Toggle `isAvailable` per module (global on/off)
- Edit pricing per plan (which plan gets it, at what price)
- Set default modules per plan
- View install stats per module
- Force-enable/disable for any tenant
- **Integrated in monitoring dashboard** — super admin can click any tenant → see their modules → change anything

### 4. UI: Tenant Module Marketplace
**File:** `app/tenant/modules/page.tsx` (exists — needs update)
- Show modules available for tenant's plan
- Show modules that are add-ons (with price)
- "Install" button for allowed modules
- "Upgrade plan" button for plan-locked modules
- Show installed modules with toggle (enable/disable)
- Feature-level toggles within each module

### 5. Feature-Level Access Control
**File:** `lib/modules/gate.ts`
- `requireFeature(tenantId, moduleId, featureKey)`
- Checks `enabledFeatures` array in `tenantModules`
- Default: all features enabled when module installed
- Tenant admin can disable specific features

### 6. Billing Integration (Add-On Charges)
**File:** `lib/stripe.ts` (new — part of FEAT-PAY)
- When tenant installs a paid add-on, create Stripe subscription item
- Track add-on charges separately from base plan
- Prorate mid-cycle add-on purchases
- Auto-disable add-ons on payment failure

### 7. Module Usage Analytics
**File:** `app/superadmin/analytics/modules/page.tsx` (new)
- Which modules are most used
- Revenue from add-ons per month
- Tenants using each module
- Feature usage within modules

---

## ENFORCEMENT RULES

### Rule 1: No module access without installation
- API routes check `requireModule()` before processing
- Pages check module status in server component
- Sidebar hides modules not installed/active

### Rule 2: Plan gates are hard blocks
- Free plan cannot access starter-only modules (even if super admin hasn't disabled)
- Super admin can override with `forceEnabled`

### Rule 3: Tenant admin can disable but not enable beyond plan
- Tenant admin can `status: 'disabled'` any module
- Tenant admin CANNOT install modules not allowed by plan
- Only super admin can bypass plan gate

### Rule 4: Feature-level control
- Each module has a `features` array in manifest
- `enabledFeatures` in `tenantModules` controls which features are active
- Default: all features enabled on install
- Tenant admin can toggle individual features

---

## IMPLEMENTATION ORDER

1. **`lib/modules/gate.ts`** — Core middleware (enforcement layer)
2. **Auto-install on signup** — Default modules per plan
3. **Update all module API routes** — Add `requireModule()` checks
4. **Super admin module management UI** — Global control
5. **Tenant module marketplace UI** — Per-org control
6. **Feature-level toggles** — Granular control
7. **Stripe add-on billing** — Paid modules
8. **Module usage analytics** — Super admin dashboard

---

## FILES TO CREATE/MODIFY

| File | Action | Purpose |
|------|--------|---------|
| `lib/modules/gate.ts` | CREATE | Module access middleware |
| `lib/modules/auto-install.ts` | CREATE | Auto-install on tenant creation |
| `app/superadmin/modules/page.tsx` | CREATE | Super admin module management UI |
| `app/superadmin/analytics/modules/page.tsx` | CREATE | Module usage analytics |
| `app/tenant/modules/page.tsx` | MODIFY | Update marketplace with plan gates |
| `app/api/setup/create-admin/route.ts` | MODIFY | Auto-install default modules |
| `app/api/auth/signup/route.ts` | MODIFY | Auto-install default modules |
| `app/api/tenant/ai/route.ts` | MODIFY | Add `requireModule('ai-assistant')` |
| `app/api/tenant/automation/**` | MODIFY | Add `requireModule('automation-pro')` |
| `app/api/tenant/forms/**` | MODIFY | Add `requireModule('forms-builder')` |
| `app/api/tenant/tickets/**` | MODIFY | Add `requireModule('service-helpdesk')` |
| `app/api/tenant/quotes/**` | MODIFY | Add `requireModule('sales-quotes')` |
| `components/tenant/layout/sidebar.tsx` | MODIFY | Hide modules not installed |

---

## EXAMPLE: How It Works End-to-End

1. **Super admin** sets `ai-assistant` pricing: Pro = $25/mo, Enterprise = free
2. **Tenant signs up** for Pro plan → auto-installed: core-crm, automation-basic, helpdesk, quotes, segments, automation-pro, whatsapp, email-sync
3. **Tenant admin** goes to Modules page → sees `ai-assistant` with "$25/mo" button
4. **Tenant clicks "Install"** → Stripe checkout → on success, module activated
5. **Tenant admin** can toggle off `email-sync` features they don't need
6. **Team member** only sees modules/features enabled by tenant admin
7. **Super admin** can force-disable `ai-assistant` for any tenant (e.g., payment failed)
