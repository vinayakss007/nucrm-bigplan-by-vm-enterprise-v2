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
 * code); the two `tsx` processes (worker, cron) get it from the
 * `--import ./scripts/load-env.mjs` preload, because tsx does not read .env* at
 * all. Without the preload those processes start with an empty environment:
 * cron died with "FATAL: CRON_SECRET is required" (5 restarts → "errored") and
 * the worker silently fell back to redis://localhost:6379.
 *
 * Host vs Docker networking: this VM serves public traffic from the Docker
 * stack, whose .env.local carries Docker-network names
 * (REDIS_URL=redis://redis, S3_ENDPOINT=http://minio). Those names do NOT
 * resolve on the host, so every app below overrides them to the loopback
 * ports the infra compose publishes (Redis 127.0.0.1:6379, MinIO
 * 127.0.0.1:9000). dotenv/Next.js never overwrite variables already present in
 * the process environment, which is why these `env:` overrides win over the
 * file for all three apps. Override with NUCRM_REDIS_URL / NUCRM_S3_ENDPOINT.
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
 */

// PM2 evaluates this file with an empty environment (no dotenv), but the
// repo's .env.local pins replica counts / memory caps for this single-VM
// topology (same values the compose stacks read). Parse just enough of the
// file to honour them; runtime env still comes from Next.js + load-env.mjs.
const FILE_ENV = (() => {
  try {
    const out = {};
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

      // Environment comes from .env.local — no secrets in this file.
      // Next.js loads .env.local itself; PM2's env_file is a no-op (#1424).
      env: {
        NODE_ENV: 'production',
        PORT: setting('NUCRM_PORT') || 3000,
        DATABASE_SSL: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
        REDIS_URL: setting('NUCRM_REDIS_URL') || 'redis://127.0.0.1:6379',
        S3_ENDPOINT: setting('NUCRM_S3_ENDPOINT') || 'http://127.0.0.1:9000',
      },

      max_memory_restart: `${process.env.NUCRM_MAX_MEMORY || 512}M`,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,

      // Graceful shutdown — finish in-flight requests before exit.
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
      args: 'worker.ts',
      cwd: __dirname,

      instances: process.env.NUCRM_WORKER_INSTANCES || 2,
      exec_mode: 'cluster',

      env_file: '.env.local',
      env: {
        NODE_ENV: 'production',
        DATABASE_SSL: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
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
      args: 'scripts/cron-scheduler.ts',
      cwd: __dirname,

      instances: 1,          // exactly one — prevents duplicate scheduling
      exec_mode: 'fork',

      env_file: '.env.local',
      env: {
        NODE_ENV: 'production',
        DATABASE_SSL: 'true',
        DATABASE_SSL_REJECT_UNAUTHORIZED: 'false',
      },

      max_memory_restart: '256M',
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s',

      out_file: `${LOG_DIR}/cron-out.log`,
      error_file: `${LOG_DIR}/cron-error.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
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
