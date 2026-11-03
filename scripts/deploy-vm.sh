#!/usr/bin/env bash
# NuCRM VM install — one path from an empty host to a running app.
#
# WHAT IT DOES: detects the package manager, installs the runtime, creates the
# database and a least-privilege app role, writes a complete .env.local at mode
# 600, applies the migration chain, verifies the role really is subject to RLS,
# builds, starts pm2, and only then calls the one-shot setup endpoint — against
# a server it has proved is listening.
#
# WHY IT IS SHAPED LIKE THIS (#3278). The previous version of this file cloned a
# different repository, wrote the Postgres superuser password into a 0644 file,
# never started anything on :3000, and read `curl` exit 0 as success — so a 403
# or a 500 from the setup gate printed "=== Done ===" and the platform super
# admin, which app/api/setup/create-admin/route.ts refuses to create twice, was
# never created. Everything below is either checked or exits non-zero.
#
# Usage (every value comes from the operator's environment; nothing is committed):
#   REPO_URL=… APP_URL=https://crm.example.com \
#   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='…' \
#   bash scripts/deploy-vm.sh
#
#   --dry-run         print every side-effecting command and run none of them.
#                     This is how the sequence gets reviewed without a spare VM.
#   --env-only [path] generate and write the env file (default $APP_DIR/env.local.preview)
#                     and exit: its mode, keys and lengths are testable this way.
#   --no-build        stop after .env.local and the database, for a host that
#                     builds and starts elsewhere.
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/vinayakss007/nucrm-bigplan-by-vm-enterprise-v2.git}
APP_DIR=${APP_DIR:-"$HOME/nucrm"}
# The file pm2's child actually reads. ecosystem.config.cjs sets `cwd: __dirname`
# and parses `${__dirname}/.env.local`, scripts/load-env.mjs resolves the same
# path, and Next.js reads .env.local from the directory `next start` runs in —
# which is the repo, not its parent. An env file one level up is invisible to all
# three, and the install still prints "done".
ENV_NAME="repo/.env.local"
ENV_PREVIEW_NAME="env.local.preview"
APP_URL=${APP_URL:?APP_URL is required, e.g. APP_URL=https://crm.example.com — it feeds NEXT_PUBLIC_APP_URL and ALLOWED_ORIGINS; a bare-IP default is what #3274 exists to stop}
DB_NAME=${DB_NAME:-nucrm_db}
DB_HOST=${DB_HOST:-127.0.0.1}
DB_PORT=${DB_PORT:-5432}
OWNER_ROLE=${OWNER_ROLE:-postgres}
# Not an operator secret and not something a fresh VM has: under `set -u` a bare
# ${REDIS_URL} in the heredoc aborts the write, which is how #3278's own test passed
# at home (a shell that had it exported) and failed on a clean runner. This is the
# value ecosystem.config.cjs:114 pins for all three apps, so the two sources agree.
REDIS_URL=${REDIS_URL:-redis://127.0.0.1:6379}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:3000/api/health}
HEALTH_TRIES=${HEALTH_TRIES:-60}
REQUIRED_NODE_MAJOR=22
REQUIRED_NODE_MINOR=23
REQUIRED_NODE_PATCH=4

DRY_RUN=0
ENV_ONLY=0
ENV_ONLY_PATH=""
NO_BUILD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --no-build) NO_BUILD=1; shift ;;
    --env-only)
      ENV_ONLY=1
      if [ $# -gt 1 ] && [ "${2:0:2}" != "--" ]; then ENV_ONLY_PATH=$2; shift; fi
      shift
      ;;
    *) printf 'deploy-vm: unknown argument %s\n' "$1" >&2; exit 2 ;;
  esac
done

# The admin identity is required before the first side effect, not in the last
# function: an install that discovers the missing password after it has cloned,
# provisioned a role and migrated is an install that cannot be undone by the
# operator who is now standing in front of a half-built box.
ADMIN_EMAIL=${ADMIN_EMAIL:?ADMIN_EMAIL is required for the platform super admin}
ADMIN_PASSWORD=${ADMIN_PASSWORD:?ADMIN_PASSWORD is required: 8+ per the endpoint schema, and 12+ with an uppercase letter, a number and a special character per its policy}

# Every external side effect goes through run, so --dry-run exercises the whole
# sequence on a host that must not be touched.
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '[dry-run] %s\n' "$*"; else "$@"; fi
}
# Same, but what --dry-run prints is the redacted form given as $1. A full
# DATABASE_URL carries the credential, and dry-run output is meant to be
# shareable with a reviewer; the real argv after it is what actually executes.
run_redacted() {
  local display=$1
  shift
  if [ "$DRY_RUN" = 1 ]; then printf '[dry-run] %s\n' "$display"; else "$@"; fi
}
say() { printf 'deploy-vm: %s\n' "$*"; }
die() { printf 'deploy-vm: FATAL: %s\n' "$*" >&2; exit 1; }

# Every secret is hex: it is URL-safe, so a database password can be embedded in
# a connection string without encoding (which is what deploy/generate-secrets.sh's
# base64 filter was for), and it carries ~4 bits/char against lib/env.ts's floor
# of 3. A truncated `openssl rand -base64 | head -c` pipe was the alternative, and
# under `set -o pipefail` a head that closes early is a signal, not a substring.
secret_hex() { openssl rand -hex "$1"; }
# Named before the first substitution rather than relying on errexit: a host with
# no openssl would otherwise die with no output at all, right where the install
# looks most like it is making progress.
command -v openssl >/dev/null 2>&1 || die "openssl is required to generate the install secrets (apt-get install openssl / dnf install openssl), then re-run."

# ── 1. Secrets, generated per install ────────────────────────────────────────
# The lengths are validateEnv()'s floors (lib/env.ts): JWT_SECRET/SESSION_SECRET
# >= 32, CRON_SECRET >= 32, ENCRYPTION_KEY >= 32, SETUP_KEY >= 20, and every
# secret must clear 3 bits/char entropy, which 4 bits/char of hex does by a margin.
# Each one honours an operator-supplied value first: this script is re-run after
# a failure, and rotating the key a running server already holds is how a
# maintenance window turns into a lockout.
JWT_SECRET=${JWT_SECRET:-$(secret_hex 32)}
SESSION_SECRET=${SESSION_SECRET:-$(secret_hex 24)}
ENCRYPTION_KEY=${ENCRYPTION_KEY:-$(secret_hex 32)}
SETUP_KEY=${SETUP_KEY:-$(openssl rand -hex 24)}
CRON_SECRET=${CRON_SECRET:-$(secret_hex 48)}
EMERGENCY_RECOVERY_KEY=${EMERGENCY_RECOVERY_KEY:-$(secret_hex 32)}
METRICS_SECRET=${METRICS_SECRET:-$(secret_hex 32)}
APP_DB_PASSWORD=${APP_DB_PASSWORD:-$(secret_hex 16)}
OWNER_DB_PASSWORD=${OWNER_DB_PASSWORD:-$(secret_hex 16)}

case "$APP_URL" in
https://*) COOKIE_SECURE=true ;;
*) COOKIE_SECURE=false; say "WARNING: APP_URL is not https, so cookies go unsecured (#3274)." ;;
esac

# ── 2. sslmode is derived, never asserted ────────────────────────────────────
# LAUNCH_RUNBOOK.md §4 and the note above deploy/.env.production's DATABASE_URL
# both require DATABASE_URL's sslmode and DATABASE_SSL to agree, and the runbook's
# own checklist (§3.5) reads "no sslmode=disable anywhere". Reading SHOW ssl is the
# only way this script can promise that instead of hoping.
is_loopback_host() {
  case "$1" in
    127.0.0.1 | localhost | ::1) return 0 ;;
    *) [ "${1:0:7}" = "127.0.0" ] ;;
  esac
}

# What the data tier says about itself — or a refusal to guess. An unreadable
# answer is an error, not an 'off': the same rule scripts/assert-runtime-env.mjs
# applies to a source it cannot read.
#
# No command substitution anywhere in here: `setting=$(…)` would put the die in a
# subshell, where `exit 1` ends only the substitution and the install carries on
# with an empty answer. That is the #3278 bug class, in the script that fixes it.
probe_db_ssl() {
  local setting
  if is_loopback_host "$DB_HOST"; then
    if [ "$DRY_RUN" = 1 ] || [ "$ENV_ONLY" = 1 ]; then
      # Neither mode may need a live server: the point of --env-only is that the
      # file it writes is testable on any host, so the documented default of the
      # templates (deploy/.env.production, LAUNCH_RUNBOOK.md §4) stands in here.
      setting=${NUCRM_DB_SSL:-on}
    else
      setting=$(sudo -u "$OWNER_ROLE" psql -tAc "SHOW ssl;" 2>/dev/null) || setting=unreadable
      setting=${setting:-unreadable}
    fi
  elif [ -n "${NUCRM_DB_SSL:-}" ]; then
    # A remote cluster is not the one `sudo -u postgres psql` can answer for, and
    # this script has no credential for it yet, so the operator states it.
    setting=$NUCRM_DB_SSL
  else
    die "DB_HOST=$DB_HOST is not this host, so the local cluster cannot be asked about TLS. Run: psql \"host=$DB_HOST sslmode=require\" -c 'SHOW ssl;' (LAUNCH_RUNBOOK.md §4), then re-run with NUCRM_DB_SSL=on — an 'off' answer cannot be installed by this path, see below."
  fi
  case "$setting" in
    on | true)
      DATABASE_SSL=true
      SSLMODE=require
      # A fresh host carries the packaging's self-signed certificate, which is
      # what ecosystem.config.cjs's own DATABASE_SSL_REJECT_UNAUTHORIZED=false is
      # for on this topology.
      DATABASE_SSL_REJECT_UNAUTHORIZED=false
      ;;
    *)
      # Refuse rather than write the pair. pg's `ssl` option overrides the
      # connection string's sslmode, and all three pm2 apps pin DATABASE_SSL=true
      # in their env: blocks (ecosystem.config.cjs — #3271 put runtime flags there
      # precisely because dotenv cannot override a value pm2 already set). So a
      # file that says sslmode=disable here produces a worker that tries TLS
      # against a plaintext server and dies in a restart loop, while this script
      # still says "done" — the exact failure #3278 is about. The runbook's own
      # §3.5 checklist reads "no sslmode=disable anywhere" for the same reason.
      die "Postgres answered ssl=$setting. This install path needs a TLS data tier: ecosystem.config.cjs pins DATABASE_SSL=true for web, worker and cron, so sslmode=disable would have the pool attempt TLS against a plaintext server. Same-host: set 'ssl = on' in postgresql.conf, reload, and re-run — the packaged snakeoil certificate is fine on loopback. Remote: fix the connection or terminate TLS in front of it."
      ;;
  esac
  APP_DATABASE_URL="postgresql://nucrm_app:${APP_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=${SSLMODE}"
  OWNER_DATABASE_URL="postgresql://${OWNER_ROLE}:${OWNER_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?sslmode=${SSLMODE}"
}

# ── 3. The env file: umask 077 before, chmod 600 after, no value printed ─────
ENV_TARGET=${ENV_ONLY_PATH:-"$APP_DIR/$ENV_PREVIEW_NAME"}
if [ "$ENV_ONLY" != 1 ]; then ENV_TARGET="$APP_DIR/$ENV_NAME"; fi
write_env_file() {
  run mkdir -p "$(dirname "$ENV_TARGET")"
  # docs/credential-hygiene.md:35 requires the host env file the pm2 app reads to
  # be mode 600. The umask covers creation; the chmod covers a file that already
  # existed with a looser mode.
  local old_umask
  old_umask=$(umask)
  umask 077
  if [ "$DRY_RUN" = 1 ]; then
    printf '[dry-run] write %s (umask 077, then chmod 600)\n' "$ENV_TARGET"
  else
    cat >"$ENV_TARGET" <<ENV
NODE_ENV=production
NEXT_PUBLIC_APP_URL=${APP_URL}
ALLOWED_ORIGINS=${APP_URL}
COOKIE_SECURE=${COOKIE_SECURE}
TRUST_PROXY=true
DATABASE_URL=${APP_DATABASE_URL}
DATABASE_SSL=${DATABASE_SSL}
DATABASE_SSL_REJECT_UNAUTHORIZED=${DATABASE_SSL_REJECT_UNAUTHORIZED}
DATABASE_POOL_SIZE=20
PGBOUNCER_ENABLED=false
REDIS_URL=${REDIS_URL}
JWT_SECRET=${JWT_SECRET}
SESSION_SECRET=${SESSION_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
SETUP_KEY=${SETUP_KEY}
CRON_SECRET=${CRON_SECRET}
EMERGENCY_RECOVERY_KEY=${EMERGENCY_RECOVERY_KEY}
METRICS_SECRET=${METRICS_SECRET}
ENV
    chmod 600 "$ENV_TARGET"
  fi
  umask "$old_umask"
}

# ── 4. Package manager, then the runtime it can actually provide ─────────────
detect_pkg_manager() {
  if [ -f /etc/os-release ]; then . /etc/os-release; else ID=unknown; fi
  if command -v apt-get >/dev/null 2>&1; then
    PKG=apt
  elif command -v dnf >/dev/null 2>&1; then
    PKG=dnf
  elif command -v yum >/dev/null 2>&1; then
    PKG=yum
  else
    die "no apt-get, dnf or yum here (os: ${ID:-unknown}). This script installs Debian-family and RHEL-family VMs; provision the runtime another way, then re-run with --no-build."
  fi
  say "package manager: $PKG (os: ${ID:-unknown})"
}

require_node_version() {
  command -v node >/dev/null 2>&1 || die "node is not on PATH after install"
  local v major minor patch
  v=$(node -v)
  IFS=. read -r major minor patch <<<"${v#v}"
  patch=${patch%%[-+]*}
  if [ "$major" -lt "$REQUIRED_NODE_MAJOR" ] ||
    { [ "$major" -eq "$REQUIRED_NODE_MAJOR" ] && [ "$minor" -lt "$REQUIRED_NODE_MINOR" ]; } ||
    { [ "$major" -eq "$REQUIRED_NODE_MAJOR" ] && [ "$minor" -eq "$REQUIRED_NODE_MINOR" ] && [ "$patch" -lt "$REQUIRED_NODE_PATCH" ]; }; then
    die "$v is below the app's engines floor ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}.${REQUIRED_NODE_PATCH} — npm ci and the build will fail on it. Enable a newer node stream (dnf module enable nodejs:22) or the NodeSource repo, then re-run."
  fi
  say "node $v satisfies engines >=${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}.${REQUIRED_NODE_PATCH}"
}

install_packages() {
  case "$PKG" in
    apt)
      run sudo apt-get update
      run sudo apt-get install -y curl git postgresql redis-server
      run bash -c "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
      run sudo apt-get install -y nodejs
      ;;
    dnf | yum)
      run sudo "$PKG" install -y curl git postgresql-server redis
      # RHEL-family ships Node in a stream; the app needs 22.23.4+ (package.json
      # engines). Enabling it is best-effort — require_node_version below is the
      # check that actually decides.
      if command -v dnf >/dev/null 2>&1; then
        run sudo dnf module enable -y nodejs:22 || true
      fi
      run sudo "$PKG" install -y nodejs npm
      if [ "$DRY_RUN" != 1 ] && [ ! -d /var/lib/pgsql/data ]; then
        run sudo postgresql-setup --initdb
      fi
      ;;
  esac
  if [ "$DRY_RUN" != 1 ]; then
    require_node_version
  else
    say "dry-run: skipping the node version probe (no runtime was installed here)"
  fi
}

# ── 5. Repository checkout — BEFORE the env file ─────────────────────────────
# Order matters: the env file lives inside the repo (see ENV_NAME), and `git
# clone` refuses a directory that already has anything in it.
fetch_app() {
  run mkdir -p "$APP_DIR"
  if [ -d "$APP_DIR/repo/.git" ]; then
    say "reusing the existing checkout at $APP_DIR/repo"
  else
    run git clone "$REPO_URL" "$APP_DIR/repo"
  fi
  # npm ci, like deploy.yml: a lockfile-pinned install is the difference between
  # "this repo" and "whatever the registry resolves today".
  run bash -c "cd '$APP_DIR/repo' && npm ci"
}

# ── 6. Database and the least-privilege role ─────────────────────────────────
setup_database() {
  if [ "$DRY_RUN" = 1 ]; then
    run sudo systemctl enable --now postgresql
    run sudo -u "$OWNER_ROLE" createdb "$DB_NAME"
    run_redacted "cd $APP_DIR/repo && DATABASE_URL='<owner>' OWNER_ROLE=$OWNER_ROLE NUCRM_APP_PASSWORD='<generated>' npx tsx scripts/provision-app-role.mjs" \
      true
    return
  fi
  if ! sudo systemctl is-active --quiet postgresql; then
    run sudo systemctl enable --now postgresql || die "postgresql would not start"
  fi
  sudo -u "$OWNER_ROLE" psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 ||
    run sudo -u "$OWNER_ROLE" createdb "$DB_NAME"
  # Host TCP connections (psql in provision-app-role.mjs, pg in migrate) cannot
  # use the systemd unit's peer auth, so the owner role needs a password. It is
  # generated per run and never printed; the operator's own path stays peer auth.
  run_redacted "sudo -u $OWNER_ROLE psql -c 'ALTER USER $OWNER_ROLE WITH PASSWORD <generated>;'" \
    sudo -u "$OWNER_ROLE" psql -c "ALTER USER $OWNER_ROLE WITH PASSWORD '${OWNER_DB_PASSWORD}';"
  # The app role comes from the repo's own idempotent provisioner, run BEFORE any
  # table exists so ALTER DEFAULT PRIVILEGES covers what the chain creates after.
  # The app never connects as $OWNER_ROLE: a superuser bypasses RLS by definition
  # and makes every FORCE-RLS policy decorative (#2253).
  # One simple command, so the three assignments really are its environment:
  # broken across lines, `VAR=x` on its own is a shell variable the child never
  # sees, and the provisioner dies with "DATABASE_URL is required".
  run_redacted "cd $APP_DIR/repo && DATABASE_URL='<owner>' OWNER_ROLE=$OWNER_ROLE NUCRM_APP_PASSWORD='<generated>' npx tsx scripts/provision-app-role.mjs" \
    bash -c "cd '$APP_DIR/repo' && DATABASE_URL='$OWNER_DATABASE_URL' OWNER_ROLE='$OWNER_ROLE' NUCRM_APP_PASSWORD='$APP_DB_PASSWORD' npx tsx scripts/provision-app-role.mjs"
}

# ── 7. Migrations, then the guard that proves the role is least-privilege ────
apply_migrations() {
  # db:migrate, never drizzle-kit push — AGENTS.md says so in terms, and the
  # guards and the journal are built around the chain.
  run_redacted "cd $APP_DIR/repo && DATABASE_URL='<owner>' npm run db:migrate -- --yes" \
    bash -c "cd '$APP_DIR/repo' && DATABASE_URL='$OWNER_DATABASE_URL' npm run db:migrate -- --yes"
  # tsx, not node: the .mjs imports lib/db/least-privilege.ts (same reason
  # provision-app-role.mjs is run through npx tsx above).
  run_redacted "cd $APP_DIR/repo && DATABASE_URL='<app>' npx tsx scripts/check-db-role-privileges.mjs" \
    bash -c "cd '$APP_DIR/repo' && DATABASE_URL='$APP_DATABASE_URL' npx tsx scripts/check-db-role-privileges.mjs"
}

# ── 8. The gate the app itself uses, run against the file just written ───────
# assert-runtime-env.mjs (#3279) is the repo's own answer to "right in the file,
# absent from the process". Calling it here means a key this script forgets, or a
# pair that contradicts the pm2 env: block, fails the install instead of turning
# into a server that 503s every login.
gate_runtime_env() {
  local intent=''
  if [ "$COOKIE_SECURE" = true ]; then
    intent='--expect-production'
  else
    # The gate fails a cleartext NEXT_PUBLIC_APP_URL on purpose, which is correct
    # for a real deploy and wrong company for a pre-DNS smoke test. Without the
    # intent flag the same table is still read, and the #3274 warning above stays
    # the operator's problem to fix before this box takes traffic.
    say "WARNING: skipping --expect-production because APP_URL is not https. This is a smoke test, not a production install (deploy/scripts/setup-ssl.sh, #1040)."
  fi
  if [ "$DRY_RUN" = 1 ]; then
    printf '[dry-run] cd %s && node scripts/assert-runtime-env.mjs%s\n' "$APP_DIR/repo" "${intent:+ $intent}"
    return 0
  fi
  (cd "$APP_DIR/repo" && node scripts/assert-runtime-env.mjs ${intent+"$intent"}) ||
    die "the runtime environment gate refused the install. Fix .env.local (or the pm2 env: block it contradicts) and re-run — the app is not built yet, so nothing here needs unwinding."
}

build_app() { run bash -c "cd '$APP_DIR/repo' && npm run build"; }

start_app() {
  if ! command -v pm2 >/dev/null 2>&1; then run npm install -g pm2; fi
  # All three apps, not `--only web`: worker.ts and scripts/cron-scheduler.ts are
  # what moves queued mail and fires /api/cron/*, and an install that starts a
  # front end over an empty queue looks fine for exactly as long as nobody waits
  # for an email. --update-env is load-bearing (#3271): pm2 replays the
  # environment it captured at first start, so a config-only change never reaches
  # the workers.
  run bash -c "cd '$APP_DIR/repo' && pm2 start ecosystem.config.cjs --update-env"
  run bash -c "cd '$APP_DIR/repo' && pm2 save"
  if [ "$DRY_RUN" = 1 ]; then
    say "dry-run: would poll $HEALTH_URL for up to $HEALTH_TRIES probes"
    return 0
  fi
  local n code=000
  for ((n = 1; n <= HEALTH_TRIES; n++)); do
    # Two details that look cosmetic and are not. No -f: on a 404 curl exits 22
    # *after* -w has already printed 404, so an `|| echo` inside the substitution
    # appends and the operator reads "last status 404000". Same for a refused
    # connection, which prints 000 and then 000 again. The fallback is therefore an
    # assignment outside the substitution — still needed, because under set -e a
    # failing substitution aborts the script through the assignment's exit status.
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null) || code=000
    if [ "$code" = 200 ]; then say "health answered 200 after $n probe(s)"; return 0; fi
    sleep 2
  done
  die "$HEALTH_URL never answered 200 (last status $code) in $HEALTH_TRIES probes. The app is NOT ready — check 'pm2 logs'. The one-shot setup endpoint has not been called, so re-running after a fix is safe."
}

# ── 9. The one-shot bootstrap, asserted by status, not by curl's exit code ───
create_admin() {
  local escaped payload body code reason
  escaped=${ADMIN_PASSWORD//\\/\\\\}
  escaped=${escaped//\"/\\\"}
  if [ "$DRY_RUN" = 1 ]; then
    say "dry-run: would POST ${APP_URL%/}/api/setup/create-admin with the x-setup-key header and a 0600 payload file (neither value printed)"
    return 0
  fi
  payload=$(mktemp)
  body=$(mktemp)
  # The credential goes in a 0600 file, not in argv: a command-line argument is
  # readable by any local process through /proc.
  printf '{"email":"%s","password":"%s","full_name":"Admin","workspace_name":"NuCRM"}' "$ADMIN_EMAIL" "$escaped" >"$payload"
  code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 30 -X POST "${APP_URL%/}/api/setup/create-admin" \
    -H 'Content-Type: application/json' \
    -H "X-Setup-Key: $SETUP_KEY" \
    --data @"$payload") || code=000
  rm -f "$payload"
  case "$code" in
    200 | 201) say "platform super admin created" ;;
    403)
      # Two different 403s, and telling the operator the wrong one wastes the
      # whole maintenance window: the admin already exists, or the key did not.
      if grep -qi 'already exists' "$body"; then
        say "setup already complete — one platform super admin exists and the endpoint refuses a second (app/api/setup/create-admin/route.ts). Not an error."
      else
        rm -f "$body"
        die "the setup endpoint rejected the key (403). SETUP_KEY in $ENV_TARGET must equal the value the server process loaded — pm2 replays its captured env, so reload with --update-env and re-run."
      fi
      ;;
    000)
      rm -f "$body"
      die "no answer from ${APP_URL%/}/api/setup/create-admin. $HEALTH_URL answered 200, so the app is up and the PUBLIC EDGE is what is missing: nginx and TLS are this script's neighbours, not its steps (deploy/scripts/setup-ssl.sh, #1040). Configure them and re-run — every step above is idempotent, and the admin has NOT been created."
      ;;
    *)
      reason=$(node -e 'try{const j=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.error||j.message||"").slice(0,200))}catch{process.stdout.write("unparseable response")}' "$body" 2>/dev/null || echo 'unreadable response')
      rm -f "$body"
      die "setup endpoint answered HTTP $code: $reason — the admin was NOT created. Fix and re-run; nothing here is retried silently."
      ;;
  esac
  rm -f "$body"
}

# ── Run ───────────────────────────────────────────────────────────────────────
# --env-only is the one mode that must touch nothing else: it exists so the file
# can be inspected, mode-checked and unit-tested on a host with no Postgres, no
# network and no sudo.
if [ "$ENV_ONLY" = 1 ]; then
  probe_db_ssl
  write_env_file
  mode=$(stat -c '%a' "$ENV_TARGET" 2>/dev/null || echo '??')
  say "wrote $ENV_TARGET (mode $mode); no secret value was printed"
  say "the live install writes it to $APP_DIR/$ENV_NAME, after the checkout"
  exit 0
fi

detect_pkg_manager
install_packages
probe_db_ssl
fetch_app
write_env_file
setup_database
apply_migrations
gate_runtime_env
if [ "$NO_BUILD" = 1 ]; then say "--no-build: stopping before build and start; the app is not running"; exit 0; fi
build_app
start_app
create_admin

say "done."
say "  app dir    : $APP_DIR/repo"
say "  env file   : $ENV_TARGET (mode 600 — never commit it)"
say "  setup key  : stored as SETUP_KEY in that file; its value was never printed. Setup is one-shot: the endpoint refuses a second platform super admin."
say "  still owed : pm2 startup (without it a reboot takes the app down), the public edge (nginx + TLS — deploy/scripts/setup-ssl.sh, #1040), BACKUP_DATABASE_URL (a BYPASSRLS backup role) and the host crontab (deploy/cron/crontab) — deploy/LAUNCH_RUNBOOK.md"
say "  verify     : curl -H 'X-Forwarded-For: 203.0.113.7' $HEALTH_URL, then sign in at $APP_URL"
