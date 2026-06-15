# NuCRM — Per-User Usage Tracking & Limits Plan

**Created:** 2026-05-21
**Goal:** Track and limit usage per user within each organization, based on their plan.
**Repo:** bigplan (BASE) — fixes flow to bigplan2 and enterprise. Features stay here unless ported upward.

---

## CURRENT STATE

### What Exists (Tenant-Level Only)
| Table | Column | Purpose |
|-------|--------|---------|
| `tenants` | `currentUsers` | Total users in org |
| `tenants` | `currentContacts` | Total contacts in org |
| `tenants` | `currentDeals` | Total deals in org |
| `tenants` | `storageUsedBytes` | Total storage used by org |
| `tenantTokenLimits` | `dailyTokens` | AI token limit per tenant |
| `apiKeyUsage` | `callCount` | API calls per key |

### What's Missing
- **No per-user tracking** — can't tell which user owns what
- **No per-user limits** — one user can consume all org resources
- **No enforcement** — limits exist as columns but nothing blocks on overflow
- **No usage notifications** — users aren't warned when approaching limits
- **No super admin usage dashboard** — can't see who's consuming what

---

## USAGE LIMITS PER PLAN

### Free Plan (0 users max, 1 admin only)
| Resource | Limit | Scope |
|----------|-------|-------|
| Users | 1 | Per tenant |
| Contacts | 500 | Per tenant |
| Deals | 100 | Per tenant |
| Storage | 100 MB | Per tenant |
| API Calls | 100/day | Per tenant |
| AI Tokens | 0 | Blocked |
| Emails Sent | 50/day | Per tenant |
| Automations | 3 active | Per tenant |
| Tickets | 50 | Per tenant |
| Forms | 1 | Per tenant |
| Custom Fields | 5 per entity | Per tenant |
| File Upload Size | 5 MB max | Per file |

### Starter Plan ($29/mo — up to 5 users)
| Resource | Limit | Scope |
|----------|-------|-------|
| Users | 5 | Per tenant |
| Contacts | 5,000 | Per tenant |
| Deals | 500 | Per tenant |
| Storage | 2 GB | Per tenant |
| API Calls | 1,000/day | Per tenant |
| AI Tokens | 0 | Blocked |
| Emails Sent | 500/day | Per tenant |
| Automations | 10 active | Per tenant |
| Tickets | 200 | Per tenant |
| Forms | 3 | Per tenant |
| Custom Fields | 10 per entity | Per tenant |
| File Upload Size | 10 MB max | Per file |

### Pro Plan ($79/mo — up to 25 users)
| Resource | Limit | Scope |
|----------|-------|-------|
| Users | 25 | Per tenant |
| Contacts | 50,000 | Per tenant |
| Deals | 5,000 | Per tenant |
| Storage | 20 GB | Per tenant |
| API Calls | 10,000/day | Per tenant |
| AI Tokens | 100,000/day | Per tenant |
| Emails Sent | 5,000/day | Per tenant |
| Automations | 50 active | Per tenant |
| Tickets | 2,000 | Per tenant |
| Forms | 10 | Per tenant |
| Custom Fields | 25 per entity | Per tenant |
| File Upload Size | 25 MB max | Per file |

### Enterprise Plan (Custom — unlimited users)
| Resource | Limit | Scope |
|----------|-------|-------|
| Users | Unlimited | Per tenant |
| Contacts | Unlimited | Per tenant |
| Deals | Unlimited | Per tenant |
| Storage | 200 GB | Per tenant |
| API Calls | 100,000/day | Per tenant |
| AI Tokens | 1,000,000/day | Per tenant |
| Emails Sent | Unlimited | Per tenant |
| Automations | Unlimited | Per tenant |
| Tickets | Unlimited | Per tenant |
| Forms | Unlimited | Per tenant |
| Custom Fields | Unlimited | Per tenant |
| File Upload Size | 100 MB max | Per file |

---

## PER-USER TRACKING (What We Track Per User)

### User Activity Counters
| Metric | Tracked When | Stored In |
|--------|-------------|-----------|
| Contacts created | `POST /api/tenant/contacts` | `userUsage.counters` |
| Contacts edited | `PATCH /api/tenant/contacts/[id]` | `userUsage.counters` |
| Deals created | `POST /api/tenant/deals` | `userUsage.counters` |
| Emails sent | `POST /api/tenant/email/send` | `userUsage.counters` |
| Files uploaded | `POST /api/tenant/files` | `userUsage.counters` |
| Storage used | File upload + document attach | `userUsage.storageBytes` |
| API calls | Any `/api/tenant/*` call | `userUsage.apiCalls` |
| AI tokens used | `/api/tenant/ai/*` calls | `userUsage.aiTokens` |
| Automations triggered | Automation execution | `userUsage.automationRuns` |
| Tickets created | `POST /api/tenant/tickets` | `userUsage.counters` |
| Forms submissions | Form submit handler | `userUsage.counters` |
| Last activity | Any API call | `userUsage.lastActivityAt` |

### Database Schema (New)

```sql
-- Per-user usage tracking
CREATE TABLE user_usage (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  
  -- Counters (reset monthly or daily depending on resource)
  counters JSONB DEFAULT '{}',  -- { contacts_created: 45, deals_created: 12, emails_sent: 230, ... }
  
  -- Storage (bytes owned by this user)
  storage_bytes BIGINT DEFAULT 0,
  
  -- API calls (daily reset)
  api_calls_today INTEGER DEFAULT 0,
  api_calls_date DATE DEFAULT CURRENT_DATE,
  
  -- AI tokens (daily reset)
  ai_tokens_today INTEGER DEFAULT 0,
  ai_tokens_date DATE DEFAULT CURRENT_DATE,
  
  -- Last activity
  last_activity_at TIMESTAMP WITH TIME ZONE,
  
  -- Lifecycle
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(tenant_id, user_id)
);

-- Plan limits (editable by super admin)
CREATE TABLE plan_limits (
  id UUID PRIMARY KEY,
  plan_id TEXT NOT NULL,  -- 'free', 'starter', 'pro', 'enterprise'
  
  -- Limits
  max_users INTEGER,
  max_contacts INTEGER,
  max_deals INTEGER,
  max_storage_bytes BIGINT,
  max_api_calls_per_day INTEGER,
  max_ai_tokens_per_day INTEGER,
  max_emails_per_day INTEGER,
  max_active_automations INTEGER,
  max_tickets INTEGER,
  max_forms INTEGER,
  max_custom_fields_per_entity INTEGER,
  max_file_upload_bytes INTEGER,
  
  -- Override settings
  is_active BOOLEAN DEFAULT true,
  
  UNIQUE(plan_id)
);
```

---

## ENFORCEMENT FLOW

### 1. On Every API Call (Middleware)
```
request → requireAuth() → checkUserLimit() → proceed or 429
```

**`checkUserLimit()` checks:**
- Is user's `api_calls_today` < plan's `max_api_calls_per_day`?
- Is tenant's `currentContacts` < plan's `max_contacts`?
- Is tenant's `currentUsers` < plan's `max_users`?
- Is user's `storage_bytes` < (plan's `max_storage_bytes` / total_users)?

### 2. On Resource Creation (Hard Block)
```
POST /api/tenant/contacts
  → checkLimit('contacts', tenantId, userId)
  → if over limit: return 403 "Contact limit reached. Upgrade your plan."
  → else: create contact, increment counters
```

### 3. On User Invite (Hard Block)
```
POST /api/tenant/invite/send
  → if tenants.currentUsers >= plan.max_users: return 403
  → else: send invite
```

### 4. On File Upload (Hard Block)
```
POST /api/tenant/files
  → if file.size > plan.max_file_upload_bytes: return 413
  → if user.storage_bytes + file.size > user_storage_quota: return 403
  → else: upload to S3, increment storage_bytes
```

---

## USAGE NOTIFICATIONS

### Warning Thresholds
| Threshold | Action |
|-----------|--------|
| 80% of limit | In-app notification + email to tenant admin |
| 90% of limit | In-app notification + email to tenant admin + banner on dashboard |
| 100% of limit | Hard block + email to tenant admin with upgrade link |

### Notification Types
| Type | Trigger | Recipient |
|------|---------|-----------|
| `limit_warning` | 80% usage | Tenant admin |
| `limit_critical` | 90% usage | Tenant admin |
| `limit_reached` | 100% usage | Tenant admin |
| `user_limit_reached` | Can't invite more users | Tenant admin |
| `storage_limit_reached` | Can't upload files | User + tenant admin |
| `api_limit_reached` | API calls blocked | User + tenant admin |

---

## SUPER ADMIN CONTROLS (Integrated in Monitoring Dashboard)

### Global Plan Limits Management
**File:** `app/superadmin/plans/page.tsx`
- Edit limits for each plan (users, contacts, storage, API, etc.)
- Set warning thresholds (default 80%, 90%)
- View usage across all tenants
- See which tenants are over/under limits

### Per-Tenant Override (From Monitoring Dashboard)
**File:** `app/superadmin/tenants/[id]/usage/page.tsx`
- **Accessible from monitoring dashboard** — click any tenant → usage tab
- Override limits for specific tenant (e.g., give extra storage)
- View per-user breakdown within tenant
- See which user is consuming most resources
- Manually reset counters (for debugging)
- Change tenant's plan
- Force-enable/disable any module
- Impersonate tenant admin

### Usage Analytics Dashboard
**File:** `app/superadmin/analytics/usage/page.tsx`
- Total users across all tenants
- Total contacts, deals, storage
- API call volume over time
- Top consuming tenants
- Revenue impact of limit-driven upgrades

---

## TENANT ADMIN CONTROLS

### Usage Dashboard
**File:** `app/tenant/settings/usage/page.tsx`
- Progress bars for each resource (contacts, storage, API, etc.)
- Per-user breakdown table
- "Who's using the most" leaderboard
- Upgrade prompt when approaching limits

### Per-User Limits (Optional)
- Tenant admin can set sub-limits per user
- Example: limit intern to 100 contacts, 500 MB storage
- Default: no per-user limits (org-wide pool)

---

## IMPLEMENTATION ORDER

1. **`drizzle/schema/usage.ts`** — New `userUsage` and `planLimits` tables
2. **`lib/usage/tracker.ts`** — Core tracking functions (increment, check, reset)
3. **`lib/usage/middleware.ts`** — API middleware for limit enforcement
4. **`lib/usage/notifications.ts`** — Warning/critical/reached notifications
5. **Seed plan limits** — Default limits for free/starter/pro/enterprise
6. **Update all create endpoints** — Add `checkLimit()` before insert
7. **`app/tenant/settings/usage/page.tsx`** — Tenant admin usage dashboard
8. **`app/superadmin/plans/page.tsx`** — Super admin plan limits editor
9. **`app/superadmin/tenants/[id]/usage/page.tsx`** — Per-tenant usage override
10. **`app/superadmin/analytics/usage/page.tsx`** — Global usage analytics

---

## FILES TO CREATE/MODIFY

| File | Action | Purpose |
|------|--------|---------|
| `drizzle/schema/usage.ts` | CREATE | `userUsage`, `planLimits` tables |
| `lib/usage/tracker.ts` | CREATE | Track/increment/reset usage counters |
| `lib/usage/middleware.ts` | CREATE | API limit enforcement middleware |
| `lib/usage/notifications.ts` | CREATE | Usage warning notifications |
| `app/tenant/settings/usage/page.tsx` | CREATE | Tenant usage dashboard |
| `app/superadmin/plans/page.tsx` | CREATE | Plan limits management |
| `app/superadmin/tenants/[id]/usage/page.tsx` | CREATE | Per-tenant usage override |
| `app/superadmin/analytics/usage/page.tsx` | CREATE | Global usage analytics |
| `app/api/tenant/contacts/route.ts` | MODIFY | Add contact limit check |
| `app/api/tenant/deals/route.ts` | MODIFY | Add deal limit check |
| `app/api/tenant/files/route.ts` | MODIFY | Add storage + file size check |
| `app/api/tenant/email/send/route.ts` | MODIFY | Add email count check |
| `app/api/tenant/invite/send/route.ts` | MODIFY | Add user count check |
| `app/api/tenant/ai/route.ts` | MODIFY | Add AI token check |
| `middleware.ts` | MODIFY | Add API call counter middleware |
| `drizzle/schema/infra.ts` | MODIFY | Add `planLimits` table |

---

## EXAMPLE: End-to-End Flow

1. **Super admin** sets Starter plan: 5 users, 5,000 contacts, 2 GB storage
2. **Tenant "Acme Corp"** signs up for Starter plan
3. **User "John"** creates 100 contacts → `userUsage.counters.contacts_created = 100`, `tenants.currentContacts = 100`
4. **User "Jane"** creates 200 contacts → `userUsage.counters.contacts_created = 200`, `tenants.currentContacts = 300`
5. **Tenant admin** sees usage dashboard: 300/5,000 contacts (6%)
6. **John** uploads 500 MB of files → `userUsage.storageBytes = 524288000`
7. **Jane** uploads 1.5 GB → `userUsage.storageBytes = 1610612736`, `tenants.storageUsedBytes = 2134900736`
8. **System** detects 2.1 GB / 2 GB = 105% → sends `storage_limit_reached` notification
9. **Jane** tries to upload another file → blocked with "Storage limit reached. Contact admin or upgrade plan."
10. **Tenant admin** sees alert, upgrades to Pro plan → limits increase to 20 GB
11. **System** unblocks uploads, sends confirmation email
