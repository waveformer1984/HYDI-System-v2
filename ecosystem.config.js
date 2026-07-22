const path = require('path');

// Determine the base directory: Windows dev path or GitHub Actions CI path
const getBaseDir = () => {
  if (process.env.ENVIRONMENT === 'production') {
    // Production: Windows dev machine
    return 'C:\\Users\\Owner\\HYDI_System';
  }
  // CI/Local development: use current working directory
  return process.cwd();
};

const baseDir = getBaseDir();

module.exports = {
  apps: [
    {
      name: 'heidi',
      script: 'heidi-core/server.js',
      cwd: baseDir,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        ENVIRONMENT: process.env.ENVIRONMENT || 'development',
        HEIDI_PORT: '3456'
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 5,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'hydi-processor',
      script: 'hydi-processor.js',
      cwd: baseDir,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        ENVIRONMENT: process.env.ENVIRONMENT || 'development',
        HYDI_CONSUMER_ENABLED: 'true'
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      min_uptime: '10s',
      max_restarts: 5,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'hydi-protoforge',
      script: 'protoforge-main.js',
      args: 'start',
      cwd: baseDir,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        ENVIRONMENT: process.env.ENVIRONMENT || 'development',
        PORT: 3002
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'ursula-agent',
      script: 'agents/ursula/ursula.js',
      cwd: baseDir,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        ENVIRONMENT: process.env.ENVIRONMENT || 'development',
        URSULA_PORT: 3005,
        HYDI_SYSTEM_PATH: baseDir
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      // Mounts src/api/services (the Ursula service-bundle checkout/billing
      // router) plus /keymaker, /cascade, /heidi, /infrastructure. Not
      // previously in this fleet -- DEPLOYMENT.md marked its production
      // reachability "Unclear" since nothing started it. PORT is set
      // explicitly to 3007 because its own default (3005) collides with
      // ursula-agent below.
      name: 'hydi-service-bundle',
      script: 'src/server.js',
      cwd: baseDir,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        ENVIRONMENT: process.env.ENVIRONMENT || 'development',
        PORT: 3007
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      // workers/WorkerOrchestrator.js — starts the worker fleet and, per
      // its "Mobile-ops command queue" section, polls agent_control_commands
      // every 5s so mobile Ops-tab worker start/stop/restart/scale requests
      // (queued by api/agent-manager/control.js) actually execute. Without
      // this entry the queue accepted commands forever but nothing ever
      // consumed them — see docs/MOBILE_OPERATIONS.md's tech-debt list,
      // "WorkerOrchestrator.js isn't process-managed anywhere".
      name: 'hydi-worker-orchestrator',
      script: 'workers/WorkerOrchestrator.js',
      cwd: baseDir,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        ENVIRONMENT: process.env.ENVIRONMENT || 'development',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'ursula-frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: path.join(baseDir, 'apps/ursula-frontend'),
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        ENVIRONMENT: process.env.ENVIRONMENT || 'development',
        PORT: 3001
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      min_uptime: '10s',
      max_restarts: 5,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
