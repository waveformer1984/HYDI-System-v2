'use strict';

const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

module.exports = {
  apps: [
    {
      name: 'lifeline',
      script: path.join('services', 'lifeline', 'server.js'),
      cwd: repoRoot,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 1000,
      exp_backoff_restart_delay: 2000,
      max_memory_restart: '120M',
      windowsHide: true,
      env: {
        LIFELINE_BIND: '127.0.0.1',
        LIFELINE_PORT: '3090',
      },
      error_file: path.join(repoRoot, 'logs', 'pm2-lifeline.err.log'),
      out_file: path.join(repoRoot, 'logs', 'pm2-lifeline.out.log'),
      merge_logs: true,
    },
  ],
};