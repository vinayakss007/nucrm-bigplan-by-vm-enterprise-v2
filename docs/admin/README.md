# NuCRM — Super-Admin (Operator) Documentation

**Internal / confidential.** This section is for the people who **run** the NuCRM platform —
deploying it, operating it, and supporting all the workspaces (tenants) on it. If you're a customer
or workspace admin, use the [Public Docs](../public/README.md) instead.

> "Super-admin" = platform operator with cross-tenant access. This is distinct from a _workspace
> admin_, who only administers a single tenant.

---

## Map of this section

| Guide                                                                  | Read it when you need to…                                                     |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Platform Architecture](./architecture.md)                             | Understand how the system fits together                                       |
| [Installation & Deployment](./deployment.md)                           | Stand up dev, staging, or production                                          |
| [Configuration Reference](./configuration.md)                          | Look up an environment variable or setting                                    |
| [Super-Admin Console](./superadmin-console.md)                         | Operate tenants, billing, usage, support                                      |
| [Security & Compliance](./security.md)                                 | Understand/harden auth, RBAC, RLS, encryption, GDPR/SOC2                      |
| [Backups & Disaster Recovery](./backups-dr.md)                         | Back up, restore, or recover data                                             |
| [Monitoring & Observability](./monitoring.md)                          | Watch health, metrics, errors, and alerts                                     |
| [Operations Runbooks](./runbooks.md)                                   | Execute go-live, incident, and recovery procedures                            |
| [Background Jobs & Realtime](./jobs-and-realtime.md)                   | Understand the worker, queues, cron, and realtime                             |
| [Contributing & Operations Handbook](./contributing-and-operations.md) | Follow the PR policy, engineering standards, toolchain, and live deploy facts |

---

## Platform at a glance

| Aspect            | Summary                                                             |
| ----------------- | ------------------------------------------------------------------- |
| **Product**       | NuCRM Enterprise — multi-tenant SaaS CRM (v0.8.1)                   |
| **Runtime**       | Next.js 16 (App Router), React 19, TypeScript 5.9, Node ≥ 22        |
| **Data**          | PostgreSQL 15+ (Drizzle ORM, ~215 tables), Redis                    |
| **Processes**     | `web` (Next.js), `worker` (BullMQ), `realtime` (socket.io), `cron`  |
| **Isolation**     | App-level `tenant_id` filtering **+** PostgreSQL Row-Level Security |
| **Public edge**   | nginx (the only internet-facing service in production)              |
| **Scale**         | ~149 tenant pages · ~31 super-admin pages · ~492 API route files    |
| **Observability** | Sentry, Prometheus + Grafana + Loki, Alertmanager, PagerDuty        |

See [Architecture](./architecture.md) for the full picture.

---

## Operator responsibilities

1. **Keep the platform up** — monitor health, respond to alerts, follow [runbooks](./runbooks.md).
2. **Protect the data** — enforce [security](./security.md), verify [backups](./backups-dr.md).
3. **Manage tenants** — provisioning, plans, support, and (audited) impersonation via the
   [Super-Admin Console](./superadmin-console.md).
4. **Operate safely** — never bypass RLS, never commit secrets, always test restores.

---

## Related engineering references (existing)

These pre-existing documents remain authoritative for engineering detail and are linked from the
relevant guides here:

- Architecture Decision Records — [`docs/adr/`](../adr/README.md)
- Operational runbooks — [`docs/runbooks/`](../runbooks/)
- Original deployment guide — [`DEPLOYMENT.md`](../../DEPLOYMENT.md)
- Disaster recovery — [`docs/DISASTER-RECOVERY.md`](../DISASTER-RECOVERY.md)
- Troubleshooting — [`docs/TROUBLESHOOTING.md`](../TROUBLESHOOTING.md)
- Database security — [`docs/database-security.md`](../database-security.md)
- Tenant isolation verification — [`docs/TENANT-ISOLATION-VERIFICATION.md`](../TENANT-ISOLATION-VERIFICATION.md)
- Production readiness — [`docs/PRODUCTION-READINESS.md`](../PRODUCTION-READINESS.md)
