# Super-Admin Console

The operator console at **`/superadmin`** — where platform operators manage every tenant, billing,
usage, health, and support across the whole installation.

> 🔐 **Super-admin only.** Access is gated on the `isSuperAdmin` flag; super-admins bypass
> tenant-membership checks and are granted platform-wide permission. Every sensitive action is
> written to the **super-admin audit log**.

---

## Access & guardrails

- The console layout gates on the current user's super-admin status; non-super-admins are turned
  away.
- Super-admins operate **across tenants**, so treat this access as privileged. All impersonation
  and high-impact actions are audited (`super_admin_audit_logs`).
- Prefer the least-privilege path: read/inspect before you mutate.

---

## Console areas

Grouped by what you'll do with them. (Pages under `app/superadmin/*`; APIs under
`app/api/superadmin/*` and `app/api/super-admin/*`.)

### Tenant & user management

| Area | What you can do |
| --- | --- |
| **Dashboard** | Platform-wide KPIs at a glance. |
| **Tenants** | List/inspect workspaces; manage plan, status, modules, and settings per tenant. |
| **Users** | Inspect/manage users across tenants. |
| **Impersonation** | Enter a tenant to reproduce/support issues — **fully audited**. Related: `join-tenant`, `transfer-admin`. |
| **Announcements** | Broadcast messages to tenants. |

### Commercial

| Area | What you can do |
| --- | --- |
| **Billing** | Platform billing overview. |
| **Revenue** | Revenue/MRR analytics. |
| **Usage** | Per-tenant usage against limits. |
| **Adoption** | Feature-adoption analytics. |
| **Analytics** | Cross-tenant analytics. |
| **Plans / Modules** | Manage plans and enable/gate modules platform-wide. |
| **Token control / AI credits** | Manage AI token budgets and limits; AI provider keys (`ai-keys`). |

### Operations & reliability

| Area | What you can do |
| --- | --- |
| **Health** | System health status. |
| **Monitoring** | Live system/process monitoring (incl. worker heartbeat). |
| **Errors** | Browse captured error logs. |
| **Logs** | Explore application logs. |
| **Rate limits** | Inspect/adjust rate-limiting. |
| **Backups** | Trigger/inspect backups. See [Backups & DR](./backups-dr.md). |
| **Selective restore** | Restore specific data for a single tenant. |
| **Templates** | Manage industry/starter templates. |
| **Tickets** | Platform-level support tickets. |
| **Settings** | Platform settings. |

### Data access

| Area | What you can do |
| --- | --- |
| **Data explorer** | Run read queries against platform data. Queries are constrained by a **SQL allowlist** (`lib/sql-allowlist.ts`) to prevent unsafe operations. |

---

## Common operator tasks

### Provision / adjust a tenant

1. Go to **Tenants** → open the workspace.
2. Set the **plan** (unlocks features and limits) and **status** as needed.
3. Enable/gate **modules** for that tenant.

### Investigate a tenant issue (impersonation)

1. **Tenants** → open the workspace → **Impersonate** (or `join-tenant`).
2. Reproduce the issue as the tenant would see it.
3. Exit impersonation. Confirm the session is recorded in the **audit log**.

### Manage AI budgets

Use **Token control / AI credits** to view consumption and set per-tenant/per-user limits; manage
provider keys under `ai-keys`. See also the tenant-facing [AI Features](../public/user-guide/ai-features.md).

### Respond to an incident

Start from **Health / Monitoring / Errors**, then follow the
[Operations Runbooks](./runbooks.md) and [Monitoring](./monitoring.md).

---

## Related

- [Security & Compliance](./security.md) — how super-admin access and auditing work
- [Backups & Disaster Recovery](./backups-dr.md) — backups & selective restore
- [Monitoring & Observability](./monitoring.md) — the signals behind Health/Monitoring/Errors
