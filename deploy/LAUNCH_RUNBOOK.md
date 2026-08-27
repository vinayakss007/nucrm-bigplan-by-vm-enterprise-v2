# NuCRM — Pre-Launch Ops Runbook

The code-level security/reliability backlog has been worked through in PRs
#1442–#1452. The remaining launch blockers are **infrastructure/operations**
tasks that must be performed on the production VM — they cannot be closed by a
code change. This runbook is the checklist to make the deployment safe to open
to the internet.

Each item maps to a tracked issue. Do them in order; §1–§4 are hard blockers.

> Deployment model (from `deploy/DEPLOYMENT_INTERNAL.md`): a single VM running
> the Docker Compose stack in `deploy/docker-compose.production.yml`, behind
> nginx (`deploy/nginx/nginx-production.conf`), with all data-plane services
> bound to `127.0.0.1`.

---

## 0. Pre-flight

```bash
# On the VM, from the repo root:
npm run prod:preflight        # env + connectivity checks
```

Fix anything it reports before continuing.

> Note: if `prod:preflight` errors because its script file is missing, run the
> individual checks below manually — the go/no-go checklist at the end is the
> authoritative gate.

---

## §1. Firewall — close all ports except 22/80/443 · #1036, #1042 🔴 BLOCKER

The data-plane ports (Postgres 5432, Redis 6379, MinIO 9000/9001, Prometheus
9090, Grafana 3001, Loki 3100, Alertmanager 9093) are bound to `127.0.0.1` by
compose, but the host must also deny them at the edge as a backstop.

```bash
sudo bash deploy/scripts/setup-firewall.sh
# non-default SSH port:  sudo bash deploy/scripts/setup-firewall.sh --ssh-port 2222
```

**Verify from OUTSIDE the VM** (another machine):

```bash
nmap -Pn -p 22,80,443,5432,6379,9000,9090,3001 <VM_PUBLIC_IP>
# Expected: 22/80/443 open; everything else filtered/closed.
```

Access to internal dashboards is via SSH tunnel only — see
`deploy/DEPLOYMENT_INTERNAL.md` §"Monitoring access".

---

## §2. Real domain + TLS certificate · #1040 🔴 BLOCKER

Stop using the raw IP + self-signed cert. Point a real domain at the VM and
issue a Let's Encrypt certificate.

1. **DNS**: create `A` records for `crm.yourdomain.com` (and `s3.` / `grafana.`
   if you expose them) → VM public IP.
2. **Issue cert** (nginx must be reachable on 80 first — §1 allows it):

   ```bash
   sudo apt-get install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d crm.yourdomain.com --redirect --agree-tos -m ops@yourdomain.com
   sudo certbot renew --dry-run     # confirm auto-renewal works
   ```

   (Auto-renewal is installed as a systemd timer / cron by certbot.)

3. **App config** (`.env`): set the real HTTPS URLs and keep secure cookies on:
   ```
   NEXT_PUBLIC_APP_URL=https://crm.yourdomain.com
   ALLOWED_ORIGINS=https://crm.yourdomain.com
   COOKIE_SECURE=true
   TRUST_PROXY=true
   ```
4. Reload nginx: `sudo nginx -t && sudo systemctl reload nginx`.

---

## §3. Database backups — install + verify · #1038 🔴 BLOCKER

The backup tooling already exists (`scripts/backup-db.sh`,
`deploy/scripts/backup.sh`, the `auto-backup` and `backup-health` API cron
routes, and `npm run backup:verify`). The blocker is that it must be
**installed and actually running** on the VM, and a restore must be proven.

1. **Install the host crontab** (drives the API cron routes with `CRON_SECRET`):
   ```bash
   sudo cp deploy/cron/run-cron.sh /usr/local/bin/run-cron.sh
   sudo chmod +x /usr/local/bin/run-cron.sh
   sudo crontab deploy/cron/crontab        # includes: 0 2 * * * auto-backup
   sudo crontab -l | grep -E 'auto-backup|backup-health'   # confirm installed
   ```
   `run-cron.sh` needs `APP_URL` and `CRON_SECRET` in its environment — see the
   top of `deploy/cron/run-cron.sh`.
2. **Confirm off-site storage**: backups upload to the `BACKUP_BUCKET`
   (`.env`). For a single-VM deploy, point this at an _external_ S3/MinIO, not
   the same VM — a backup on the box that dies with the box is not a backup.
3. **Run one now and verify it restores** (this is the part usually skipped):
   ```bash
   /usr/local/bin/run-cron.sh auto-backup     # or trigger from Superadmin → Backups
   npm run backup:verify                      # restores latest into a scratch DB and validates
   ```
   Restore drill / DR procedure: `docs/runbooks/disaster-recovery.md`.

---

## §4. Secrets — generate, rotate, and confirm none are in git · #1125 🔴 BLOCKER

`.env*` is gitignored (`!.env.example` is the only exception) and the only
committed env file is the **template** `deploy/.env.production`, which contains
`<<<REQUIRED>>>` placeholders — **not** real secrets. Still, verify and rotate:

1. **Generate strong secrets** into the real (untracked) `.env`:
   ```bash
   cp deploy/.env.production .env
   bash deploy/generate-secrets.sh        # fills JWT/SESSION/ENCRYPTION/SETUP/CRON/etc.
   # then fill remaining <<<REQUIRED>>> values (DB password, Resend, Sentry, S3, Grafana)
   ```
2. **Confirm no real secret was ever committed** (history scan):
   ```bash
   git log --all --full-history -- .env .env.local deploy/.env  # should be empty
   git grep -nI -e 'sk_live_' -e 'whsec_' -e 'AKIA' $(git rev-list --all) | head   # spot-check
   ```
   If anything real turns up in history, rotate that credential AND purge it
   with `git filter-repo` (or BFG), then force-push and invalidate the exposed key.
3. **Rotate anything that was ever placed in a dev `.env`** that could have
   leaked (DB password, JWT/SESSION/ENCRYPTION keys, Redis password). See the
   generation recipes at the top of `deploy/.env.production`.
4. Ensure `DATABASE_URL` `sslmode` matches `DATABASE_SSL` (template now defaults
   to `sslmode=require`; see `deploy/POSTGRES_PRODUCTION_GUIDE.md`).

---

## §5. Error tracking — enable Sentry · #1039 🟠

Set in `.env` (the runtime code already honors these):

```
SENTRY_ENABLE=true
SENTRY_DSN=...              NEXT_PUBLIC_SENTRY_DSN=...
SENTRY_ORG=...             SENTRY_PROJECT=...
SENTRY_AUTH_TOKEN=...       # build-time source-map upload
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Rebuild so source maps upload, then trigger a test error and confirm it lands
in Sentry.

---

## §6. Transactional email — configure Resend · #1041 🟠

Without this, password resets / invites / notifications silently don't send.

```
RESEND_API_KEY=re_live_...
RESEND_WEBHOOK_SECRET=whsec_...     # from Resend → Webhooks (Svix); required for bounce/complaint handling
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
```

- Verify your sending domain in Resend (SPF/DKIM/DMARC DNS records).
- Point the Resend webhook at `https://crm.yourdomain.com/api/webhooks/resend`
  (signature verification is enforced — see PR #1446).
- Test: trigger a password reset and confirm delivery.

SMTP is the documented fallback (`SMTP_*` in `.env`) if Resend is unavailable.

---

## §7. Harden monitoring credentials 🟠

- `GRAFANA_ADMIN_USER` — change from the default `admin`.
- `GRAFANA_ADMIN_PASSWORD` — strong, unique (from `generate-secrets.sh`).
- Grafana/Prometheus/Loki/Alertmanager stay on `127.0.0.1` (§1); reach them via
  SSH tunnel only.

---

## Final go/no-go checklist

- [ ] `nmap` from outside shows only 22/80/443 open (§1)
- [ ] `https://crm.yourdomain.com` serves a valid (non-self-signed) cert; HTTP→HTTPS redirect works (§2)
- [ ] `crontab -l` shows `auto-backup`; a fresh backup exists off-VM; `npm run backup:verify` passes (§3)
- [ ] `git log --all -- .env .env.local` is empty; all secrets generated/rotated; `sslmode` matches `DATABASE_SSL` (§4)
- [ ] A deliberate test error appears in Sentry (§5)
- [ ] A password-reset email is received (§6)
- [ ] Grafana admin user is not `admin`; internal ports not publicly reachable (§7)
- [ ] `npm run prod:preflight` is green

When every box is checked, the deployment is safe to open to the internet.
