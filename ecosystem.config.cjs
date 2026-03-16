module.exports = {
  apps: [
    {
      name: 'nanoclaw',
      script: 'dist/index.js',
      cwd: 'C:/Users/ACER/OneDrive/Revaquo/revaquo-nanoclaw',
      // Auto-restart on crash
      autorestart: true,
      // Wait 5s before restarting after crash
      restart_delay: 5000,
      // Max 10 restarts in 60s before giving up (prevents crash loops)
      max_restarts: 10,
      min_uptime: '10s',
      // Restart if memory exceeds 1GB (prevents memory leaks)
      max_memory_restart: '1G',
      // Log files
      out_file: 'logs/nanoclaw-pm2-out.log',
      error_file: 'logs/nanoclaw-pm2-err.log',
      // Merge stdout and stderr
      merge_logs: true,
      // Log dates
      time: true,
      // Environment
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'nanoclaw-watchdog',
      script: 'watchdog.sh',
      interpreter: 'bash',
      cwd: 'C:/Users/ACER/OneDrive/Revaquo/revaquo-nanoclaw',
      // Run every 60 seconds as a cron-restart
      cron_restart: '*/1 * * * *',
      autorestart: false,
      out_file: 'logs/watchdog.log',
      error_file: 'logs/watchdog.log',
      merge_logs: true,
      time: true,
    },
  ],
};
