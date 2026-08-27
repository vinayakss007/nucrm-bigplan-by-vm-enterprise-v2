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
 * Usage:
 *   pm2 start ecosystem.config.cjs                 # start all apps
 *   pm2 start ecosystem.config.cjs --only web      # frontend only
 *   pm2 scale web 4                                # set 4 frontend instances
 *   pm2 reload ecosystem.config.cjs                # zero-downtime reload
 *   pm2 logs / pm2 monit
 *
 * Tunables (env):
 *   NUCRM_INSTANCES         frontend instances        (default: "max")
 *   NUCRM_PORT              frontend base port         (default: 3000)
 *   NUCRM_MAX_MEMORY        MB before frontend restart (default: 512)
 *   NUCRM_WORKER_INSTANCES  worker processes           (default: 2)
 *   NUCRM_LOG_DIR           log directory              (default: ./logs)
 */

const LOG_DIR = process.env.NUCRM_LOG_DIR || `${__dirname}/logs`;

module.exports = {
  apps: [
    // ── Frontend (Next.js) ────────────────────────────────────────────────
    {
      name: 'web',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: __dirname,

      instances: process.env.NUCRM_INSTANCES || 'max',
      exec_mode: 'cluster',

      // Environment comes from .env.local — no secrets in this file.
      env_file: '.env.local',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.NUCRM_PORT || 3000,
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
