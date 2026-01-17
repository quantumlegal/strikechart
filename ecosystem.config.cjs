module.exports = {
  apps: [{
    name: 'strikechart',
    script: 'dist/web-index.js',
    instances: 'max',
    exec_mode: 'cluster',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // Auto-restart on crash
    autorestart: true,
    watch: false,
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,
    // Logging
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
  }]
};
