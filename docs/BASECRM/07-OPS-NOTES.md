# 07 — Ops Notes

The environment facts that are invisible in the code but cost hours if you don't
know them. Everything here was learned the hard way during the Part A/B work on
this host. Read before debugging "why does my dev DB reject the app role" or "why
is my acceptance run flaky".

## Node & toolchain

- **engines require Node ≥ 22.** The system node on this host is **v16.20.2**
  (`/usr/bin/node`) and a login shell defaulted to it, which broke repo-wide lint
  (eslint crashed on the Node 16 stack) — issue **#2622**. Fixed by prepending the
  vendored runtime in `~/.bashrc` (line 54 as of this writing):
  ```sh
  export PATH="/home/opc/node-v22.23.4-linux-x64/bin:$PATH"
  ```
  Verify: `bash -lc 'node -v; which node'` → `v22.23.4` /
  `/home/opc/node-v22.23.4-linux-x64/bin/node`. Rebuild note: any fresh
  checkout on this box needs this before `npm test`/`eslint` will run.
  The runtime is **vendored, not installed** — a directory under `/home/opc`, no
  version manager behind it — so the pin is a path, and it moves when the directory
  is replaced. `node-v22.14.0-linux-x64` is still on disk and still runs; it is the
  retired one (its line is commented out in `~/.bashrc`), and prepending it is the
  one mistake this section can cause, because it succeeds silently: `node -v` is
  ≥ 22 either way and nothing tells you that you are now two minors behind the
  runtime every suite on this box was verified with. Re-measure before editing this
  bullet — `env -i HOME=$HOME bash -lc 'node -v; which -a node'`.
- Package manager: npm; install uses `--legacy-peer-deps` (see Docker issue #656
  in AGENTS.md backlog — the compose build carries the flag).

## Local worktrees (multi-agent dev)

This host runs several NuCRM checkouts side by side (worktrees `nucrm-wt-a`,
`-a4b`, `-b`, `-c`, plus the main `nucrm-bigplan-by-vm-enterprise-v2`). Gotchas:

- **`node_modules` must be a hardlink copy, not a symlink.** A chain symlink to a
  sibling checkout breaks Next dev resolution
  (`Symlink node_modules could not be resolved`). Prepare a fresh worktree with:
  ```sh
  cp -al /home/opc/nucrm-bigplan-by-vm-enterprise-v2/node_modules ./node_modules
  ```
  (`-a` archive, `-l` hardlink — shares inodes, near-zero disk, behaves like a real
  tree.) A plain `ln -s …/node_modules` works for scripts but **not** for `next dev`.
- **Copy `.env.local`** from the bigplan tree into each worktree (never echo its
  contents — it holds `DATABASE_URL`, the session secret, `TRUST_PROXY`).
- The **main bigplan directory is not itself a git repo** on this host
  (`git status` there → `not a git repository`); the worktrees under `/home/opc/nucrm-wt-*`
  are the git trees. Operate git inside a `nucrm-wt-*` dir.

## Dev server & ports

- Each worktree runs its own `next dev` on a **dedicated port**. The acceptance
  harness ran against `nucrm-wt-b` on **:3100**:
  ```sh
  TRUST_PROXY=true npx next dev -p 3100   # (nohup, log /tmp/nucrm-wtb-dev.log)
  ```
  **Never reuse :3000** for wt work — :3000 serves a different tree and you will
  "fix" one app while testing another.
- `TRUST_PROXY=true` is **required for auth rate-limit tests** (P8): without it,
  `getClientIp` returns `'unknown'` and every auth action 503s fail-closed
  (03 § 6). For normal dev you may leave it off; for login/rate-limit scenarios
  turn it on and send `x-forwarded-for`.

## Database — connecting & realigning a hotpatched dev DB

The dev Postgres user (`nucrm_app`) and the DB can drift out of sync with
`.env.local` (e.g. after copying env between trees, or a prior session reset the
role password). Symptoms: `password authentication failed for user "nucrm_app"`,
or migrate fails with `permission denied for schema drizzle` / `permission denied
to create on database nucrm`.

Recovery (run the password extraction *inside* the command so it never prints —
see § Secrets):

```sh
# 1. realign the app role password to whatever .env.local says
PW="$(grep -oE 'postgres://[^:]+:\K[^@]+' .env.local | head -1)"
sudo -u postgres psql -c "ALTER ROLE nucrm_app WITH PASSWORD '$PW'"

# 2. grant what the migration runner needs
sudo -u postgres psql -d nucrm -c "GRANT ALL ON SCHEMA drizzle TO nucrm_app"
sudo -u postgres psql -d nucrm -c "ALTER SCHEMA drizzle OWNER TO nucrm_app"
sudo -u postgres psql -d nucrm -c "GRANT CREATE ON DATABASE nucrm TO nucrm_app"
```

Then `npm run db:migrate` reports *"All migrations applied successfully"*. On a
fresh DB with an empty `drizzle.__drizzle_migrations` ledger the runner replays
**every** journal file (0088:52-56) — which is why all policy DDL is written
DROP-then-CREATE idempotent and a full replay is safe.

- **Migrations go through `npm run db:migrate` (`scripts/migrate.ts`), never
  `drizzle-kit push`** (AGENTS.md). Push would skip the raw RLS DDL entirely —
  the policies only exist as migration SQL (02 § Migrations).
- Applying 0127–0129 over a **hotpatched** dev DB (the Part B setup) works because
  0127/0128/0129 are all `IF NOT EXISTS` / `ON CONFLICT` / DO-block guarded (02).

## Acceptance harness operational notes

`scripts/simulate-basecrm-acceptance.ts` (PR #2653). To run:

```sh
TRUST_PROXY=true npx next dev -p 3100 &    # target tree
npx tsx scripts/simulate-basecrm-acceptance.ts   # NONCE defaults to a fresh value
```

Known traps that made earlier runs flaky (all now handled in the script):
- **IP-reuse 429s**: brute-force blocks persist 30 min per identifier *and* IP.
  The script derives a per-run randomized TEST-NET-2 base
  (`IP_BASE = NONCE%200+20`, `198.51.100.x`) so consecutive runs never inherit a
  prior run's `login_blocks`.
- **Super-admin login flake**: P0 does a DB upsert then an HTTP login with **one
  retry from a fresh IP** — a cold box occasionally races the CSRF/session cookie.
- **RLS-scoped raw checks**: the harness's `q()` helper wraps every read in
  `withSecurityContext` and sets `app.current_tenant` / `app.current_user` GUCs
  itself, because FORCE-RLS tables (tenant_members/roles/deals/…) have **no
  super-admin bypass policy** — a bare pool query returns 0 rows even though the
  rows exist (this fooled run #1).
- **Import re-runnability**: import rows use nonce-unique titles; a static title
  gets `skipped_duplicates` on the second run and the assertion silently checks
  the wrong row.
- Exit code is non-zero on any FAIL; the ledger prints
  `PASS/FAIL · check-name · actual` for each of the 40 checks.

## Secrets & token hygiene

- The GitHub token used by `gh` here is read from a local log file with a `grep`
  extraction *inline in the command* so the value never appears in a printed
  argument or shell history. **It was leaked into that log at some point — treat
  it as public and rotate it** (owner action, outside this repo).
- `.env.local` / `DATABASE_URL` contents are never echoed into PR bodies, commit
  messages, or issue comments. When reading a password for an `ALTER ROLE`, capture
  it into a variable inside the same command; do not `echo $PW`.
- `nucrm.log` at the repo root: the logger writes runtime output there. Under a
  test runner it is redirected to the OS temp dir (`lib/logger.ts:24-28`, asserted
  by `tests/unit/logger.test.ts`), and the file is now `.gitignore`d
  (PR #2656 / **#2621**) so it can never become a commit candidate.

## Register & CI guards (must exit 0)

- `scripts/check-register-drift.mjs` — every drifted citation pointer in
  `docs/infra/PREPROD-ISSUE-REGISTER.md` must be allowlisted. Merges that shift
  line numbers (e.g. #2647 moved `leads/bulk`, `contacts/bulk`, `contacts/duplicates`)
  re-trigger it; re-pin with a dated in-place note `(re-pinned <date> from :X: reason)`
  (done in #2648, #2652).
- `scripts/check-register-coords.mjs` — coordinates resolve against the tracked tree.
- `scripts/check-migration-rls-dml.mjs` (`npm run guard:migration-rls`) — blocks a
  migration that mutates a FORCE-RLS table without the correct GUC.
- `scripts/check-migration-chain.mjs` (+ `migration-chain-baseline.json`) and
  `scripts/check-migration-redeclarations.mjs` — journal idx integrity, no
  duplicate declarations.
- **The #2655 rbac enforcement screen** — fails CI if an entity route drops
  `enforceField*`. Keep it; it is the tripwire for the #2618 coverage regression.
- `scripts/check-catch-empty.mjs` (`npm run guard:catch-empty`, `4dbeeaea`) — an API
  route must not `catch` and return an empty payload as if it were a result; an
  unread collection and an empty one are different answers.
- `scripts/check-panel-error-state.mjs` (`npm run guard:panel-error-state`, `7893b2b0`)
  — a panel that prints a "there are none" sentence must bind the read's `error` and
  render `InlineErrorState` / `ErrorFallback` / `role="alert"`. Known-good offenders
  are grandfathered in `scripts/panel-error-state-baseline.json`, which is
  **shrink-only**: fix the page, delete its entry.

### What `guard:panel-error-state` cannot see (learn this before rebuilding the panels)

The guard judges a **file**, and it stops at the first bound read that reaches the
screen. Three shapes therefore pass it while the page still lies (#2868 / #2869 /
#2872 all found by hand, not by the sweep):

1. **Secondary reads.** A page that binds `error` for its list and destructures only
   `data` for an option list — `kb`'s categories (#2869), `sms`'s template picker
   (#2868), `settings/assignment-rules/page.tsx:64`'s team list,
   `settings/bulk-transfer/page.tsx:50-51`'s identity and team reads — is clean.
   The picker then offers one placeholder option under a failed read, which is the
   identical screen a tenant with nothing saved gets, and no retry on the page can
   re-run it. A page is only as honest as its **worse** read.
2. **Failed vs stale.** Branching on `Boolean(error)` treats "never answered" and
   "answered, then the refresh failed" as one state. TanStack keeps `data` on a
   failed refetch, so every mutation that invalidates the key — and each of these
   pages invalidates its own — replaces the rows on screen with an outage banner.
   Spell the two states apart:
   `failed = Boolean(err) && !data`, `stale = Boolean(err) && Boolean(data)`; keep
   the rows under `stale` and say they are the last read. With
   `refetchOnWindowFocus: false` and `retry: 2` (`lib/query/client.tsx:51-52`) that
   state only arrives after two retries, i.e. right after the operator acted.
3. **A sentence inside a modal.** The guard's "false empty" scan looks at page-level
   copy; a dialog's single-option `<select>` or its silent `Uncategorized` fallback
   is invisible to it.

Derived counters have their own version of (2): `error ? '—' : n` must become
`failed ? '—' : n`, or the page prints `—` above rows it is also counting.

## Deploy topology (do not conflate — AGENTS.md)

- **This host = Docker.** `nucrm-app`, `nucrm-nginx`, `nucrm-pgbouncer` are live
  containers (`docker ps`), from `deploy/docker-compose.production.yml` +
  `deploy/docker-compose.preprod.yml`. `pm2` is **not installed** here
  (`command -v pm2` finds nothing). `PGBOUNCER_ENABLED=true` in the preprod
  overlay → pooling is on (hence the `DISCARD ALL` reset in 01/02).
- **The production VM ≠ this box.** Described by `.github/workflows/deploy.yml`:
  pm2 (`nucrm-prod`, `next start -p 3099`), `git checkout --force` rollout, gate on
  `127.0.0.1:3099/api/health`, rollback on failure, then returns the VM repo to
  `main`. Host/user/key live in `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_SSH_KEY`
  secrets — never recorded here.
- **VM external IP is EPHEMERAL** — changes on reboot. If deploy fails with
  `connection refused/timeout` on :22, `curl -s ifconfig.me` and
  `gh secret set DEPLOY_HOST --body "<new-ip>"`.
- A deploy's `git checkout --force <sha>` can leave the VM repo in **detached
  HEAD**; the fixed script returns to `main` automatically, but if you see
  `## HEAD (no branch)`: `git checkout main && git pull`.
- **Never run two `npm run build`s concurrently** — corrupts `.next`
  (module-not-found `.external` errors). `rm -rf .next` before a clean rebuild.

## Coordination rules (multi-agent repo)

- **NEVER commit/push `main`.** Branch `fix/<desc>` (or `docs/<desc>`), base `main`,
  **one issue per PR**, **do NOT merge — wait for review** (AGENTS.md PR Policy).
- **Before touching any file**: `git fetch` + re-check the issue/PR/branch state;
  do not re-implement work another agent has in flight. (During Part B, the
  companies/tasks half of #2618 was owned by another agent and merged as #2649 —
  my scope stayed on deals/leads/contacts + the camel-alias fix.)
- **`gh` must run inside a git repo dir**; export `GH_TOKEN` inline (see Secrets).
- Test the specific guard for your change before pushing: field-permission work →
  `tests/unit/rbac-field-coverage-2618*.test.ts` + the #2655 screen; register edits →
  both `check-register-*` scripts; migrations → the chain/RLS guards.
