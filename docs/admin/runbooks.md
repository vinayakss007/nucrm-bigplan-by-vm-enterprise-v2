# Operations Runbooks

Step-by-step procedures for operating NuCRM. This page is the **index**; the detailed, authoritative
runbooks live in [`docs/runbooks/`](../runbooks/) and are linked below.

> When an incident is in progress, follow the linked runbook exactly and record what you do.

---

## Runbook index

| Runbook | Use when | Source |
| --- | --- | --- |
| **Go-live** | Launching a new environment to production | [`go-live.md`](../runbooks/go-live.md) |
| **Disaster recovery** | The database or environment is lost | [`disaster-recovery.md`](../runbooks/disaster-recovery.md) · [`DISASTER-RECOVERY.md`](../DISASTER-RECOVERY.md) |
| **Restore one organization** | A single tenant's data must be recovered | [`restore-one-organization.md`](../runbooks/restore-one-organization.md) |
| **Migration drift recovery** | A migration failed or schema drifted | [`migration-drift-recovery.md`](../runbooks/migration-drift-recovery.md) |
| **Branch protection** | Configuring repo safeguards | [`branch-protection.md`](../runbooks/branch-protection.md) |
| **Troubleshooting** | Diagnosing common issues | [`TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) |

---

## Pre-launch (summary)

Before go-live, work through the [go-live runbook](../runbooks/go-live.md) and the
[Production Readiness](../PRODUCTION-READINESS.md) checklist. At minimum:

1. **Secrets** — all required secrets set and strong ([Configuration](./configuration.md)).
2. **Database** — migrations applied (`npm run db:migrate`); chain verified
   (`npm run db:verify-chain`); isolation verified (`npm run db:verify-isolation`).
3. **Backups** — off-site storage configured and a **test restore** completed
   ([Backups & DR](./backups-dr.md)).
4. **Edge** — nginx TLS configured; app/worker/realtime bound to loopback; `TRUST_PROXY=true`.
5. **Observability** — Sentry, metrics (`METRICS_SECRET`), and alerting (PagerDuty/webhook) live
   ([Monitoring](./monitoring.md)).
6. **Pre-flight** — `npm run prod:preflight` and `npm run smoke` pass.

---

## Incident response (general shape)

1. **Detect** — an alert fires (PagerDuty / Alertmanager / Sentry) or Health shows a problem.
2. **Assess** — check **Super-Admin → Health / Monitoring / Errors** and the relevant process logs.
3. **Contain** — stop the bleeding (e.g. disable a misbehaving integration, scale, or roll back a
   deploy with `pm2 reload`).
4. **Recover** — follow the specific runbook (DR, migration recovery, etc.).
5. **Verify** — run `npm run smoke`, `db:verify-integrity`, `db:verify-isolation`.
6. **Record** — capture timeline, impact, and follow-ups.

---

## Common operational tasks

| Task | How |
| --- | --- |
| Zero-downtime deploy/reload | `pm2 reload ecosystem.config.cjs` |
| Scale frontend | `pm2 scale web <n>` (or `NUCRM_INSTANCES`) |
| Tail logs | `npm run logs:watch` / `npm run logs:errors`, or `pm2 logs` |
| Apply DB migrations | `npm run db:migrate` (check with `db:status`) |
| Check schema drift | `npm run db:drift-check` |
| Verify tenant isolation | `npm run db:verify-isolation` |
| Verify a backup | `npm run backup:verify` |
| Restore a backup | `npm run backup:restore` / `npm run dr` |
| Production diagnostics | `npm run prod:preflight` |

---

## Related

- [Backups & Disaster Recovery](./backups-dr.md)
- [Monitoring & Observability](./monitoring.md)
- [Deployment](./deployment.md) · [Security & Compliance](./security.md)
- Decision history: [`docs/adr/`](../adr/README.md)
