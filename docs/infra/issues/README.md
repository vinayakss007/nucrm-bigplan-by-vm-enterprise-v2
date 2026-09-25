# Pre-Prod Issue Payloads (ready to file on GitHub)

One file per **open** item from the [Pre-Prod Issue Register](../PREPROD-ISSUE-REGISTER.md), written in the
exact shape of [`.github/ISSUE_TEMPLATE/bug_report.yml`](../../../.github/ISSUE_TEMPLATE/bug_report.yml)
(Summary · Steps to reproduce · Expected vs actual · File/route · Severity · Area) so it can be pasted
into the GitHub form **or** filed in bulk by script.

File them with:

```bash
scripts/create-preprod-issues.sh --dry-run     # preview: titles, body sizes, labels
scripts/create-preprod-issues.sh               # file everything (needs GITHUB_TOKEN)
scripts/create-preprod-issues.sh --only PP-012 # one issue
```

The script is idempotent — it skips any title that already exists (open or closed), so a re-run after a
partial failure is safe. Need the token first? See
[GitHub Push Access → Filing the issues](../github-push-access.md#filing-the-issues).

| Payload                                                      | Title                                                                     | Severity | Register |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- | -------- | -------- |
| [PP-010](./PP-010-first-superadmin-rls.md)                   | Pre-auth RLS blocks first super-admin creation                            | CRITICAL | PP-010   |
| [PP-011](./PP-011-signup-rls.md)                             | Public signup rejected by RLS (`users_insert_auth` unsatisfiable)         | CRITICAL | PP-011   |
| [PP-012](./PP-012-login-attempts-rls.md)                     | `login_attempts` RLS blocks writes **and** reads — lockout silently inert | CRITICAL | PP-012   |
| [PP-013](./PP-013-tenant-isolation-gate.md)                  | Tenant-isolation gate FAILED: 5 RLS-off, 10 no-policy, 6 NULL-tenant      | CRITICAL | PP-013   |
| [PP-014](./PP-014-pg-dump-rls.md)                            | `pg_dump` fails as the app role (FORCE RLS + `row_security=off`)          | CRITICAL | PP-014   |
| [PP-015](./PP-015-backup-database-url.md)                    | `BACKUP_DATABASE_URL` still points at the RLS-bound app role              | HIGH     | PP-015   |
| [PP-016](./PP-016-sentry-environment.md)                     | Pre-prod Sentry events carry no `environment` / `release`                 | LOW      | PP-016   |
| [PP-017](./PP-017-promtail-docker-sd.md)                     | promtail ships no container logs to Loki (`docker_sd_configs` unset)      | LOW      | PP-017   |
| [PP-018](./PP-018-upcloud-object-storage.md)                 | UpCloud managed object storage: `CreateBucket` → AccessDenied             | MEDIUM   | PP-018   |
| [PP-019](./PP-019-missing-api-keys.md)                       | Missing `RESEND_API_KEY`, `ANTHROPIC_API_KEY` (fails silently)             | MEDIUM   | PP-019   |
| [PP-020](./PP-020-host-hardening.md)                         | Host hardening not applied: UFW, SSH, `infra-readiness.sh`                | MEDIUM   | PP-020   |
| [PP-021](./PP-021-metrics-n-plus-one.md)                     | N+1 query on the dashboard metrics endpoint (`NUCRM-1`)                    | LOW      | PP-021   |
| [PP-022](./PP-022-superadmin-audit-tenant-id-type.md)        | `super_admin_audit_logs.tenant_id` is `text`, blocking the standard policy | LOW      | PP-022   |

Fixed items (`PP-001` … `PP-009`, `PP-003`/`PP-004` fixed in this branch and awaiting deploy
verification) are deliberately **not** filed as issues: their evidence and fix live in the register, the
fix log, and the fix commit (`fix/preprod-bringup-setup-rls-backups`, which references `PP-00x` in its
body). All 22 register entries are therefore accounted for: 9 fixed, 13 filed here.

## Conventions

- The **first line** must be `# <issue title>` — the script uses it as the GitHub title.
- Everything after line 1 becomes the issue body; keep the `**Severity:**` / `**Area:**` lines so the
  labels and severity stay machine-readable.
- Keep every payload self-contained: a reader who has never opened this repo must be able to reproduce
  the problem from the issue alone, and links back to the register entry.
- Prefer a reproducible command (SQL, `curl`, `docker exec`) over prose in *Steps to reproduce*.
