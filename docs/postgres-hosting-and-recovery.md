# PostgreSQL Hosting, RLS/PgBouncer, and Point-in-Time Recovery

**Status:** Decision recorded — managed PostgreSQL chosen. Provider not yet final.
**Date:** 2026-07-28
**Related:** #674 (DB fail-proof layer), #675 (backup/DR epic), ADR-0003 (RLS tenant
context), ADR-0012 (audit immutability)

This document records what to use, why, the two gotchas that will bite during
cutover, and the runbook. Written because the decision was made in conversation
and needed a durable home.

---

## 1. Decision: managed, plain PostgreSQL

**Current state:** self-managed PostgreSQL with one read replica. Docker is used
for local development only. There is **no WAL archiving and no PITR** — backups
are daily `pg_dump` snapshots, so the current RPO is **up to 24 hours**, against
the 5-minute target in #675.

**Decision: move to managed PostgreSQL.**

### Why

- **PITR becomes a setting, not a project.** Self-managed it means pgBackRest or
  WAL-G, an archive host, monitoring that archiving has not silently stalled, and
  a restore drill someone actually runs. Managed providers give
  restore-to-a-point-in-time inside a retention window as a product feature.
- **The failure mode of self-managed backup infrastructure is silence.** This
  codebase has already demonstrated it: the S3 backup upload was gated on the
  wrong environment variable name, so under Docker it never ran while the record
  said `completed`; migration `0042` was missing from the journal; the trash purge
  was permanently blocked by four foreign keys with no signal beyond a 500. WAL
  archiving fails the same way, and you discover it during a restore.
- **Operational surface.** One replica, no automated failover, manual minor-version
  patching, no storage autoscaling, no support channel during an incident.
- **Blast radius.** A multi-tenant CRM holding PII, billing data, auth secrets and
  audit chains. One unrecoverable loss event is existential; that is the figure the
  managed premium is weighed against.

### When self-managing would have been right

Recorded so this is revisited on evidence, not habit:

| Condition                                                  | Applies today              |
| ---------------------------------------------------------- | -------------------------- |
| Data residency/sovereignty rules a provider cannot satisfy | No (revisit if it changes) |
| A DBA/SRE already on call                                  | No                         |
| Extensions no provider offers                              | No                         |
| Scale where managed cost genuinely balloons                | Not at current stage       |

If any of the first three become true, reopen this decision.

---

## 2. Provider options

### Recommended start: Neon (plain PostgreSQL, usage-based)

Published pricing at time of writing: Launch is **$0.106 per CU-hour** plus
**$0.35 per GB-month** storage with no minimum monthly fee; Neon's own worked
example for a small production app is about **$23/month** (120 CU-hours + 20 GB
storage + 10 GB restore history). Scale is **$0.222 per CU-hour**. Storage pricing
fell from $1.75 to $0.35 per GB-month. Compute suspends after roughly 5 minutes
idle and resumes in a few hundred milliseconds.

Sources: [Neon pricing](https://neon.com/pricing),
[worked example](https://neon.com/faqs/affordable-managed-postgres-options-startups),
[2026 pricing changes](https://vela.simplyblock.io/articles/neon-serverless-postgres-pricing-2026/).
_(Figures rephrased and summarised for licensing compliance; verify current pricing
before committing.)_

Why it fits: point-in-time restore is included, it is plain PostgreSQL, and the
usage-based model suits traffic that is currently low and uneven. Branching is a
genuine bonus — a branch of production-shaped data would have caught several of the
migration bugs found in this audit.

### Alternative: AWS RDS for PostgreSQL

The boring enterprise choice, correct if procurement, VPC peering, or a specific
compliance attestation is required. Cost = instance-hours + storage + backup
storage beyond the provisioned DB size (roughly $0.095/GB-month above that).
**Multi-AZ roughly doubles the instance cost.** Savings Plans / Reserved Instances
discount the instance line for a 1-year commitment. Get real figures from the
[AWS RDS pricing page](https://aws.amazon.com/rds/postgresql/pricing/) — instance
pricing varies by region and changes.

Google Cloud SQL is equivalent if the stack is on GCP.

Moving Neon → RDS later is a plain dump/restore, not a rewrite. Starting cheap does
not lock anything in.

---

## 3. Cost control

1. **PITR before Multi-AZ.** They solve different problems: Multi-AZ is
   _availability_, PITR is _data loss_. The stated priority is data loss, and PITR
   is the cheaper of the two. Add Multi-AZ when downtime starts costing money.
2. **Right-size on evidence.** The workload is small; burstable/Graviton classes
   are the correct starting point. Scale on measurements, not anticipation.
3. **Retire the self-managed replica** once the provider handles failover — that
   VM cost offsets part of the managed premium.
4. **Commit after a month** of real usage data (Reserved Instances / Savings Plans).
5. **Do not over-provision IOPS.** gp3 baseline is ample for this workload.
6. **Polling costs money on usage-based billing.** The SSE notification stream ran
   a `COUNT(*)` per connected client every 30 seconds, which also prevented compute
   from ever idling down. Replaced with socket.io push in #644 — that change
   directly reduces the managed bill.
7. **Retire the PgBouncer container** only after reading section 4. The managed
   pooler is not a drop-in for this codebase's tenant context.

---

## 4. GOTCHA: RLS tenant context vs a transaction-mode pooler

**This will silently break tenant isolation if missed. Verify before cutover.**

Tenant isolation uses a PostgreSQL GUC (`app.current_tenant`) set per request and
read by RLS policies. In this codebase `setTenantContext()` sets it **session-scoped**
when no transaction is passed (ADR-0003, currently in the unmerged #753).

Managed poolers — RDS Proxy, and Neon's and Supabase's poolers — operate in
**transaction mode**: a backend connection returns to the pool after each
transaction and is handed to a different request. A session-scoped GUC therefore
**survives into another request's connection checkout**, which is exactly the
cross-tenant leak #642 was about.

Three things make it safe, and they only work together:

1. **`server_reset_query = DISCARD ALL`** (or the provider's equivalent) so session
   state is cleared when a connection returns to the pool. Self-managed PgBouncer
   had **no reset query configured**, which is why session scope was unsafe.
2. **Policies that fail closed.** Migration `0045` in #753 rewrites policies to use
   `NULLIF(current_setting('app.current_tenant', true), '')` so an empty GUC yields
   **zero rows** instead of `ERROR: invalid input syntax for type uuid: ""`.
3. **Transaction-scoped GUC where a transaction exists** (`is_local = true`).

**Before cutover, verify on the managed pooler:**

```sql
-- Session A: set the context, then return the connection to the pool.
SELECT set_config('app.current_tenant', '<tenant-a-uuid>', false);
-- Session B (new request, likely the same backend): must be empty, not tenant A.
SELECT current_setting('app.current_tenant', true);
```

If session B sees tenant A's id, `DISCARD ALL` is not in effect and the deployment
is unsafe. `npm run db:verify-isolation` covers the policy side.

Note also: the app currently connects as the **table owner**, and owners bypass RLS
unless `FORCE ROW LEVEL SECURITY` is set. The non-owner role split is still
outstanding — until then policies are inert, so this check matters even more.

---

## 5. Point-in-time recovery

### Targets (#675)

| Metric                | Target     | Today          |
| --------------------- | ---------- | -------------- |
| RPO (max data loss)   | 5 minutes  | up to 24 hours |
| RTO (time to restore) | 30 minutes | untested       |

### On managed hosting

Enable automated backups / instant-restore and set the retention window (30 days is
a reasonable default; longer costs more storage). Continuous WAL archiving is the
provider's responsibility. **The work becomes verification, not construction.**

### What a replica does NOT protect against

A read replica replicates a mistaken `DELETE` or a bad migration **instantly**. It
protects against host failure, not against logical damage. PITR is the only recovery
path for "someone deleted the wrong thing an hour ago" — and only if it is noticed
inside the retention window.

### Keep independent logical backups regardless

Retain the `pg_dump` → object-storage path (now with sha256 checksums), stored in a
**different cloud account from the database**. PITR does not protect against a
deleted instance, a compromised cloud account, or provider-side loss. This is the
3-2-1 rule and it still applies with managed hosting.

### Logical corruption is still the application's job

PITR and replicas do not prevent bad writes. These protections stay app-side and
are already shipped or in flight:

- **Audit immutability** — DB triggers refuse `UPDATE`, and `DELETE` requires a
  transaction-scoped opt-in (migration `0048`, ADR-0012).
- **Retention guards** — a jsonb setting of `"0"`, `"-30"` or `"abc"` could purge
  the entire trash or every soft-deleted row regardless of age (migration-era bug,
  fixed with validation plus a cutoff-must-be-in-the-past invariant).
- **Purge no longer blocked** — four `NO ACTION` foreign keys made permanent
  deletion impossible and rolled back the whole batch (migration `0049`).
- **Referential integrity + transactional writes** across the revenue chain.

---

## 6. Cutover runbook

1. **Provision** the managed instance, PostgreSQL 16 to match local/dev.
2. **Enable PITR / automated backups** and set the retention window. Do this first,
   before any data lands.
3. **Migrate schema** with `npm run db:migrate` (never `db:push` against
   production). Confirm `drizzle.__drizzle_migrations` records the full chain —
   `scripts/migrate.ts` previously seeded the wrong table, which made a `db:push`
   database replay `0000_init`.
4. **Load data** via `pg_dump`/`pg_restore` from the current primary. Take the dump
   from the **replica** to avoid loading the primary.
5. **Configure the pooler** — `DISCARD ALL` on connection return, then run the
   section 4 leak check. **Do not skip this.**
6. **Verify**, in this order:
   - `npm run db:verify-chain` — migration chain intact
   - `npm run db:verify-isolation` — RLS coverage
   - `npm run db:verify-integrity` — orphans, cross-tenant rows, audit chain
   - `npm run db:diagnose` — provisioning state
   - `GET /api/system/health` — pool, Redis, backups, migration version
   - the section 4 GUC leak check against the pooler endpoint
7. **Prove PITR for real.** Restore to a timestamp into a scratch instance and
   check row counts and audit-chain validity. A provider checkbox is not evidence;
   an actual restore is. Record the measured RTO here.
8. **Cut over** application `DATABASE_URL`, keeping the old primary read-only and
   intact until step 9 passes.
9. **Post-cutover:** run the step 6 checks again against production, watch error
   rates and pool saturation for 24 hours, then decommission the old primary and
   replica.
10. **Later:** the non-owner role split, then enable `FORCE ROW LEVEL SECURITY`.

### Rollback

Until step 9 completes, the old primary remains authoritative and intact — rollback
is repointing `DATABASE_URL` back. After the old primary is decommissioned, rollback
means a restore from the independent logical backup, which is why step 9 must
genuinely pass before step 10.

---

## 7. Open items

- Provider not final (Neon recommended; RDS if procurement/compliance requires).
- Measured RTO unknown until step 7 is performed.
- Non-owner role split and `FORCE ROW LEVEL SECURITY` still outstanding.
- ADR-0003 / migration `0045` live in the unmerged PR #753; the pooler guidance in
  section 4 depends on that landing.
