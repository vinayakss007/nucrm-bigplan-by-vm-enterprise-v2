module.exports = {
  apps: [{
    name: 'nucrm',
    script: 'node_modules/.bin/next',
    args: 'start -H 127.0.0.1 -p 3000',
    cwd: '/home/vinayak_shruti_biz/nucrm-enterprise',
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=2048',
      PORT: '3000',
      HOST: '127.0.0.1',
    },
    env_file: '.env.local',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '4G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 5000,
    stop_exit_codes: [0],
    kill_timeout: 10000,
  }]
};
