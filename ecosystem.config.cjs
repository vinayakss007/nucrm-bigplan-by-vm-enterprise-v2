/**
 * PM2 Ecosystem Configuration — NuCRM (single canonical config)  [#1424]
 *
 * This is the ONE PM2 config for the project. The former ecosystem.config.js
 * (cluster/scaling variant) was merged into this file and removed to end the
 * two-config drift. `.cjs` is used so it is unambiguously CommonJS regardless
 * of package.json "type".
 *
 * Portability: cwd uses __dirname (no hardcoded machine paths) and NO secrets
 * live in this file — every app loads its environment from .env.local
 * (generated via deploy/generate-secrets.sh). Never commit secrets here.
 *
 * Loading .env.local: PM2 7.x does NOT implement the `env_file` key — it is
 * accepted and silently ignored — so every app below loads its environment
 * itself. `web` gets it from Next.js (which reads .env.local before running any
 * code); the three `tsx` processes (worker, cron, realtime) get it from the
 * `--import ./scripts/load-env.mjs` preload, because tsx does not read .env* at
 * all. Without the preload those processes start with an empty environment:
 * cron died with "FATAL: CRON_SECRET is required" (5 restarts → "errored") and
 * the worker silently fell back to redis://localhost:6379.
 *
 * A claim is not a check: until #3251 both `args` carried the bare script path,
 * so the preload above was intent rather than config.
 * tests/unit/pm2-sidecar-env-preload-3251.test.ts pins both halves — the
 * preload on every `tsx` app, and no app advertising a key PM2 ignores.
 *
 * The exception list (#3271): "Next.js reads .env.local" is true of the file's
 * contents but NOT of a value the deployment must guarantee, because pm2 replays
 * the environment it captured at first `start` — a config-only change reaches the
 * workers only with `pm2 reload --update-env`. TRUST_PROXY lives in the `web` env
 * block below for that reason; without it getClientIp() answers 'unknown' and
 * every auth endpoint fails closed with 503. Runtime flags go in `env:`, secrets
 * stay in .env.local.
 *
 * Host vs Docker networking: this VM serves public traffic from the Docker stack,
 * whose .env.local carries Docker-network names
 * (REDIS_URL=redis://redis, S3_ENDPOINT=http://minio). Those names do NOT
 * resolve on the host, so every app below overrides them to the loopback
 * ports the infra compose publishes (Redis 127.0.0.1:6379, MinIO
 * 127.0.0.1:9000). dotenv/Next.js never overwrite variables already present in
 * the process environment, which is why these `env:` overrides win over the
 * file for every app below. Override with NUCRM_REDIS_URL / NUCRM_S3_ENDPOINT.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs                 # start all apps
 *   pm2 start ecosystem.config.cjs --only web      # frontend only
 *   pm2 scale web 4                                # set 4 frontend instances
 *   pm2 reload ecosystem.config.cjs                # zero-downtime reload
 *   pm2 save && pm2 startup                        # REQUIRED: survive reboot
 *   pm2 logs / pm2 monit
 *
 * Tunables (shell env when invoking pm2, else read from .env.local):
 *   NUCRM_INSTANCES         frontend instances        (default: "max")
 *   NUCRM_HOST              frontend bind address      (default: 127.0.0.1)
 *   NUCRM_PORT              frontend base port         (default: 3000)
 *   NUCRM_MAX_MEMORY        MB before frontend restart (default: 512)
 *   NUCRM_WORKER_INSTANCES  worker processes           (default: 2)
 *   NUCRM_LOG_DIR           log directory              (default: ./logs)
 *   NUCRM_REDIS_URL         Redis URL as seen FROM THE HOST
 *   NUCRM_S3_ENDPOINT       S3 URL as seen FROM THE HOST
 *   NUCRM_TRUST_PROXY       'true' only when a trusted proxy sets the headers
 *                           the app reads client IPs from (default: 'true'; the
 *                           VM's nginx does — see #3271)
 */

// PM2 evaluates this file with an empty environment (no dotenv), but the
// repo's .env.local pins replica counts / memory caps for this single-VM
// topology (same values the compose stacks read). Parse just enough of the
// file to honour them; runtime env still comes from Next.js + load-env.mjs.
const FILE_ENV = (() => {
  try {
    const out = {};
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- .cjs has no import syntax; require is the only option
    for (const line of require('node:fs')
      .readFileSync(`${__dirname}/.env.local`, 'utf8')
      .split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
})();
const setting = (name) => process.env[name] ?? FILE_ENV[name];

const LOG_DIR = setting('NUCRM_LOG_DIR') || `${__dirname}/logs`;

module.exports = {
  apps: [
    // ── Frontend (Next.js) ────────────────────────────────────────────────
    {
      name: 'web',
      script: 'node_modules/.bin/next',
      // Bind to loopback by default (#1042): `next start` binds 0.0.0.0 unless
      // given -H, which would expose port 3000 on the VM's public interface.
      // nginx (the only public service) proxies to 127.0.0.1:3000. Override
      // NUCRM_HOST=0.0.0.0 only when nginx runs in a separate network namespace.
      args: `start -H ${setting('NUCRM_HOST') || '127.0.0.1'}`,
      cwd: __dirname,

      instances: setting('NUCRM_INSTANCES') || 'max',
      exec_mode: 'cluster',

      // Secrets stay out of this file (they come from .env.local); runtime
      // flags belong here, because pm2 replays its captured env and Next.js's
      // own .env.local read cannot guarantee them (#3271). PM2's env_file is a
      // no-op (#1424).
      env: {
        NODE_ENV: 'production',
        PORT: setting('NUCRM_PORT') || 3000,
        DATABASE_SSL: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
        REDIS_URL: setting('NUCRM_REDIS_URL') || 'redis://127.0.0.1:6379',
        S3_ENDPOINT: setting('NUCRM_S3_ENDPOINT') || 'http://127.0.0.1:9000',
        // #2116: nginx sends a single-hop authoritative X-Forwarded-For
        // ($remote_addr) and is the only public service here (see the -H bind
        // above), so the app may trust the header. The Docker path pins the
        // same value in deploy/docker-compose.production.yml.
        TRUST_PROXY: setting('NUCRM_TRUST_PROXY') || 'true',
      },

      max_memory_restart: `${process.env.NUCRM_MAX_MEMORY || 512}M`,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,

      // Graceful shutdown, not zero-downtime: pm2's `wait_ready` needs a readiness signal and `next start` never sends one, so a reload costs a brief 502 window — deploy/LAUNCH_RUNBOOK.md §9 (#3275).
      kill_timeout: 10000,
      listen_timeout: 5000,
      shutdown_with_message: true,

      out_file: `${LOG_DIR}/web-out.log`,
      error_file: `${LOG_DIR}/web-error.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      watch: false,
    },

    // ── Background Worker (BullMQ) ────────────────────────────────────────
    {
      name: 'worker',
      script: 'node_modules/.bin/tsx',
      args: '--import ./scripts/load-env.mjs worker.ts',
      cwd: __dirname,

      instances: process.env.NUCRM_WORKER_INSTANCES || 2,
      exec_mode: 'cluster',

      env: {
        NODE_ENV: 'production',
        DATABASE_SSL: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
        // The `--import` preload in `args` makes .env.local reachable, and on this
        // VM that file carries the Docker names; dotenv will not overwrite what is
        // already set, so the host-side pair here is what keeps the sidecars
        // resolvable (#3251).
        REDIS_URL: setting('NUCRM_REDIS_URL') || 'redis://127.0.0.1:6379',
        S3_ENDPOINT: setting('NUCRM_S3_ENDPOINT') || 'http://127.0.0.1:9000',
      },

      // Workers hold more in memory (job payloads).
      max_memory_restart: `${process.env.NUCRM_WORKER_MAX_MEMORY || 768}M`,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 2000,
      kill_timeout: 30000, // 30s for in-flight jobs

      out_file: `${LOG_DIR}/worker-out.log`,
      error_file: `${LOG_DIR}/worker-error.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      watch: false,
    },

    // ── Cron Scheduler ────────────────────────────────────────────────────
    // Only enable ONE cron source per environment (see deploy/cron/crontab and
    // the #1422 scheduler policy). Use this app only if you are NOT running the
    // host crontab.
    {
      name: 'cron',
      script: 'node_modules/.bin/tsx',
      args: '--import ./scripts/load-env.mjs scripts/cron-scheduler.ts',
      cwd: __dirname,

      instances: 1,          // exactly one — prevents duplicate scheduling
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'production',
        DATABASE_SSL: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
        // Same host pair as worker: the preload reaches .env.local here too.
        REDIS_URL: setting('NUCRM_REDIS_URL') || 'redis://127.0.0.1:6379',
        S3_ENDPOINT: setting('NUCRM_S3_ENDPOINT') || 'http://127.0.0.1:9000',
      },

      max_memory_restart: '256M',
      autorestart: true,
      // 10, not 5, and with a delay: max_restarts resets only on a restart that
      // survives min_uptime, so a boot that exits non-zero at its config audit
      // spent the whole allowance in seconds and left cron "errored" for a human.
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,

      out_file: `${LOG_DIR}/cron-out.log`,
      error_file: `${LOG_DIR}/cron-error.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      // #3253: fork mode appends the process id to the file name unless
      // merge_logs is set, so without this pm2 writes `cron-out-0.log` and the
      // path declared above never exists. web and worker already set it.
      merge_logs: true,
      watch: false,
    },

    // ── Realtime (socket.io) ──────────────────────────────────────────────
    // #3252: deploy/nginx/nginx-production.conf proxies /socket.io/ to an
    // upstream on 4001 and realtime.ts binds it — but until now nothing on the
    // pm2 host started realtime.ts, so every websocket handshake 502ed, and
    // nginx logged the upstream failures where the app's error pipeline could
    // not see them. One fork instance: socket.io rooms are shared through
    // Redis (@socket.io/redis-adapter in realtime.ts), not process memory, so
    // a second instance duplicates work without adding capacity.
    {
      name: 'realtime',
      script: 'node_modules/.bin/tsx',
      args: '--import ./scripts/load-env.mjs realtime.ts',
      cwd: __dirname,

      instances: 1,          // exactly one — see the fork note above
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'production',
        DATABASE_SSL: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
        // Bind loopback explicitly (#1042's rule for `web`): nginx is the only
        // public service here, so 4001 must not reach the VM's public interface.
        REALTIME_HOST: '127.0.0.1',
        REALTIME_PORT: 4001,
        REDIS_URL: setting('NUCRM_REDIS_URL') || 'redis://127.0.0.1:6379',
        S3_ENDPOINT: setting('NUCRM_S3_ENDPOINT') || 'http://127.0.0.1:9000',
      },

      max_memory_restart: '512M',
      autorestart: true,
      // Same restart budget as web: a socket.io handshake storm must not spend
      // a smaller allowance than the frontend gets.
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,
      kill_timeout: 10000,

      out_file: `${LOG_DIR}/realtime-out.log`,
      error_file: `${LOG_DIR}/realtime-error.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      watch: false,
    },
  ],

  // ── PM2 Deploy Configuration (optional — multi-VM setups) ────────────────
  deploy: {
    production: {
      user: 'nucrm',
      host: ['web-01.nucrm.internal', 'web-02.nucrm.internal'],
      ref: 'origin/main',
      repo: 'git@github.com:vinayakss007/nucrm-bigplan-by-vm-enterprise-v2.git',
      path: '/opt/nucrm',
      'pre-deploy-local': '',
      'post-deploy': 'npm ci --production && npm run build && pm2 reload ecosystem.config.cjs --env production',
      'pre-setup': 'mkdir -p /var/log/nucrm',
    },
    staging: {
      user: 'nucrm',
      host: 'staging.nucrm.internal',
      ref: 'origin/develop',
      repo: 'git@github.com:vinayakss007/nucrm-bigplan-by-vm-enterprise-v2.git',
      path: '/opt/nucrm-staging',
      'post-deploy': 'npm ci && npm run build && pm2 reload ecosystem.config.cjs --env staging',
      'pre-setup': 'mkdir -p /var/log/nucrm',
    },
  },
};
