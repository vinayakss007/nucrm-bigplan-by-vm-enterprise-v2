# Infrastructure Issues — Ready to Create

---

## Issue 1: ✅ RESOLVED — CI/CD not implemented

**Labels:** `infrastructure`, `high-priority`

### Description

This issue previously claimed the README documented GitHub Actions but `.github/workflows/` did not exist. That is no longer accurate: CI/CD is now fully implemented via `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`.

### Current State (RESOLVED)

- `.github/workflows/ci.yml` and `.github/workflows/deploy.yml` both exist.
- `ci.yml` is triggered on `pull_request` and `push` to `main`, and runs comprehensive jobs:
  - **`lint-typecheck`** — `npm run lint`, `npm run typecheck`, plus four guards: `guard:rls` (#1838), `guard:schemas` (#1883), `guard:boundaries` (#1840), `guard:filesize` (#1843)
  - **`test-unit`** — `postgres:16` + `redis:7` service containers, `db:sync`, `npm run test:unit` with coverage
  - **`test-integration`** — `postgres` + `redis` services, `npm run test:integration`
  - **`secret-scan`** — gitleaks
  - **`security-scan`** — `npm audit`, gitleaks path scan, Semgrep SAST with SARIF upload
  - **`build`** — `npm run build` plus bundle-size check
  - **`lockfile-guard`** — rejects foreign pnpm/yarn lockfiles
- Automated quality gates now run on every PR; security scanning is no longer manual-only.

### References

- `AGENTS.md` mentions "CI should run: lint, typecheck, tests, security scan" — now satisfied by `ci.yml`.
- `.github/workflows/deploy.yml` handles production deployment.

---

## Issue 2: Multiple conflicting database passwords

**Labels:** `security`, `medium-priority`

### Description

Multiple different PostgreSQL passwords are scattered across configuration files, creating confusion and potential security gaps.

### Current State

| File                         | Password Value                     |
| ---------------------------- | ---------------------------------- |
| `.env` / `.env.local`        | `07a8ad1c17f42c56dd734b4e5ae5eafe` |
| `scripts/start_nucrm.sh`     | `nucrm_pass_2026`                  |
| `AGENTS.md`                  | `nucrm_prod_db_pass_2026`          |
| `drizzle.config.ts` fallback | `nucrm_secure_password`            |

### Impact

- Developers may connect to wrong database with wrong credentials
- Production password may be leaked in dev configs
- No single source of truth for database credentials
- Risk of hardcoding stale passwords

### Proposed Solution

1. **Single source of truth**: Use `deploy/generate-secrets.sh` to generate and store the production password
2. **Remove hardcoded passwords** from `scripts/start_nucrm.sh`, `AGENTS.md`, `drizzle.config.ts`
3. **All configs reference env vars only** — no inline passwords
4. **Add `.env.local` to `.gitignore`** (verify it's already there)
5. **Rotate all passwords** after consolidation

---

## Issue 3: PostgreSQL has no TLS/SSL

**Labels:** `security`, `medium-priority`

### Description

PostgreSQL connections are unencrypted (`sslmode=disable`) in all environments, including production. Data in transit between app and database is plaintext.

### Current State

- `.env.production`: `DATABASE_URL=...?sslmode=disable`
- `docker-compose.yml`: No SSL config for PostgreSQL
- `deploy/postgres/postgresql.conf`: No `ssl = on` or certificate config
- PgBouncer: No TLS configuration

### Impact

- Database credentials transmitted in plaintext on the network
- Query data (including PII) visible to anyone with network access
- Compliance risk for SOC 2, GDPR, HIPAA requirements
- Man-in-the-middle attacks possible between app and DB

### Proposed Solution

1. **Enable PostgreSQL SSL**: Generate self-signed or Let's Encrypt certs, configure `ssl = on` in `postgresql.conf`
2. **Update connection strings**: Change `sslmode=disable` → `sslmode=require` or `sslmode=verify-ca`
3. **PgBouncer TLS**: Configure `client_tls_sslmode` and `server_tls_sslmode`
4. **Document cert rotation** in `deploy/POSTGRES_PRODUCTION_GUIDE.md`

---

## Issue 4: 3 test files with pre-existing failures

**Labels:** `testing`, `low-priority`

### Description

Three test files have pre-existing failures unrelated to recent changes. These tests have been failing since before the `fix/typecheck-errors` branch.

### Failing Tests

**1. `tests/dashboard/contact-timeline.test.tsx` — 11 failures**

- Component was rewritten (different API endpoint, different UI text) but tests were not updated
- Test expects: `/api/tenant/contacts/c1/timeline?limit=25`
- Component uses: `/api/tenant/activities?contact_id=c1`

**2. `tests/integration/saved-reports-list.test.ts` — 1 failure**

- `GET /api/tenant/reports/saved` returns 404

**3. `tests/unit/pipelines-stage-safety.test.ts` — 2 failures**

- DELETE operations on pipelines not finding expected records

### Impact

- 14 total failing tests across 3 files
- CI would fail if implemented without fixing these first

### Proposed Solution

1. **`contact-timeline.test.tsx`**: Rewrite tests to match current component implementation
2. **`saved-reports-list.test.ts`**: Investigate missing API route or mock setup
3. **`pipelines-stage-safety.test.ts`**: Fix test data setup or API handler

---

## Issue 5: Grafana using default admin credentials

**Labels:** `security`, `low-priority`

### Description

Grafana is configured with default admin credentials (`admin` / password from env). If `GRAFANA_ADMIN_PASSWORD` is not set or uses a weak default, the monitoring dashboard is vulnerable.

### Current State

- `GRAFANA_ADMIN_USER=admin` (default)
- No evidence of password rotation or MFA setup
- Postgres datasource configured with full credentials

### Impact

- Default credentials could allow unauthorized access to dashboards
- Postgres datasource in Grafana may expose query data
- Alert configurations could be modified by attackers

### Proposed Solution

1. **Strong unique password**: Generate via `deploy/generate-secrets.sh`
2. **Restrict access**: Bind Grafana to `127.0.0.1` only (already done in Docker)
3. **Add to secret rotation** schedule
4. **Consider removing Postgres datasource** or using read-only user

---

## Issue 6: Prometheus metrics not accessible from outside VM

**Labels:** `infrastructure`, `low-priority`

### Description

Prometheus (9090), Grafana (3001), Loki (3100), and Alertmanager (9093) are all bound to localhost only. No external access to monitoring without SSH tunnel.

### Current State

- All monitoring services bind to `127.0.0.1`
- UFW firewall blocks all ports except 22, 80, 443
- SSH port forwarding is the only access method

### Impact

- Cannot access dashboards without SSH access
- No external alerting visibility for team members
- Debugging production issues requires SSH first

### Proposed Solution

**Option A — SSH tunnels (recommended for small team):**

```bash
ssh -L 3001:127.0.0.1:3001 user@server  # Grafana
ssh -L 9090:127.0.0.1:9090 user@server  # Prometheus
```

Document in `deploy/DEPLOYMENT_INTERNAL.md`.

**Option B — Cloudflare Tunnel or Tailscale (for larger teams).**

**Option C — Reverse proxy with auth (not recommended).**

---

## Issue 7: No Infrastructure-as-Code for VM provisioning

**Labels:** `infrastructure`, `low-priority`

### Description

The entire infrastructure is a self-hosted Docker Compose stack on a bare VM. There is no Terraform, Pulumi, CloudFormation, or any IaC tool for provisioning.

### Current State

- Deployment target: bare VM (Hetzner CX32 or DigitalOcean, 8GB RAM)
- Orchestration: Docker Compose (3 variants)
- VM provisioning: Manual or via `scripts/deploy-vm.sh` (partial)
- No Terraform/Pulumi/CloudFormation configs

### Impact

- VM provisioning is manual and error-prone
- Cannot reproduce infrastructure from code
- No drift detection between intended and actual state
- Disaster recovery requires manual VM rebuild

### Proposed Solution

**Minimum viable IaC:**

1. **Terraform** for VM provisioning (Hetzner/DigitalOcean provider)
2. **Ansible** or cloud-init for Docker setup on the VM
3. Store Terraform state in S3/MinIO with state locking

**Full IaC (stretch goal):**

1. Move PostgreSQL to managed service
2. Move Redis to managed service
3. Keep only app containers on VM
