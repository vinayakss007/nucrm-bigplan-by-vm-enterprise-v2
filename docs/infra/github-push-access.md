# GitHub Push Access (pre-prod VM → repository)

Status of the VM's access to the NuCRM repository, and exactly what to change to allow
`git push` from this host (CI jobs, agent sessions, deploy scripts).

## Current state

| Item              | Value                                                                          |
| ----------------- | ------------------------------------------------------------------------------ |
| Repository        | `vinayakss007/nucrm-bigplan-by-vm-enterprise-v2` (private)                      |
| Remote URL        | `git@github-nucrm:vinayakss007/nucrm-bigplan-by-vm-enterprise-v2.git`           |
| SSH alias         | `Host github-nucrm` → `ssh.github.com:443`, `User git`, `StrictHostKeyChecking accept-new` |
| Identity file     | `/root/.ssh/nucrm_deploy` (ED25519)                                             |
| Key fingerprint   | `SHA256:ZgSrcKW6mkjQdiIEoI84Pqp1yWz17x0WJSfA+w+rN+4`                            |
| Public key        | `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN9uOfeMRnZAiq3YQOCh9kfNojJckwqj0lG4tAkIQSIx nucrm-deploy@ubuntu-4cpu-8gb-sg-sin1` |
| **Fetch / clone** | ✅ works                                                                        |
| **Push**          | ❌ fails — `fatal: Could not read from remote repository` (key is read-only)     |

Confirmed 2026-09-15 with:

```bash
git ls-remote --heads origin                      # succeeds
git push --dry-run origin HEAD:refs/heads/probe   # fails: could not read from remote repository
```

## What to change (pick one)

### Option 1 — enable write on the existing deploy key *(smallest change)*

1. Repository → **Settings → Deploy keys**.
2. Find the key with fingerprint `SHA256:ZgSrcKW6mkjQdiIEoI84Pqp1yWz17x0WJSfA+w+rN+4`.
3. Tick **Allow write access** and save.
4. Verify from the VM: `git push --dry-run origin HEAD:refs/heads/probe`.

Caveat: anyone with the VM's root/SSH access can now write to the repo. Acceptable for a pre-prod box;
review again before production.

### Option 2 — fine-grained PAT *(best when you want scoped, revocable access)*

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Scope to this repository only, permission **Contents: Read and write**.
3. Add it as `GITHUB_TOKEN=github_pat_…` in `/root/all-keys` (owner-readable only).
4. Push with an HTTPS remote:

```bash
git push "https://x-access-token:${GITHUB_TOKEN}@github.com/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2.git" HEAD:refs/heads/<branch>
```

A PAT can be revoked instantly and does not depend on the host's SSH identity.

### Option 3 — machine user SSH key *(best for automation)*

Create a dedicated "machine user" with write access to the repo, add a fresh keypair for it, and give
the VM that key. Keeps CI/agent pushes separate from any human account, and audit trails stay clean.

## Branching contract

`main` is protected and this repository works **PR-first** (history shows merge commits from
`vinayakss007/*` branches). Do not push to `main`; push a `fix/…` or `chore/…` branch and open a PR.
See [`../runbooks/branch-protection.md`](../runbooks/branch-protection.md).

## Commit hygiene when pushing from this VM

- Never commit `.env` files, deploy keys or anything from `/root/all-keys` — `.gitignore` already
  excludes `.env*`, but check `git status` before every commit.
- Never commit partial build/dump artefacts (`/var/backups/nucrm/*.sql`, `.next/`, `node_modules/`).
- Reference the register entry in the commit body (e.g. `Refs PP-003, PP-004`) so the fix log and the
  code history stay linked.

## Filing the issues

The pre-prod findings in [`PREPROD-ISSUE-REGISTER.md`](./PREPROD-ISSUE-REGISTER.md) are also prepared as
GitHub-issue payloads in [`issues/`](./issues/), one file per open item (`PP-010` … `PP-022`). Filing is
a single command:

```bash
cd /srv/nucrm
scripts/create-preprod-issues.sh --dry-run      # no token, no network: prints titles/bodies/labels
scripts/create-preprod-issues.sh                # files everything, prints each issue URL
```

What that needs from the repository owner:

1. **A token with `Issues: Read and write`** (plus `Contents: Read and write` if you also want the push).
   - *Fine-grained PAT:* repo scope = this repository; permissions = **Contents: RW** + **Issues: RW**.
     Then `GITHUB_TOKEN=github_pat_…` in `/root/all-keys` (or the environment) is enough for both the
     push and the issue filing.
   - *Deploy key:* granting **Allow write access** (Option 1 above) unblocks `git push` but **not** the
     REST API — a deploy key cannot create issues. Issues still need a PAT.
2. Labels used: `bug` (already exists) and `preprod` (the script creates it if missing).
3. Nothing else — no `gh` CLI is required; `curl` + `jq` are already installed on the VM.

The script is idempotent: it lists existing issues first and skips any title that is already filed, so a
retry after a partial run will not create duplicates. A token that lacks the permission fails fast with
the API's own message rather than filing nothing and exiting 0.

## Workflow trust checklist (#3267) — the halves that are settings, not files

`scripts/check-workflow-trust.mjs` (run by *Workflow Lint → Assert the fork trust boundary*) asserts
the file-side boundary: no `pull_request_target`, no fork-reachable job reading a repo secret, no
fork-reachable `runs-on: self-hosted`, a top-level `permissions:` in every workflow, and an `environment:`
on every job that touches `DEPLOY_*`. It cannot see repository settings, so these stay with the owner.
Verify each after any change to the runner, the key, or the token.

1. **Move the `DEPLOY_*` secrets into the `production` environment.** `deploy.yml` now names that
   environment (`deploy.yml` job `deploy`), so *Settings → Secrets and variables → Actions →
   Environments → production* is where `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_URL` and friends belong.
   Repository-level secrets are readable by *every* workflow in the repo; environment secrets are not.
   Until they move, the environment name only marks the target — it does not restrict anything.
2. **Keep the deploy key read-only.** Option 1 above ("Allow write access") is the smallest unblock for
   `git push`, and the largest blast radius: that key lives on the VM the deploys land on, and a
   write-capable key can push a workflow file that then runs with this repository's secrets. Option 2
   (fine-grained PAT) is preferred for that reason.
3. **Audit the PAT scopes.** The token needs `Contents: Read and write` (push) and `Issues: Read and
   write` (filing). It must **not** have `Actions`, `Secrets`, or `Administration` — with those, a stolen
   token can read or replace `DEPLOY_SSH_KEY`, or dispatch a workflow, without ever touching a branch.
   Check at *Settings → Developer settings → Fine-grained tokens → the token → Repository permissions*.
4. **Do not register a self-hosted runner on this VM while any workflow can reach one.** A
   `pull_request` job scheduled on `self-hosted` executes a contributor's fork code on the host that
   holds `/root/all-keys`, `/srv/nucrm`, and the SSH key GitHub already trusts. If a runner is added
   later, set *Settings → Actions → Runners → Runner groups* so only the workflows that need it can
   schedule there, and keep the `runners: { group: … }` line in the workflow that uses it.
5. **Set the repository default token to read-only** (*Settings → Actions → General → Workflow
   permissions → Read repository contents and packages permissions*). The `permissions:` blocks in the
   workflow files then state each job's actual need instead of loosening a permissive default.
6. **Rotate anything that surfaced in a log, then re-create it in the environment.** #3267's process
   note: a credential that appeared in chat or log output is leaked. Move `DEPLOY_*` (item 1) by
   generating new values rather than copying the repository-level ones, so the copy that was visible
   is also the copy that stops working.

```bash
node scripts/check-workflow-trust.mjs   # the file-side half, exit 1 on any breach
```
