# Credential Hygiene — Secrets as Files (#2123)

## The problem

Any value passed through a container's `environment:` (or `command:`) is
visible to every user in the `docker` group via `docker inspect`. A leaked
`JWT_SECRET`/`SESSION_SECRET` allows minting valid sessions for any tenant.

## How this repo addresses it

1. **App code** — `lib/secrets-file.ts` materializes files bind-mounted at
   `/run/secrets` into `process.env` at startup (file `jwt_secret` →
   `JWT_SECRET`). It runs first in all three server entries:
   `instrumentation.ts` (web), `worker.ts`, and `realtime.ts`. Existing env
   values win — the loader only fills variables that are unset/empty — so
   `.env.local` development is unchanged and hosts without the overlay are a
   no-op.
2. **Compose overlay** — `docker-compose.secrets.yml` drops the secret env
   vars from `web`/`worker`/`realtime` (and uses the images' native file
   mechanisms for `postgres`, `redis`, `grafana`) and mounts `./secrets/`
   read-only:

   ```bash
   mkdir -p secrets && chmod 700 secrets
   # one file per secret, chmod 600, content = the secret value:
   #   jwt_secret session_secret setup_key cron_secret encryption_key
   #   database_url redis_url redis_password s3_secret_key
   #   postgres_password grafana_admin_password
   docker compose -f docker-compose.yml -f docker-compose.secrets.yml up -d
   ```

3. **Verification** — with the overlay active,
   `docker inspect nucrm-app | grep -i secret` shows no values; the only
   copies on disk are `./secrets/` (mode 600 files, git-ignored) and the
   host env file the pm2 app uses (keep it mode 600 too).

## Not covered here (operational)

- **Rotation**: any secret that was exposed through the old env-var compose
  (or a clone remote URL) must be rotated — the file mechanism prevents new
  exposure, it cannot un-expose old values.
- `minio`/`pgbouncer` still take credentials via interpolation; give the
  deploy user only what's needed, or run those services isolated from
  untrusted accounts.
- The pm2 production path reads `~/.env`-style files directly; ensure those
  are `chmod 600` and not world-readable.
