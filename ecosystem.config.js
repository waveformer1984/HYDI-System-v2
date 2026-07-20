module.exports = {
  apps: [
    {
      name: 'heidi',
      script: 'heidi-core/server.js',
      cwd: 'C:\\Users\\Owner\\HYDI_System',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production',
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
      cwd: 'C:\\Users\\Owner\\HYDI_System',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production',
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
      cwd: 'C:\\Users\\Owner\\HYDI_System',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production',
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
      cwd: 'C:\\Users\\Owner\\HYDI_System',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production',
        URSULA_PORT: 3005,
        HYDI_SYSTEM_PATH: 'C:\\Users\\Owner\\HYDI_System'
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
      cwd: 'C:\\Users\\Owner\\HYDI_System',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production',
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
      name: 'ursula-frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: 'C:\\Users\\Owner\\HYDI_System\\apps\\ursula-frontend',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production',
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


