# Contributing & Operations Handbook

The engineering + operations "must-knows" for anyone working on NuCRM: the mandatory PR policy,
engineering standards, the day-to-day toolchain, the per-fix workflow, and the **live deploy
facts**.

> **Source of truth.** The authoritative, always-current versions of these rules live in
> [`AGENTS.md`](../../AGENTS.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md), and the onboarding hub
> [`docs/agent-plans/`](../agent-plans/README.md). This page consolidates and cross-links them; if
> anything here disagrees with those files, **they win** — update this page to match.

---

## 1. Mandatory PR policy

> ⚠️ These are enforced. Violating them gets a PR rejected.

1. **Never commit or push directly to `main`.** Always create a feature branch and open a PR.
2. **Branch naming:** `fix/<short-description>` or `feat/<short-description>`
   (e.g. `fix/touch-targets`).
3. **PR base:** always target `main`.
4. **Test after every fix:** run `postman/full-test-suite.sh` and verify a 100% pass rate before
   pushing.
5. **One issue per PR** — keep PRs focused and reviewable.
6. **Do not merge** — open the PR and wait for review.

---

## 2. Non-negotiable engineering standards

1. **Tenant isolation is sacred.** Every query on tenant data must filter by `tenant_id` (or run
   under RLS via the connection-pinning wrappers). Never leak one tenant's data to another. See
   [Security & Compliance](./security.md#tenant-isolation-critical).
2. **Deterministic-first.** Layout, colors, forecasting, aggregation, NL→SQL, and anomaly detection
   must be deterministic. **AI is not load-bearing** — the product must work fully with AI disabled,
   and every AI use needs a deterministic fallback.
3. **No stubs in production paths.** No mocks, fakes, or placeholder code that ships.
4. **Structured errors.** Use `logError` from `@/lib/errors-server` (server) / `@/lib/errors-client`
   (client) in API routes — not raw `console.error`.
5. **Verify before claiming done.** Run `npm run typecheck` and `npm run lint` (and relevant tests);
   a command exiting `0` is not proof the task is complete — check the result against the request.
6. **TypeScript strict**, no `any` in new code; typed props/interfaces throughout.

### Database standards

- Every tenant-scoped table must have `tenantId` and audit columns (`utils.audit()`); use the
  factory functions in `drizzle/schema/utils.ts`.
- Add a GIN index on any `jsonb` metadata column.
- Every migration must have a rollback plan. Use **Drizzle migrations** (`npm run db:migrate`) —
  **never** `drizzle-kit push` in production.

### API route pattern

```ts
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // implementation
  } catch (err) {
    return apiError(err); // Never leak err.message
  }
}
```

### Components

- Server components for data fetching; client components (`'use client'`) for interactivity.
- Use `Suspense` for async loading; every page should have `loading.tsx` and `error.tsx`.

---

## 3. Toolchain (commands you'll actually use)

```bash
# Per-session (this environment uses nvm)
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22

npm ci                 # clean install
npm run build          # production build (~5 min; large project)
npm run typecheck      # tsc --noEmit — MUST be 0 errors
npm run lint           # eslint . — MUST be clean
npm run test:unit      # fast unit tests
npm run test:integration
npm run db:migrate     # apply Drizzle migrations (NOT drizzle-kit push)
npm run db:status      # migration status
npm run seed:dev       # seed demo data
```

> **Never run long-lived processes** (`npm run dev`, watch modes) in an automated session — they
> block. Use one-shot commands (`vitest run`, `next build`).
>
> **Never run two `npm run build`s concurrently** — they corrupt `.next` (module-not-found
> `.external` errors). Always `rm -rf .next` before a clean rebuild.

---

## 4. Workflow per fix

```text
1. git checkout main && git pull
2. git checkout -b fix/<description>
3. Make changes
4. Run the test suite: bash postman/full-test-suite.sh
5. Verify 100% pass (0 failures)
6. git add -A && git commit -m "fix: <description> (Fix #N)"
7. git push origin fix/<description>
8. Open a PR via the GitHub API targeting main
9. Do NOT merge — wait for review
```

Testing expectations (see [`CONTRIBUTING.md`](../../CONTRIBUTING.md)):

- Write tests for all new validation schemas.
- Test multi-tenant isolation for any new data access.
- Coverage: **100% on new `lib/` files**, ~70% overall; coverage must not decrease.
- No `console.log` in production code; add a changelog entry.

---

## 5. Live environment & deploy facts

> ⚠️ **Read this before touching deploy.** These reflect the real running environment and change
> over time — always re-check against [`AGENTS.md`](../../AGENTS.md), which is kept current.

| Fact | Detail |
| --- | --- |
| **Process manager** | App runs via **pm2** (`nucrm-prod`, `next start -p 3099` behind nginx on 80/3000) — **not Docker**. Docker hosts only the monitoring stack (Prometheus/Grafana/Promtail/Alertmanager). |
| **pm2 auto-start** | Enabled on boot. |
| **Deploy host** | The **deploy host is the dev machine** itself. The Deploy workflow (`.github/workflows/deploy.yml`) SSHes in, checks out the CI-tested commit, runs `npm ci` + `npm run build`, `pm2 restart web`, gates on `127.0.0.1:3099/api/health`, rolls back on failure, then returns the repo to `main`. |
| **Ephemeral IP** | The VM's external IP **changes on every reboot**. When deploy fails with `dial tcp ...:22: connection refused/timeout`, run `curl -s ifconfig.me`, then `gh secret set DEPLOY_HOST --body "<new-ip>"`. |
| **Detached HEAD risk** | The deploy's `git checkout --force <sha>` can leave the repo in detached HEAD. If you see `## HEAD (no branch)`, run `git checkout main && git pull`. (The fixed script returns to main automatically.) |
| **After a reboot** | Verify `curl -s 127.0.0.1:3099/api/health`; if down, restart the pm2 `nucrm-prod` process (see AGENTS.md for the exact command). |
| **Credentials** | Read the DB connection string from `DATABASE_URL` (see `.env.example`) — never hardcode credentials. |

> Historical note: 200+ deploy runs with 0 successes before 2026-08-01, later fixed (invalid compose
> file, deploy script targeting a nonexistent Docker `app` service, stale `DEPLOY_HOST`, wrong SSH
> action input). Full history in [`AGENTS.md`](../../AGENTS.md).

---

## 6. Onboarding hub & deeper references

New engineers/agents should start at the onboarding hub, which links the project map, maintenance
plan, and feature-addition plan:

- **Onboarding hub:** [`docs/agent-plans/README.md`](../agent-plans/README.md)
- **Project map:** [`docs/agent-plans/PROJECT_MAP.md`](../agent-plans/PROJECT_MAP.md)
- **Maintenance plan:** [`docs/agent-plans/MAINTENANCE_PLAN.md`](../agent-plans/MAINTENANCE_PLAN.md)
- **Feature-addition plan:** [`docs/agent-plans/FEATURE_ADDITION_PLAN.md`](../agent-plans/FEATURE_ADDITION_PLAN.md)
- **Mandatory rules:** [`AGENTS.md`](../../AGENTS.md)
- **Contributor guide:** [`CONTRIBUTING.md`](../../CONTRIBUTING.md)

---

## Related

- [Deployment](./deployment.md) — how the app is built and run
- [Monitoring & Observability](./monitoring.md) — health checks and alerts
- [Security & Compliance](./security.md) — tenant isolation and hardening
- [Operations Runbooks](./runbooks.md) — incident and recovery procedures
