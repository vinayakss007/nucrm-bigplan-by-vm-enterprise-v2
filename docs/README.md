# NuCRM Documentation Index

This is the map of the documentation tree: 182 Markdown files under `docs/`, 235 in the repo outside
`node_modules`. It exists because mtime proves nothing here — nearly every file carries `09-14 07:44`
from a bulk touch, while the code kept moving for three weeks after it.

**The rule: a doc not listed below as living reference is a historical artifact. Do not quote it as current state.**

## Read this first

Ordered. Each row says what you get from the file.

| #   | File                                                                        | Why                                                                |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | [`AGENTS.md`](../AGENTS.md)                                                 | Host facts, runtime topology, the guards that will fail your build |
| 2   | [`README.md`](../README.md)                                                 | What the product is, how to run it, current counts                 |
| 3   | [`ARCHITECTURE.md`](../ARCHITECTURE.md)                                     | Multi-tenancy model, request lifecycle, layer boundaries           |
| 4   | [`docs/COMPONENTS.md`](./COMPONENTS.md)                                     | Component inventory, which components are load-bearing             |
| 5   | [`docs/migration-chain-state.md`](./migration-chain-state.md)               | The five migration-chain defects and their baseline                |
| 6   | [`docs/infra/PREPROD-ISSUE-REGISTER.md`](./infra/PREPROD-ISSUE-REGISTER.md) | Every open defect with its evidence, numbered PP-nnn               |
| 7   | [`docs/adr/README.md`](./adr/README.md)                                     | Decisions taken, and the ruling on the 0001–0006 collisions        |

## Living reference

These describe the system as it runs. `verified` is the date someone last re-measured the file against
the tree and the live preprod database — not the date it was written.

| File                                                                        | Verified                                  |
| --------------------------------------------------------------------------- | ----------------------------------------- |
| [`README.md`](../README.md)                                                 | 2026-10-04                                |
| [`AGENTS.md`](../AGENTS.md)                                                 | 2026-10-04                                |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md)                                     | 2026-10-04                                |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md)                                     | 2026-10-04                                |
| [`docs/COMPONENTS.md`](./COMPONENTS.md)                                     | 2026-10-04                                |
| [`docs/adr/README.md`](./adr/README.md)                                     | 2026-10-04                                |
| [`docs/migration-chain-state.md`](./migration-chain-state.md)               | 2026-10-04                                |
| [`docs/reference/data-model.md`](./reference/data-model.md)                 | 2026-10-04                                |
| [`docs/admin/architecture.md`](./admin/architecture.md)                     | 2026-10-04, counts only — see Known-stale |
| [`docs/infra/PREPROD-ISSUE-REGISTER.md`](./infra/PREPROD-ISSUE-REGISTER.md) | 2026-10-04                                |

Those ten were re-measured against `package.json`, `drizzle/schema/`, `drizzle/migrations/` and the
preprod database on 2026-10-04. The numbers they carry are reproducible by the commands in
"How current is 'current'?" below.

Two files are current by definition, being the implementation rather than a description of it:
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) enforces **24** of the `guard:*` aliases by name —
`guard:any-suppressions`, `guard:boundaries`, `guard:catch-empty`, `guard:chain`, `guard:coords`, `guard:counters`, `guard:cron-lock`,
`guard:csrf`, `guard:csv`, `guard:field-permissions`, `guard:filesize`, `guard:jsonb-size`, `guard:migration-rls`, `guard:override-ranges`,
`guard:panel-error-state`, `guard:portal-rls-context`, `guard:portal-softdelete`, `guard:public-projection`, `guard:public-ratelimit`,
`guard:raw-sql`, `guard:rls`, `guard:rollback-coverage`, `guard:schemas` and `guard:vocab` — plus **3** run as bare commands (`ci.yml:221`, `:254`, `:447`)
and **3** more by alias in `nightly-soak.yml` (`guard:catalog-grants`, `guard:register-drift`, `guard:running-config`).
`package.json` defines **31** aliases in total, so exactly **1** — `guard:migration-redecl` — has no workflow step, and its
redeclaration screen is asserted from a unit test instead (`tests/unit/super-admin-audit-text-2510.test.ts:139`, which re-derives
the whole set against the migration directory). `guard:vocab` joined the wired set on 2026-10-25, when **#3241** appended the
`constraint-vocab` job; the paragraph said **16 + 2** on 2026-10-10 and **20 + 3** on 2026-10-19 (it said 7 when first written),
and the six additions since those measurements are #2832, #2828, #3167, #3241, #3284 and #3283.
[`scripts/migration-chain-baseline.json`](../scripts/migration-chain-baseline.json) holds the five
baselined chain defects. `npm run db:verify-isolation` is **not** in CI — nothing runs it on a push.

## Historical, do not treat as current

The bulk of the tree: frozen snapshots of workstreams that ended, most before the 0.9.0 line.

| Path                                                                                                                                              | Files                    | What it is                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| [`docs/planning/`](./planning/)                                                                                                                   | 61 (50 `.md`, 11 `.txt`) | Build plans, trackers, gap analyses from earlier cycles                   |
| [`docs/audits/`](./audits/)                                                                                                                       | 5                        | Point-in-time audits dated 2026-08-23 and 2026-08-27                      |
| [`docs/agent-plans/`](./agent-plans/) · [`docs/archived/`](./archived/)                                                                           | 4 · 2                    | Plans for closed agent tasks; superseded issue lists                      |
| [`.agents/tasks/`](../.agents/tasks/)                                                                                                             | 125 in 29 dirs           | Per-task notes of completed agent runs                                    |
| [`.github/ISSUES/`](../.github/ISSUES/)                                                                                                           | 6                        | Issue drafts, several filed for real elsewhere                            |
| [`docs/E2E-VERIFICATION-2026-08-29.md`](./E2E-VERIFICATION-2026-08-29.md) · [`docs/SECURITY-AUDIT-2026-08-07.md`](./SECURITY-AUDIT-2026-08-07.md) | 1 · 1                    | Results for a tree that no longer exists; findings predating the RLS work |
| [`docs/SESSION-SUMMARY.md`](./SESSION-SUMMARY.md) · [`docs/PLAN-FOR-TOMORROW.md`](./PLAN-FOR-TOMORROW.md)                                         | 1 · 1                    | One day's notes; a plan for a tomorrow that has passed                    |
| `docs/planning/TODO-tomorrow.md` · `TODO_TOMORROW.md` · `TOMORROW.md`                                                                             | 3                        | Three near-identical "tomorrow" lists, all stale                          |
| [`docs/DEEP-SCAN-ARCHITECTURE-AUDIT.md`](./DEEP-SCAN-ARCHITECTURE-AUDIT.md) · [`EXPERT-AUDIT-REPORT.md`](../EXPERT-AUDIT-REPORT.md)               | 1 · 1                    | Audits of an earlier tree shape, superseded                               |
| [`BILLING-VERIFICATION-PLAN-1477.md`](../BILLING-VERIFICATION-PLAN-1477.md) · [`docs/billing-lifecycle-test.md`](./billing-lifecycle-test.md)     | 1 · 1                    | Plan and test script for issue #1477, both executed                       |
| [`futureplan/`](../futureplan/)                                                                                                                   | 2                        | Third-party AI integration comparison, never scheduled                    |

**Why they are kept rather than deleted.** The register states the rule — a fixed entry stays because
the evidence is what makes it useful as a learning document, and because the companion lessons doc
references it — at `docs/infra/PREPROD-ISSUE-REGISTER.md:5425` (the bullet beginning `- **Fixed issue** → keep the entry (do not delete)` — that text is the anchor if the number has moved again; re-pinned from `:5312` when this **#2578**/**PP-077** merge added its header bullet, summary row and section above the rule), re-pinned by **PP-076**, after
**PP-073**, **PP-065**, **PP-074**, **PP-070** and **#2566**'s register-only addendum moved it.
The pointer it replaced (`:1598`) had drifted 2,315 lines and was still naming a `**Files:**` entry
inside PP-040, because `guard:coords` reads the citations the register makes _outward_ and never the
ones other documents make _into_ it; merging PP-064, then PP-066, PP-067 and PP-068, then
**#2511**'s own PP-061 bullet, then **#2531**'s PP-069, **#2548**'s PP-071, **#2558**'s PP-072,
**#2567**'s PP-073, **#2507**'s PP-065, **#2526**'s PP-074, **#2534**'s PP-070, **#2566**'s
addendum and this **#2561**/PP-076 entry each moved the rule again before this line was committed,
so the re-pin has now run seventeen times on this tree. **#2569**
(**PP-075**) is the last open PR whose own text re-pins this sentence, still writing the number from its own tree, so whoever merges last re-measures. Same here — these files are cited by PP numbers, ADRs, commit messages and each
other. `MASTER_PLAN.md` and `ISSUES.md` read like current state and are not; that is a labelling
failure, and the fix is labelling, not `rm`.

**The test for history.** A date in the filename or title means history. A doc describing work that
has not shipped means history. A doc quoting a count means: re-measure before you repeat it.

## Duplicates and collisions

Same subject, several files. Pick the left-hand one.

| Collision             | Files                                                                                                                                                                                                                           | Resolution                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR numbers 0001–0006 | 12 files in [`docs/adr/`](./adr/)                                                                                                                                                                                               | Ruled in [`docs/adr/README.md`](./adr/README.md): 0001 is one decision recorded twice, 0003–0006 are different decisions sharing a number. Not renumbered — that breaks git and PP references |
| Architecture          | [`ARCHITECTURE.md`](../ARCHITECTURE.md) vs [`docs/planning/ARCHITECTURE.md`](./planning/ARCHITECTURE.md)                                                                                                                        | Root is living, planning copy is history                                                                                                                                                      |
| Production checklist  | [`PRODUCTION_CHECKLIST.md`](../PRODUCTION_CHECKLIST.md) vs [`docs/planning/PRODUCTION_CHECKLIST.md`](./planning/PRODUCTION_CHECKLIST.md)                                                                                        | Root is nearer; neither re-measured today                                                                                                                                                     |
| Deployment            | [`DEPLOYMENT.md`](../DEPLOYMENT.md) · [`docs/admin/deployment.md`](./admin/deployment.md) · [`deploy/DEPLOYMENT_INTERNAL.md`](../deploy/DEPLOYMENT_INTERNAL.md) · [`deploy/DEPLOYMENT_PATHS.md`](../deploy/DEPLOYMENT_PATHS.md) | Four documents, one system. Read `AGENTS.md` for topology, then `deploy/DEPLOYMENT_PATHS.md`                                                                                                  |
| Preprod issues        | [`docs/infra/issues/`](./infra/issues/) (14 files, PP-010…PP-022) vs the register                                                                                                                                               | The register owns those numbers; the per-file payloads are drafts of already-filed entries                                                                                                    |
| Postgres hosting      | [`docs/postgres-hosting-and-recovery.md`](./postgres-hosting-and-recovery.md) vs [`deploy/POSTGRES_PRODUCTION_GUIDE.md`](../deploy/POSTGRES_PRODUCTION_GUIDE.md)                                                                | Adjacent guidance, neither re-measured; treat both as unverified                                                                                                                              |

## Known-stale or unverified

Not re-measured on 2026-10-04. The prose may be right; any number in them may have drifted. This is a
statement that nobody has checked, not a verdict that they are wrong.

| File                                                                                                                                                        | Concern                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`DEPLOYMENT.md`](../DEPLOYMENT.md)                                                                                                                         | pm2 and [`ecosystem.config.cjs`](../ecosystem.config.cjs) describe the production VM, not this host, which runs Docker                                                              |
| [`docs/admin/contributing-and-operations.md`](./admin/contributing-and-operations.md)                                                                       | Same VM assumption                                                                                                                                                                  |
| [`docs/admin/architecture.md`](./admin/architecture.md)                                                                                                     | Counts verified 2026-10-04; its deployment section still describes the VM shape and conflicts with this host                                                                        |
| [`docs/admin/monitoring.md`](./admin/monitoring.md) · [`docs/admin/runbooks.md`](./admin/runbooks.md) · [`docs/admin/backups-dr.md`](./admin/backups-dr.md) | Container set here is larger than documented; runbooks not walked and restore paths not re-tested since preprod bring-up                                                            |
| [`docs/reference/module-authoring.md`](./reference/module-authoring.md)                                                                                     | Not checked against current module registration                                                                                                                                     |
| [`docs/reference/roadmap.md`](./reference/roadmap.md)                                                                                                       | Forward-looking by definition; do not read as scope                                                                                                                                 |
| [`docs/public/`](./public/) (28 files)                                                                                                                      | **Customer-facing.** A wrong number here is not internal confusion, it is a false statement made to tenants. Different blast radius from the rest of this tree, and not re-measured |

## How current is "current"?

Every count above came from these commands. Run them before quoting a number, including these.
The comments below were re-run 2026-10-25 against `33f0b7306`; the ones that had not moved
(`app/tenant` pages, `app/superadmin` pages, schema files, the version, the Radix count, the `.spec.ts`
count) keep their numbers, and the ones that had are corrected — the file was quoting a 2026-10-04 tree.

```sh
cd /srv/nucrm
find app/api -name route.ts | wc -l                       # 514 API routes (was 507)
find app/tenant -name page.tsx | wc -l                    # 149 tenant pages
find app/superadmin -name page.tsx | wc -l                # 31 · app/portal: 9
find tests -name '*.test.*' | wc -l                       # 919 (was 462; Playwright .spec.ts excluded: 7)
ls drizzle/schema/*.ts | wc -l                            # 46 schema files
ls drizzle/migrations/*.sql | wc -l                       # 277 total .sql (was 213)
ls drizzle/migrations/*.sql | grep -v '\.down\.sql' | wc -l   # 139 up-migrations (was 107)
node -pe "require('./drizzle/migrations/meta/_journal.json').entries.length"   # 139 journal entries (was 105)
node -pe "Object.keys(require('./package.json').scripts).length"               # 121 scripts (was 96)
node -pe "require('./package.json').version"                                   # 0.9.0
node -pe "Object.keys(require('./package.json').dependencies).filter(k=>k.startsWith('@radix-ui/')).length"   # 13
# distinct declared table names; plain grep -o misses one multi-line declaration:
perl -0777 -ne 'while(/pgTable\(\s*[\x27"]([a-z0-9_]+)[\x27"]/g){print "$1\n"}' drizzle/schema/*.ts | sort -u | wc -l   # 226 (was 224)
```

Preprod database, measured 2026-10-04 and **not re-run since** — PP-057 counts a 30-odd-entry backlog
against that database, so read every number in this block as a snapshot, not as current state.
`DATABASE_URL` names host `pgbouncer`, which resolves only inside the app network, so
query through the container:

```sh
set -a; . ./.env; set +a
docker exec -e DATABASE_URL nucrm-app psql "$DATABASE_URL" -tAc "select version()"   # PostgreSQL 18.6
docker exec -e DATABASE_URL nucrm-app psql "$DATABASE_URL" -tAc "select count(*) from pg_tables where schemaname='public'"   # 226
docker exec -e DATABASE_URL nucrm-app psql "$DATABASE_URL" -tAc "select count(*), count(distinct tablename) from pg_policies where schemaname='public'"   # 277 | 225
# tables with no policy at all → ai_providers, the only one of 226 with neither RLS nor a policy
docker exec -e DATABASE_URL nucrm-app psql "$DATABASE_URL" -tAc "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname not in (select tablename from pg_policies where schemaname='public')"
```

That last comment is true of that 2026-10-04 snapshot and of the repository no longer:
[`drizzle/migrations/0115_rls_view_hardening.sql`](../drizzle/migrations/0115_rls_view_hardening.sql)
adds two policies to `ai_providers`, so the line stays accurate on preprod only while `0115` sits in
PP-057's outstanding pile — and PP-057 measured that pile and recorded `0115`'s absence as **not** a live
cross-tenant read: it is defence-in-depth for a topology where the view's own definition already narrows
the row set. Say it that way or the next reader will price it as a leak.

What this section used to claim — "226 tables against 224 declared is two tables no schema file declares,
`ai_providers` and `tenant_ai_credentials`, read by no application code" — is superseded twice over: the
perl command above now prints **226**, because both are declared in
[`drizzle/schema/ai.ts`](../drizzle/schema/ai.ts) at `:324` and `:347`, and `ai_providers` is read by
`app/api/tenant/admin/ai-providers/route.ts`, `app/api/tenant/ai/status/route.ts` and
`lib/ai/gateway.ts`. The declared count and the snapshot count coinciding at 226 is arithmetic, not
evidence — they were measured against different things (the schema directory and a 2026-10-04 database),
so a rebuild should re-run both before drawing any conclusion from the equality. Register entries
PP-040, PP-041, PP-042 remain the record of what the gap was.

```sh
npm run guard:chain                                  # detects all 5 chain defects, baselines all 5
node -e 'const b=require("fs").readFileSync(".github/workflows/ci.yml","utf8").split("\n").filter(l=>!/^\s*#/.test(l)).join("\n");const g=new Set([...b.matchAll(/npm run (guard:[a-z-]+)/g)].map(m=>m[1]));console.log(g.size+"/"+Object.keys(require("./package.json").scripts).filter(k=>k.startsWith("guard:")).length+" guard aliases ci.yml runs")'   # THIS is the census check: the A/B it prints must equal the count the "current by definition" paragraph carries. Counting grep lines is not a check — `grep -c "run: npm run guard" .github/workflows/ci.yml` counts LINES, `ci.yml:81` chains three aliases behind `&&` and `:85` chains two, and a guard invoked inside a `run: |` block is invisible to it as well, because the pattern sits on the `run: |` line and not on the command line. It answers 18 where 22 are wired. Re-measure the paragraph from this line and never from a grep.
# which file wires which — per-file totals, not the union, so `ci.yml`'s line and
# `nightly-soak.yml`'s overlap by design:
node -e 'const fs=require("fs");const a=Object.keys(require("./package.json").scripts).filter(k=>k.startsWith("guard:"));
for(const f of fs.readdirSync(".github/workflows")){const b=fs.readFileSync(".github/workflows/"+f,"utf8");
const n=a.filter(x=>b.includes("npm run "+x));if(n.length)console.log(f.padEnd(20),n.length+"/"+a.length);}'
command -v pm2 || echo "pm2 not installed"           # on this host: not installed
docker ps --format '{{.Names}}'                      # nucrm-app, nucrm-nginx, nucrm-pgbouncer + monitoring
```

Why the census is measured by alias and not by line, and why this block used to carry a `grep` that
under-counted: GitHub runs each `run:` block as one shell, so a step may chain several guards onto a
single line — `ci.yml:81` runs three and `:85` runs two — and a line-anchored `grep 'run: npm run guard'`
sees only the first alias on each. It prints 18 lines today for the **22** distinct aliases the first
command above counts, and it once printed 7 on a much smaller tree, which is how the paragraph came to
name fewer guards than CI actually runs. The `grep` line is gone from this document on purpose: a command
whose output is a trap belongs in prose, not in a copy-pasteable block. The second command answers a
different question — which file wires which, at per-file totals, so its `ci.yml` line and the first
command agree at 22 while `nightly-soak.yml`'s 3 overlap with them by design.

Two topologies, one repo. This host runs Docker Compose
([`deploy/docker-compose.production.yml`](../deploy/docker-compose.production.yml) plus the
[`deploy/docker-compose.preprod.yml`](../deploy/docker-compose.preprod.yml) overlay,
`PGBOUNCER_ENABLED=true`). The separate production VM targeted by
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) runs pm2, where the live app has been
`nucrm-prod` (`next start -p 3099`) while [`ecosystem.config.cjs`](../ecosystem.config.cjs) declares
`web` on `PORT=3000` — the workflow gates on whichever exists. Neither description generalises to the
other; `AGENTS.md` states both.

---

_Product version: **0.9.0** · Next.js 16.4.2 · React 19.3.1 · TypeScript 5.9.3 · Tailwind CSS 3.4.19 ·
PostgreSQL 18.6 behind PgBouncer 1.23.1 · Drizzle ORM ^0.45.4 / drizzle-kit ^0.31.11 · BullMQ 6.3.15 /
ioredis 5.11.1 · Zod ^4.6.7 · Vitest ^5.0.0 / Playwright ^1.62.1._

_Counts re-measured 2026-10-25 against the tree at `33f0b7306`: every version above is read from
`package.json` except the two server packages — PostgreSQL and PgBouncer come from the 2026-10-04 preprod
snapshot and have not been re-run. Anything older than that date in this tree is a claim you should
re-run before quoting._
