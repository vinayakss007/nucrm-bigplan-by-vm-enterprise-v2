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
