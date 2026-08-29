# Runbook: Enable branch protection on `main` (#1475)

> **Owner action** — must be run by a repo admin. Agent/CI tokens get `403` on the
> protection API, so this cannot be automated by a bot. Takes ~2 minutes.

## Why

The project policy is "never push to `main`; always PR" (see `AGENTS.md`), but
without a branch-protection rule that policy is **unenforced** — direct pushes,
force-pushes, and unreviewed/CI-failing merges to the production branch are all
possible. Branch protection is what makes CI (typecheck/lint/tests) and code
review actually gate what lands.

## Option A — one command (`gh` CLI, as a repo admin)

The CI job names below must match the check names GitHub sees. Current CI
(`.github/workflows/ci.yml`) reports these checks: **Lint & Typecheck**,
**Unit Tests**, **Integration Tests**, **Build**, **Security Scan (SAST)**,
**Secret Scan (gitleaks)**.

```bash
gh api -X PUT repos/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Lint & Typecheck", "Unit Tests", "Build", "Single Lockfile Guard"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true
}
JSON
```

- `strict: true` → a branch must be up to date with `main` before it can merge.
- `enforce_admins: true` → the rule applies to admins too (no silent bypass).
- Keep the `contexts` list to checks that **always run and can pass**; adding a
  check that never reports will block all merges. The four above are the fast,
  reliable set that report on every PR (verified across recent PR runs).
  `Single Lockfile Guard` is a cheap, deterministic supply-chain gate — it
  rejects a stray `pnpm-lock.yaml`/`yarn.lock` and enforces `package-lock.json`
  as the single source of truth, which is exactly what keeps dependency-hygiene
  changes (e.g. the `overrides` bumps in #1650 / #1657 / #1659) deterministic.
  Add `Integration Tests` / `Security Scan (SAST)` once you've confirmed they
  pass green on PRs consistently (Integration occasionally lags as `in_progress`).

Verify:

```bash
gh api repos/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2/branches/main/protection \
  --jq '{admins: .enforce_admins.enabled, reviews: .required_pull_request_reviews.required_approving_review_count, checks: .required_status_checks.contexts, force: .allow_force_pushes.enabled}'
```

## Option B — GitHub UI

**Settings → Branches → Add branch ruleset (or classic rule) for `main`:**

- [x] Require a pull request before merging → **Required approvals: 1**
- [x] Dismiss stale pull request approvals when new commits are pushed
- [x] Require status checks to pass before merging → **Require up to date** →
      select: `Lint & Typecheck`, `Unit Tests`, `Build`, `Single Lockfile Guard`
- [x] Require linear history
- [x] Do not allow force pushes
- [x] Do not allow deletions
- [x] Do not allow bypassing the above settings (enforce for admins)

## Notes

- **Merging your own PRs after enabling this:** with `required_approving_review_count: 1`
  you'll need a second person to approve, OR temporarily set it to `0` for a
  solo phase, OR use an admin merge. Pick the model that fits the team.
- This is intentionally **not** wired into any workflow/script — GitHub blocks
  bots from editing branch protection, and it should be a deliberate admin act.
