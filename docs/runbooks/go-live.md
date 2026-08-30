# Go-Live Runbook — P0 Operational Blockers

> **Purpose:** one ordered, copy-paste checklist an operator follows on the
> production VM to clear the **ops-only P0 launch blockers** from the Launch
> Readiness Checklist (#1479). These are the items that cannot be closed by
> merging code — they are actions performed on your infrastructure with the
> scripts already shipped in this repo.
>
> **Audience:** whoever owns the production VM (root/sudo + DNS + Stripe access).
>
> The P0 **code** blockers (billing #1462/#1463/#1464, lead conversion #1454)
> are already fixed and merged on `main`. This runbook is the remaining half.

---

## Blockers this runbook clears

| Item  | Blocker                                      | Script / action                            |
| ----- | -------------------------------------------- | ------------------------------------------ |
| #1125 | Exposed secrets never rotated                | `deploy/generate-secrets.sh` + fill `.env` |
| #1036 | Firewall not configured (all ports open)     | `deploy/scripts/setup-firewall.sh`         |
| #1040 | No real domain / self-signed TLS             | `deploy/scripts/setup-ssl.sh`              |
| #1474 | DB TLS not enforced in prod template         | verify `.env` (template already fixed)     |
| #1038 | No database backups                          | `deploy/scripts/backup.sh` + cron          |
| #1476 | No **restore drill** (backups unverified)    | restore into a scratch DB (below)          |
| #1475 | Branch protection on `main` (**repo owner**) | `docs/runbooks/branch-protection.md`       |

Do them **in order** — later steps assume the stack from earlier steps is up.

---

## 0. Preconditions

```bash
# On the VM, in the repo root. Confirm you can reach Docker and the compose file.
docker compose -f deploy/docker-compose.production.yml config >/dev/null && echo "compose OK"
```

- You have `sudo`/root on the VM.
- You control DNS for the domain you will point at this VM.
- You have your Stripe dashboard open (for the webhook + live-key step).

---

## 1. #1125 — Rotate ALL secrets (do this FIRST)

The old secrets must be treated as compromised. Generate fresh ones and write
them into `.env`. Nothing else in this runbook is safe until this is done.

```bash
# 1. Generate a full set of fresh secrets.
bash deploy/generate-secrets.sh | tee /root/nucrm-secrets-$(date +%F).txt

# 2. Start from the production template and fill in EVERY <<<REQUIRED>>> value.
cp deploy/.env.production .env
#   - paste the generated JWT_SECRET, SESSION_SECRET, ENCRYPTION_KEY, SETUP_KEY,
#     CRON_SECRET, EMERGENCY_RECOVERY_KEY, POSTGRES_PASSWORD, GRAFANA_ADMIN_PASSWORD,
#     METRICS_SECRET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#   - set DOMAIN, ACME_EMAIL, NEXT_PUBLIC_APP_URL, ALLOWED_ORIGINS
#   - set the real Stripe live keys + webhook secret (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, price IDs)
#   - set RESEND_API_KEY (#1041) so transactional email actually sends
```

**Rotate the values that live OUTSIDE `.env` too — generating new strings is not
enough if the old ones still work somewhere:**

- **Database password** — change the actual Postgres role password to the new
  `POSTGRES_PASSWORD`, then confirm `DATABASE_URL` matches:
  ```bash
  # host-Postgres (production topology):
  sudo -u postgres psql -c "ALTER ROLE nucrm WITH PASSWORD '<new POSTGRES_PASSWORD>';"
  ```
- **Encryption key (`ENCRYPTION_KEY`)** — this decrypts stored API keys / SSO
  secrets / AI provider keys. If any tenant secrets were already encrypted with
  the OLD key, rotating it makes them undecryptable. If this is a fresh launch
  with no real tenant data yet, just set the new key. If you already have
  encrypted data, re-encrypt it before swapping (or accept tenants must re-enter
  their integration keys).
- **Grafana admin password**, **Redis password** (if set), **any cloud/S3 keys**
  that were in the leaked file — rotate at the provider.
- **JWT_SECRET** — rotating it invalidates all existing sessions (everyone is
  logged out). That is correct and desired after a leak.

**Verify no secret is tracked by git (should already be clean):**

```bash
git ls-files | grep -E '^\.env' && echo "!! tracked env file — remove it" || echo "OK: only .env.example is tracked"
```

> `.gitignore` already blocks `.env*` except `.env.example`, and the leaked
> `.env`/`.env.local` are not in git history. Rotation is the remaining action.

---

## 2. #1474 — Confirm DB TLS is enforced

The prod template is already correct; just confirm your filled-in `.env` kept it:

```bash
grep -E '^DATABASE_URL=|^DATABASE_SSL=' .env
# EXPECT: DATABASE_URL=...sslmode=require   and   DATABASE_SSL=true
# Never ship sslmode=disable to production.
```

If Postgres runs on the host, make sure it actually has TLS on (see
`deploy/postgres/postgresql.conf` / `docs/postgres-hosting-and-recovery.md`).

---

## 3. Bring the stack up

```bash
docker compose -f deploy/docker-compose.production.yml up -d
docker compose -f deploy/docker-compose.production.yml ps   # all healthy?
```

---

## 4. #1040 — Real domain + valid TLS

1. Point an **A record** for your domain at the VM's public IP and wait for it to
   resolve (`dig +short crm.yourdomain.com`).
2. Issue the certificate (nginx must be up from step 3 to answer the ACME
   challenge on :80):

```bash
# Uses DOMAIN + ACME_EMAIL from .env. Idempotent.
bash deploy/scripts/setup-ssl.sh
# First-time tip: dry-run against LE staging to avoid rate limits, then real:
#   bash deploy/scripts/setup-ssl.sh --staging
#   bash deploy/scripts/setup-ssl.sh
```

Verify:

```bash
curl -sSI https://crm.yourdomain.com | head -1     # expect: HTTP/2 200 (or 301->200)
```

---

## 5. #1036 — Lock down the firewall

Reduce the public surface to SSH + HTTP + HTTPS only. Run **as root on the VM**:

```bash
sudo bash deploy/scripts/setup-firewall.sh
#   --ssh-port 2222   if you use a non-default SSH port
#   --iface ens3      if your external NIC is not eth0 (Docker bypass hardening)
```

**Verify from OUTSIDE the VM** (another machine) — every internal port must be
refused:

```bash
bash deploy/scripts/setup-firewall.sh --verify <VM_PUBLIC_IP>
# PASS = only 22/80/443 open; 5432/6379/9000/9090/3001/9187/... all closed.
```

> The script also hardens Docker's `DOCKER-USER` chain so a mis-published
> container can't bypass UFW. If Docker wasn't running when you first ran it,
> re-run after step 3.

---

## 6. #1038 — Backups (create + schedule)

**Take a backup now and confirm it's non-empty and uploaded:**

```bash
bash deploy/scripts/backup.sh            # full pg_dump -> local + S3/MinIO
ls -lh /var/backups/nucrm/               # a fresh nucrm_backup_*.dump exists
```

**Schedule it daily** (the script keeps the last `BACKUP_KEEP_LOCAL`, default 7):

```bash
sudo crontab -e
# add (run at 02:30, after the app's 02:00 per-tenant logical backup):
30 2 * * * cd /path/to/repo && bash deploy/scripts/backup.sh >> /var/log/nucrm-backup.log 2>&1
```

**Offsite copy:** MinIO on the same VM is NOT disaster recovery. Sync
`/var/backups/nucrm` (or the `db/` prefix in the bucket) to an external provider
(S3/B2/etc.) so a VM loss doesn't lose the backups too.

---

## 7. #1476 — Restore DRILL (a backup you haven't restored is not a backup)

Prove the dump actually restores. Do this into a **scratch** database, never the
live one:

```bash
LATEST=$(ls -t /var/backups/nucrm/nucrm_backup_*.dump | head -1)

# Create a throwaway DB and restore into it (host-Postgres example):
sudo -u postgres createdb nucrm_restore_test
sudo -u postgres pg_restore --dbname nucrm_restore_test --clean --if-exists --no-owner "$LATEST"

# Sanity-check row counts on a couple of core tables:
sudo -u postgres psql -d nucrm_restore_test -c "SELECT count(*) FROM tenants;"
sudo -u postgres psql -d nucrm_restore_test -c "SELECT count(*) FROM contacts;"

# Clean up the scratch DB:
sudo -u postgres dropdb nucrm_restore_test
```

Record the drill date + result. Re-drill after any major schema migration.
For a full DR walkthrough (rebuild-from-scratch, single-org restore) see
`docs/runbooks/disaster-recovery.md` and `docs/runbooks/restore-one-organization.md`.

The in-app restore of the live DB is the `--restore` path (destructive, prompts
for confirmation):

```bash
bash deploy/scripts/backup.sh --restore /var/backups/nucrm/<file>.dump
```

---

## 8. #1475 — Branch protection on `main` (REPO OWNER, one-time)

Not on the VM — done in GitHub settings by the repo owner. Follow
`docs/runbooks/branch-protection.md` (require PR review + status checks, block
force-push/deletion on `main`).

---

## Final go/no-go gate

Run the shipped preflight + smoke gate and confirm health before onboarding a
paying customer:

```bash
npm run launch-gate      # scripts/launch-gate.sh (preflight + smoke + health)
curl -sS https://crm.yourdomain.com/api/health | jq .
```

**Do not take a paying customer until every box above is checked** and the P0
billing items in #1479 are verified end-to-end in Stripe test mode (#1477).

---

## Quick reference — what each shipped script does

| Script                             | What it does                                  | Re-runnable      |
| ---------------------------------- | --------------------------------------------- | ---------------- |
| `deploy/generate-secrets.sh`       | Prints a fresh set of all secrets             | yes              |
| `deploy/scripts/setup-firewall.sh` | UFW + Docker edge hardening; `--verify <ip>`  | yes (idempotent) |
| `deploy/scripts/setup-ssl.sh`      | Let's Encrypt cert (self-signed fallback)     | yes (idempotent) |
| `deploy/scripts/backup.sh`         | Full pg_dump → local + S3; `--restore <file>` | yes              |
| `deploy/scripts/health-check.sh`   | Post-deploy health probes                     | yes              |
| `npm run launch-gate`              | Consolidated pre-launch green gate            | yes              |
