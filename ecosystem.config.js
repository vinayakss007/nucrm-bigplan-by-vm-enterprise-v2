/**
 * PM2 Ecosystem Configuration — NuCRM Horizontal Scaling
 *
 * Runs multiple Next.js frontend instances across CPU cores.
 * PM2 handles process management, auto-restart, and load balancing.
 *
 * Usage:
 *   pm2 start ecosystem.config.js              # Start all apps
 *   pm2 start ecosystem.config.js --only web   # Start only frontend
 *   pm2 scale web +2                           # Add 2 more instances
 *   pm2 scale web 4                            # Set to exactly 4 instances
 *   pm2 reload web                             # Zero-downtime reload
 *   pm2 monit                                  # Live monitoring dashboard
 *   pm2 logs                                   # View logs
 *
 * Environment Variables:
 *   NUCRM_INSTANCES  — Number of frontend instances (default: "max" = all CPU cores)
 *   NUCRM_PORT       — Base port (default: 3000, each instance gets PORT+i)
 *   NUCRM_MAX_MEMORY — Max memory per instance in MB before restart (default: 512)
 *   NUCRM_WORKER_INSTANCES — Number of worker processes (default: 2)
 */

module.exports = {
  apps: [
    // ── Frontend (Next.js) ──────────────────────────────────────────────────
    {
      name: 'web',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: __dirname,

      // Cluster mode — multiple instances behind PM2 load balancer
      instances: process.env.NUCRM_INSTANCES || 'max',
      exec_mode: 'cluster',

      // Port assignment — each instance gets a unique port
      // PM2 in cluster mode + Next.js listens on PORT env
      env: {
        NODE_ENV: 'production',
        PORT: process.env.NUCRM_PORT || 3000,
      },

      // Memory management — restart if exceeds limit (prevents OOM)
      max_memory_restart: `${process.env.NUCRM_MAX_MEMORY || 512}M`,

      // Auto-restart on crash
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 1000,

      // Graceful shutdown — wait for in-flight requests
      kill_timeout: 10000,        // 10s to finish requests
      listen_timeout: 5000,       // 5s to start accepting
      shutdown_with_message: true,

      // Logging
      log_file: '/var/log/nucrm/web-combined.log',
      out_file: '/var/log/nucrm/web-out.log',
      error_file: '/var/log/nucrm/web-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,

      // Health monitoring
      max_memory_restart: `${process.env.NUCRM_MAX_MEMORY || 512}M`,

      // Watch for config changes (disabled in production)
      watch: false,

      // Environment-specific overrides
      env_production: {
        NODE_ENV: 'production',
      },
      env_staging: {
        NODE_ENV: 'staging',
      },
    },

    // ── Background Worker (BullMQ) ──────────────────────────────────────────
    {
      name: 'worker',
      script: 'node_modules/.bin/tsx',
      args: 'worker.ts',
      cwd: __dirname,

      // Workers can also scale horizontally
      instances: process.env.NUCRM_WORKER_INSTANCES || 2,
      exec_mode: 'cluster',

      env: {
        NODE_ENV: 'production',
      },

      // Workers tend to hold more data in memory
      max_memory_restart: `${process.env.NUCRM_MAX_MEMORY || 768}M`,

      autorestart: true,
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 2000,

      // Workers need more time to finish jobs
      kill_timeout: 30000, // 30s for in-flight jobs

      // Logging
      log_file: '/var/log/nucrm/worker-combined.log',
      out_file: '/var/log/nucrm/worker-out.log',
      error_file: '/var/log/nucrm/worker-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,

      watch: false,
    },

    // ── Cron Scheduler (optional — for self-hosted without external cron) ───
    {
      name: 'cron',
      script: 'node_modules/.bin/tsx',
      args: 'scripts/cron-scheduler.ts',
      cwd: __dirname,

      // Only 1 cron instance ever (prevents duplicate scheduling)
      instances: 1,
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'production',
      },

      max_memory_restart: '256M',
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s',

      // Logging
      log_file: '/var/log/nucrm/cron-combined.log',
      out_file: '/var/log/nucrm/cron-out.log',
      error_file: '/var/log/nucrm/cron-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',

      watch: false,
    },
  ],

  // ── PM2 Deploy Configuration (optional — for multi-VM setups) ─────────────
  deploy: {
    production: {
      user: 'nucrm',
      host: ['web-01.nucrm.internal', 'web-02.nucrm.internal'],
      ref: 'origin/main',
      repo: 'git@github.com:vinayakss007/nucrm-bigplan-by-vm-enterprise-v2.git',
      path: '/opt/nucrm',
      'pre-deploy-local': '',
      'post-deploy': 'npm ci --production && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'mkdir -p /var/log/nucrm',
    },
    staging: {
      user: 'nucrm',
      host: 'staging.nucrm.internal',
      ref: 'origin/develop',
      repo: 'git@github.com:vinayakss007/nucrm-bigplan-by-vm-enterprise-v2.git',
      path: '/opt/nucrm-staging',
      'post-deploy': 'npm ci && npm run build && pm2 reload ecosystem.config.js --env staging',
      'pre-setup': 'mkdir -p /var/log/nucrm',
    },
  },
};
