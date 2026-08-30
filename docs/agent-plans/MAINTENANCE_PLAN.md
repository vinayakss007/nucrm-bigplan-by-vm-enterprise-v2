<!--
  NuCRM Enterprise — Property of abetworks.in
  Copyright (c) 2026 abetworks.in. All Rights Reserved.
  Proprietary & confidential. Unauthorized copying or distribution is prohibited.
-->

# Maintenance Plan

> How to keep NuCRM healthy over time: dependencies, database, monitoring,
> security, performance, and technical-debt cadence. This is the operating
> playbook — for the deeper how-to on any single topic, follow the linked
> reference doc.
>
> **Prerequisite reading:** [`README.md`](./README.md) (hub) and
> [`../../AGENTS.md`](../../AGENTS.md) (mandatory rules + deploy notes).

---

## 0. Golden rules for any maintenance change

- Every change goes through a **branch + PR** (never `main` directly). One concern per PR.
- Run `npm run typecheck` **and** `npm run lint` before every push; both must be clean.
- For DB changes: generate a **migration**, never hand-edit tables or run `drizzle-kit push` in production.
- Prefer small, reversible changes. If a change is risky, gate it behind a **feature flag** (`lib/feature-flags.ts`) so it can be turned off without a deploy.
- Never break **tenant isolation** or the **AI-optional** invariant while "cleaning up".

---

## 1. Routine cadence

A suggested rhythm. Adjust to team capacity, but keep every row from silently lapsing.

| Cadence          | Task                                                                     | How                                                      |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| **Every PR**     | Typecheck + lint + relevant tests green                                  | `npm run typecheck && npm run lint && npm run test:unit` |
| **Weekly**       | Triage new issues; check error volume in Sentry                          | Sentry dashboard + `error_logs` table                    |
| **Weekly**       | Review dependency alerts (Dependabot/`npm audit`)                        | §2                                                       |
| **Monthly**      | Patch/minor dependency bumps                                             | §2                                                       |
| **Monthly**      | Review slow queries + DB size growth                                     | §3, §5                                                   |
| **Monthly**      | Verify a backup **restore** actually works (not just that backups exist) | §6                                                       |
| **Quarterly**    | Framework major upgrades (Next/React/Drizzle) behind a branch            | §2                                                       |
| **Quarterly**    | Tech-debt sweep (one focused PR per theme)                               | §7                                                       |
| **Continuously** | Keep this hub + `AGENTS.md` accurate                                     | §8                                                       |

---

## 2. Dependency maintenance

**Reference:** [`../planning/MAINTENANCE_UPDATE_GUIDE.md`](../planning/MAINTENANCE_UPDATE_GUIDE.md)

Current pinned majors (as of 2026-08-30): Next `16.3.3`, React `19.2.8`,
Drizzle ORM `0.45.2`, TypeScript `5.9.3`, Zod `4.4.3`.

**Patch/minor bumps (low risk):**

```bash
npm outdated                 # see what's behind
npm update <pkg>             # or bump the caret range in package.json
npm ci && npm run typecheck && npm run lint && npm run test:unit && npm run build
```

**Major bumps (Next/React/Drizzle/Zod — high risk):**

1. One dependency per branch/PR. Read the upgrade guide + breaking-change notes first.
2. Bump, `npm ci`, then fix the fallout in this order: typecheck → lint → build → tests.
3. Smoke-test critical flows locally (auth, a tenant list page, an API mutation, a cron route).
4. Never bump a framework major in the same PR as a feature.

**Lockfile discipline:** there is a single-lockfile guard in CI. Keep exactly one
`package-lock.json`; do not introduce `pnpm`/`yarn` lockfiles.

---

## 3. Database & migrations

**Reference:** [`../database-security.md`](../database-security.md),
[`../migration-chain-state.md`](../migration-chain-state.md),
[`../postgres-hosting-and-recovery.md`](../postgres-hosting-and-recovery.md)

- Schema lives in `drizzle/schema/*.ts` (one file per domain; `index.ts` re-exports).
- **Always** use proper migrations:
  ```bash
  npm run db:generate     # create a migration from schema changes
  npm run db:migrate      # apply pending migrations
  npm run db:status       # confirm state / see pending
  npm run db:verify-chain # detect journal gaps/duplicates
  npm run db:drift-check  # detect schema drift vs migrations
  ```
- `drizzle-kit push` (`db:sync`) is **dev/CI only** and is guarded — it must never touch production.
- After a change, verify tenant isolation & integrity where relevant:
  ```bash
  npm run db:verify-isolation
  npm run db:verify-integrity
  ```
- **Multi-table writes** must be wrapped in a transaction (`db.transaction(...)` / `lib/api/with-transaction.ts`). Partial writes corrupt data.

---

## 4. Monitoring & observability

**Reference:** [`../../.kiro/steering/global-standards.md`](../../.kiro/steering/global-standards.md), `monitoring/` (Prometheus/Grafana/Alertmanager/Promtail via Docker)

- **Errors → `logError`** (`@/lib/errors-server`): persists to the `error_logs` table, forwards to Sentry, and correlates by `requestId` (from AsyncLocalStorage). Never use raw `console.error` in API routes.
  - Levels: `warning` (best-effort/expected), `error` (default), `fatal` (request-killing).
  - Pass `tenantId` / `userId` when in scope so logs are attributable.
- **Sentry** is wired via `sentry.{client,server,edge}.config.ts` + `instrumentation.ts`. Keep `SENTRY_DSN` set in prod; `SENTRY_ENABLE=false` disables tracking (see Issue #1039).
- **Health check:** `GET /api/health` — the deploy pipeline gates on it. Keep it cheap and dependency-aware.
- **Metrics:** Prometheus endpoint + Grafana dashboards live under `monitoring/`. Metrics run in Docker; the app itself runs under **pm2** (see deploy notes in `AGENTS.md`).

---

## 5. Performance upkeep

**Reference:** [`.kiro/steering/global-standards.md` §2](../../.kiro/steering/global-standards.md)

- **Query budget:** statement timeout 10s; investigate anything > 200ms. Use `npm run` slow-query tooling / DB logs.
- **Connection pooling:** always use the singleton pool (`lib/db/pool.ts`). Never `new Pool()` in a request path (cron jobs may, with try/finally cleanup).
- **N+1:** batch queries; watch list pages and dashboards. Several past issues (#664, GDPR/SOC2 N+1) came from per-row queries.
- **Client data fetching:** the codebase is migrating toward TanStack Query; avoid adding new raw `fetch + useEffect` list loaders where a shared hook exists (Issue #1328).
- **Caching:** cache keys MUST be tenant-scoped (`tenant:{tenantId}:{resource}`). See `lib/cache/`.

---

## 6. Backups & disaster recovery

**Reference:** [`../DISASTER-RECOVERY.md`](../DISASTER-RECOVERY.md), [`../runbooks/`](../runbooks/)

- Automated backups run via cron routes (`app/api/cron/backup`, `auto-backup`) + a scheduled `backup-verify` job in production.
- **A backup you have never restored is not a backup.** Monthly, perform a real restore into a scratch DB and confirm row counts / a login.
- Off-site (S3) upload is best-effort with local fallback; a failed upload must not mark a successful backup as failed (see `cron/backup`).
- Keep encryption keys (`ENCRYPTION_KEY`) and DB credentials out of the repo — read from env.

---

## 7. Technical-debt cadence

Do debt in **focused, single-theme PRs** — not sweeping mega-changes. Established, trackable themes (each an open issue):

| Theme                                    | Issue        | Approach                                                                             |
| ---------------------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| Remove `any` / `eslint-disable` in pages | #1341, #1268 | Type properly; align interfaces with real DB shapes. One cohesive file-group per PR. |
| `console.error` → `logError`             | #1063        | Migrate one route group at a time (auth done #1690; cron done).                      |
| Raw `fetch`+`useEffect` → TanStack Query | #1328        | Migrate per page/module; keep loading/empty/error states.                            |
| Files > 500 lines                        | #422         | Split into smaller modules without behavior change.                                  |
| Missing `loading.tsx` / `error.tsx`      | #654         | Add per route segment.                                                               |

**Golden rule for debt PRs:** _no behavior change on the happy path._ Prove it
with `typecheck` + `lint` (+ tests) and say so in the PR body.

> **Audit tip:** before "fixing" a whole issue, check whether prior PRs already
> resolved most of it — several audit issues (#1075, #1071, #1115) were largely
> done, and the valuable move was to find the one genuine remaining gap and fix
> that in a tight PR. Report what was already done.

---

## 8. Keeping the docs true

- When you change a convention, deploy step, or command, **update this plan and
  the hub in the same PR**. Stale docs are worse than none.
- `AGENTS.md` carries live operational facts (deploy host, running URL, pm2
  commands). If those change, update `AGENTS.md`, not this file.
- The `docs/planning/` directory has many historical/dated plans; treat them as
  archive/reference, not current truth. This hub is the current truth.

---

## 9. Pre-flight checklist (paste into your PR)

```
[ ] Branched off main; PR targets main; one concern only
[ ] npm run typecheck  → 0 errors
[ ] npm run lint       → clean
[ ] Relevant tests run (unit/integration) and pass
[ ] DB change? migration generated + db:status clean + isolation/integrity verified
[ ] Errors use logError (not console.error); tenantId/userId passed where known
[ ] Risky change gated behind a feature flag
[ ] No tenant-isolation or AI-optional invariant broken
[ ] Docs updated if a convention/command/deploy step changed
```

---

_Last reviewed: 2026-08-30._
