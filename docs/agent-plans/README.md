<!--
  NuCRM Enterprise — Property of abetworks.in
  Copyright (c) 2026 abetworks.in. All Rights Reserved.
  Proprietary & confidential. Unauthorized copying or distribution is prohibited.
-->

# Agent Plans — Onboarding & Working Hub

> **Start here.** This directory is the single authoritative entry point for any
> engineer or AI agent picking up work on NuCRM. Read this page top-to-bottom
> once, then jump to the specific plan you need. It exists so that _any agent
> starting cold gets the whole picture_ without spelunking through 70+ scattered
> markdown files.

NuCRM is a **multi-tenant enterprise SaaS CRM** — Next.js 16 (App Router,
React 19), PostgreSQL + Drizzle ORM, TypeScript 5.9, Zod 4. It is self-hosted,
module-gated, and ships a workflow engine, plugin engine, billing, and
deterministic-first AI. There are ~215 database tables.

---

## 1. The 60-second orientation

| You want to…                                                   | Read this                                                                               |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Understand how the codebase is laid out                        | [`PROJECT_MAP.md`](./PROJECT_MAP.md)                                                    |
| Keep the app healthy (deps, migrations, monitoring, tech debt) | [`MAINTENANCE_PLAN.md`](./MAINTENANCE_PLAN.md)                                          |
| Add a new feature or module end-to-end                         | [`FEATURE_ADDITION_PLAN.md`](./FEATURE_ADDITION_PLAN.md)                                |
| Know the mandatory rules (PR policy, branch names, deploy)     | [`../../AGENTS.md`](../../AGENTS.md)                                                    |
| Know the engineering standards (isolation, perf, AI policy)    | [`../../.kiro/steering/global-standards.md`](../../.kiro/steering/global-standards.md)  |
| Understand the architecture in depth                           | [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)                                        |
| Run/fix a production incident                                  | [`../runbooks/`](../runbooks/) and [`../DISASTER-RECOVERY.md`](../DISASTER-RECOVERY.md) |

---

## 2. Non-negotiable rules (read before writing any code)

These are enforced across the whole project. Violating them will get a PR rejected.

1. **Never push to `main`.** Always branch (`fix/<desc>` or `feat/<desc>`) and open a PR targeting `main`. One issue per PR. (See [`AGENTS.md`](../../AGENTS.md).)
2. **Tenant isolation is sacred.** Every query on tenant data MUST filter by `tenant_id` (or run under RLS via the connection-pinning wrappers). Never leak one tenant's data to another.
3. **Deterministic-first.** Layout, colors, forecasting, aggregation, NL→SQL, anomaly detection MUST be deterministic. AI is _not_ load-bearing — the product must work fully with AI disabled, and every AI use needs a deterministic fallback.
4. **No stubs in production paths.** No mocks, fakes, or placeholder code that ships.
5. **Structured errors.** Use `logError` from `@/lib/errors-server` (server) / `@/lib/errors-client` (client), not raw `console.error`, in API routes. (Issue #1063.)
6. **Verify before claiming done.** Run `npm run typecheck` and `npm run lint` (and relevant tests) — a command exiting 0 is not proof the task is complete; check the actual result against the request.

---

## 3. The core toolchain (commands you will actually use)

```bash
# One-time / per-session (this sandbox uses nvm)
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22

npm ci                 # install deps (clean)
npm run dev            # local dev server (localhost:3000) — NOT for CI/agents
npm run build          # production build (~5 min; large project)
npm run typecheck      # tsc --noEmit — MUST be 0 errors
npm run lint           # eslint . — MUST be clean
npm run test:unit      # fast unit tests (vitest run)
npm run test:integration
npm run db:migrate     # apply Drizzle migrations (NEVER use drizzle-kit push in prod)
npm run db:status      # migration status
npm run seed:dev       # seed demo data
```

> **Agent note:** never run long-lived processes (`npm run dev`, watch modes) in
> an automated session — they block. Use one-shot commands (`vitest run`,
> `next build`) instead.

---

## 4. How the plans fit together

```
                       docs/agent-plans/README.md   ← you are here (index)
                        │
       ┌────────────────┼─────────────────────┐
       ▼                ▼                       ▼
 PROJECT_MAP.md   MAINTENANCE_PLAN.md    FEATURE_ADDITION_PLAN.md
 (where things    (keep it healthy       (ship new capability
  live & why)      over time)             end-to-end)
       │                │                       │
       └────────────────┴───────────┬───────────┘
                                     ▼
              AGENTS.md  +  .kiro/steering/global-standards.md
                     (mandatory rules & standards)
```

- **PROJECT_MAP** answers _"where is X and what pattern does it follow?"_
- **MAINTENANCE_PLAN** answers _"what recurring work keeps this alive, and how do I do it safely?"_
- **FEATURE_ADDITION_PLAN** answers _"I have a new feature — what are the exact steps from schema to PR?"_

---

## 5. Related existing docs (kept, not replaced)

This hub links out to the deeper reference docs rather than duplicating them:

- **Architecture:** [`ARCHITECTURE.md`](../../ARCHITECTURE.md), [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)
- **Maintenance/upgrades reference:** [`docs/planning/MAINTENANCE_UPDATE_GUIDE.md`](../planning/MAINTENANCE_UPDATE_GUIDE.md)
- **Deploy:** [`DEPLOYMENT.md`](../../DEPLOYMENT.md), and the deploy section of [`AGENTS.md`](../../AGENTS.md)
- **Security:** [`docs/SECURITY-ANALYSIS.md`](../SECURITY-ANALYSIS.md), [`docs/database-security.md`](../database-security.md)
- **Disaster recovery:** [`docs/DISASTER-RECOVERY.md`](../DISASTER-RECOVERY.md), [`docs/runbooks/`](../runbooks/)
- **API contract:** [`docs/api-envelope-state.md`](../api-envelope-state.md), [`docs/API_MIGRATION_v1_to_v2.md`](../API_MIGRATION_v1_to_v2.md)
- **Product direction:** [`docs/PRODUCT_VISION.md`](../PRODUCT_VISION.md)
- **Scaling:** [`.kiro/steering/scaling-strategy.md`](../../.kiro/steering/scaling-strategy.md)

> If you find a plan here contradicts a deeper doc, the deeper reference doc
> wins for detail — update this hub to point at it rather than forking the truth.

---

_Last reviewed: 2026-08-30. Keep the tables in this file current; it is the first
thing every new agent reads._
