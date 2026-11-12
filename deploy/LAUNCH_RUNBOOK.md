# NuCRM — Pre-Launch Ops Runbook

The code-level security/reliability backlog has been worked through in PRs
#1442–#1452. The remaining launch blockers are **infrastructure/operations**
tasks that must be performed on the production VM — they cannot be closed by a
code change. This runbook is the checklist to make the deployment safe to open
to the internet.

Each item maps to a tracked issue. Do them in order; §1–§4 are hard blockers.

> Deployment model: **Path A — PM2 on the VM**. `deploy/DEPLOYMENT_PATHS.md` is
> the canonical decision: app, worker, cron and realtime are PM2 processes;
> Docker runs only the data + monitoring tier from
> `deploy/docker-compose.production.yml`, and `nginx` is the Compose edge, with
> `app`/`realtime` resolved to the PM2 processes on the host (see #3263). The
> Compose **app** services are development-only (Path B) and must not run on
> this host.

---

## 0. Pre-flight

```bash
# On the VM, from the repo root:
npm run prod:preflight        # topology + env + connectivity checks
```

Fix anything it reports before continuing.

> #3274: a trusted public hostname is a **prerequisite**, not polish. The preflight
> fails when `NEXT_PUBLIC_APP_URL` is a bare IP (no CA issues a certificate for one,
> so the browser can only show a self-signed warning) or when it disagrees with
> `APP_URL`. Complete §2 before treating §0 as green. `NEXT_PUBLIC_APP_URL` is inlined
> at build time, so after changing it rebuild — a restart keeps serving the old origin.

> #3279: the first half of that command is now `scripts/assert-runtime-env.mjs
--expect-production`, which asks the environment a server process would actually get
> (`--pid <pid>` reads a live worker's `/proc/<pid>/environ`) instead of trusting the
> template you copied. It fails on a credential still holding its `<<<REQUIRED>>>`
> template token, and on a `TRUST_PROXY` that never reached the process — the reading
> that decides whether anyone can log in at all, since an unknown client IP is answered
> with 503 for every auth action (#2630). #3271 closed the common case by pinning that
> flag in `ecosystem.config.cjs`, so the default reading of a repo-checked-out tree is
> clean and `--process-only` is the one that still reports the gap. `npm run
assert:runtime-env` is the same file without `--expect-production` — one script, both
> keys, since #3279 and #3271 were separately given the same name. On pm2, `pm2 reload
ecosystem.config.cjs --update-env` is what pushes a changed value into live workers; a
> file edit alone does not.
>
> #3272: `prod:preflight` now passes `--auto-source`, so it asks the host which
> deployment path is running before it reads an environment. On Path A it reads
> the live pm2 `web`/`nucrm-prod` env; on a Compose host it refuses to grade the
> host and prints the in-container command, because the host environment is not
> the app container's. If both paths are running it stops — `DEPLOYMENT_PATHS.md`
> says never to run them on one host.
>
> Note: if `prod:preflight` errors because its script file is missing, run the
> individual checks below manually — the go/no-go checklist at the end is the
> authoritative gate.

---

## §1. Firewall — close all ports except 22/80/443 · #1036, #1042 🔴 BLOCKER

The data-plane ports (Postgres 5432, Redis 6379, MinIO 9000/9001, Prometheus
9090, Grafana 3001, Loki 3100, Alertmanager 9093) must bind to `127.0.0.1`;
`npm run guard:compose-ports` checks that (#3273). Deny them at the edge too.

```bash
sudo bash deploy/scripts/setup-firewall.sh
# non-default SSH port:  sudo bash deploy/scripts/setup-firewall.sh --ssh-port 2222
# The script auto-detects firewalld (RHEL/Oracle Linux) or UFW (Debian/Ubuntu);
# force one with --backend firewalld|ufw, and review with --dry-run first.
```

**Verify from OUTSIDE the VM** (another machine):

```bash
nmap -Pn -p 22,80,443,5432,6379,9000,9090,3001 <VM_PUBLIC_IP>
# Expected: 22/80/443 open; everything else filtered/closed.
```

Access to internal dashboards is via SSH tunnel only — see
`deploy/DEPLOYMENT_INTERNAL.md` §"Monitoring Dashboard URLs".

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
   `TRUST_PROXY=true` here is necessary but not sufficient (#3271): the value that
   counts is the one in the server **process** env, and pm2 replays what it
   captured at first `start`. `ecosystem.config.cjs` pins it for the `web` app;
   verify with `npm run assert:runtime-env`, and reload with `--update-env`.
   Left unset, every login answers `503 Rate limiter misconfigured: client IP
unavailable for an auth endpoint` and nothing else looks wrong.
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
   Then ask the store rather than assuming it: `npm run storage:buckets`
   creates any configured bucket that is missing, and proves the credentials by
   writing, reading back and deleting a probe object (#3258). It prints only the
   env-var NAMES that supplied the keys; a `CreateBucket` refusal is a policy
   answer, not a software one, and says so.
3. **Run one now and verify it restores** (this is the part usually skipped):
   ```bash
   /usr/local/bin/run-cron.sh auto-backup     # or trigger from Superadmin → Backups
   npm run backup:verify                      # restores latest into a scratch DB and validates
   ```
   Restore drill / DR procedure: `docs/runbooks/disaster-recovery.md`.

---

## §3.5. Database TLS — encrypt the DB connection · audit O2 🔴 BLOCKER

`sslmode=disable` exposes DB credentials + all query data (PII) to any in-network
MITM and fails SOC 2 / GDPR. `deploy/postgres/postgresql.conf` ships `ssl = on`;
the cert/key are per-deploy artifacts (gitignored) that must be generated on the
DB host.

```bash
# On the DB host — generate the server cert+key into the data directory:
sudo bash deploy/postgres/generate-server-cert.sh "$PGDATA"
# (for sslmode=verify-full, install a CA / Let's Encrypt cert instead)
sudo systemctl restart postgresql      # or your PG service

# In .env:
#   DATABASE_URL=postgresql://nucrm:...@<host>:5432/nucrm?sslmode=require
#   DATABASE_SSL=true

# Verify TLS is actually negotiated:
psql "host=<host> dbname=nucrm user=nucrm sslmode=require" -c 'SHOW ssl;'   # → on
```

Full detail: `deploy/POSTGRES_PRODUCTION_GUIDE.md` §10.3.

---

## §3.6. Database authentication — pg_hba belongs to the deployment · #3265 🔴 BLOCKER

TLS proves the channel. `pg_hba.conf` decides whether a credential is asked for at
all, and until #3265 the repo had no copy of it: `initdb` writes one into the data
directory, and the official image writes `trust` for local and loopback TCP. So a
new volume — provisioned, or restored onto — came up with "no password from any
process that can reach the socket", and the hardened file an operator had installed
lived _inside_ the volume that was just replaced.

`deploy/postgres/pg_hba.conf` is now the tracked policy for a packaged/host install.
Install it and reload; a reload is enough, so the running pool is not dropped:

```bash
sudo install -m 600 -o postgres -g postgres \
  deploy/postgres/pg_hba.conf /var/lib/postgresql/16/main/pg_hba.conf   # Debian/Ubuntu path
sudo -u postgres psql -c 'select pg_reload_conf()'

# Prove the server agrees with the file, behaviourally — no credential is read:
bash deploy/scripts/health-check.sh          # "PostgreSQL auth: a credential is required"
npm run guard:pg-hba                         # the tracked tree: file + every compose Postgres
```

A containerized topology takes the same decision through the image's own knob —
`POSTGRES_HOST_AUTH_METHOD` and `POSTGRES_INITDB_ARGS=--auth-local=… --auth-host=…`
are pinned in `docker-compose.yml`, `docker-compose.scale.yml` and
`docker-compose.slim.yml`, because that file cannot carry `hostssl` rules: the image
starts with `ssl = off` and no certificate exists, so `hostssl` there refuses every
application connection at the handshake rather than protecting it.

Both paths matter because the pin only shapes a _new_ data directory. An existing
volume keeps whatever rules it was born with, which is why the assertion above reads
the running server and not the file.

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

## §8. Log rotation · #1043 🟡

PM2 logs grow unbounded without rotation and will eventually fill the disk.

```bash
# On the VM, as the user that runs PM2:
bash deploy/scripts/setup-log-rotation.sh
# tunables: PM2_LOG_MAX_SIZE=10M PM2_LOG_RETAIN=7 PM2_LOG_COMPRESS=true
# (set NUCRM_LOG_DIR to also install an OS logrotate policy for app logs)

# Verify:
pm2 conf pm2-logrotate
```

---

## §9. A restart is a brief outage · #3275 🟠

`ecosystem.config.cjs`'s `web` app deliberately has **no `wait_ready`**, and a restart of it is
visible to clients as 502s. Plan the deploy around that instead of assuming `pm2 reload` is
zero-downtime.

Why `wait_ready` is not the fix:

- pm2 waits for the supervised child to _signal_ readiness (`process.send('process_ready')`).
  `next start` never sends it, so `wait_ready: true` would make every reload wait
  `listen_timeout`, give up, and kill the process it was trying to keep.
- In `exec_mode: 'cluster'` the master owns the listening socket; a worker's `listening` event is
  the fd handover, not a warm app. `listen_timeout: 5000` therefore bounds the handover, not the
  first request.
- The rollout in `.github/workflows/deploy.yml` runs `pm2 restart --update-env`, not `reload`, so
  there is no overlap to preserve in the first place: the outage is the whole Next.js boot.

**Operate accordingly:**

- Restart deliberately, in low traffic, and say so in the change note. Clients in flight get 502
  until `/api/health` answers again — that is the deploy gate, and it is the reason the gate reads
  the app rather than `pm2 pid`.
- A 502 _outside_ that window is not a deploy: it is a dead or dying worker. Check
  `pm2 describe web` (`restarts`, `unstable restarts`) and `logs/web-error.log` around the
  timestamp; `max_memory_restart` in the same file is the usual culprit.
- Do not paper over it in the proxy. Masking 502s makes a crashed worker look like the app.

`tests/unit/pm2-restart-outage-3275.test.ts` pins the pair: the config cannot claim a readiness
signal the supervised process does not emit, and this section has to stay in the tree.

---

## Final go/no-go checklist

- [ ] `npm run guard:compose-ports` is green, and `nmap` from outside shows only 22/80/443 open (§1)
- [ ] `https://crm.yourdomain.com` serves a valid (non-self-signed) cert; HTTP→HTTPS redirect works (§2)
- [ ] `crontab -l` shows `auto-backup`; a fresh backup exists off-VM; `npm run backup:verify` passes (§3)
- [ ] `SHOW ssl;` returns `on` over an `sslmode=require` connection; no `sslmode=disable` anywhere (§3.5)
- [ ] `npm run guard:pg-hba` is green, and `health-check.sh` says a credential is required rather than accepting a session without one (§3.6)
- [ ] `git log --all -- .env .env.local` is empty; all secrets generated/rotated; `sslmode` matches `DATABASE_SSL` (§4)
- [ ] A deliberate test error appears in Sentry (§5)
- [ ] A password-reset email is received (§6)
- [ ] Grafana admin user is not `admin`; internal ports not publicly reachable (§7)
- [ ] `pm2 conf pm2-logrotate` shows rotation configured (§8)
- [ ] The restart outage is scheduled and understood; no `wait_ready` on `web` without a readiness signal in the process it supervises (§9)
- [ ] `npm run prod:preflight` is green

When every box is checked, the deployment is safe to open to the internet.
