module.exports = {
  apps: [
    {
      name: 'heidi',
      script: 'heidi-core/server.js',
      cwd: 'F:\\HYDI_System',
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
      cwd: 'F:\\HYDI_System',
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
      script: 'protoforge-mock.js',
      cwd: 'F:\\HYDI_System',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production',
        PORT: 3002   // 3001 is occupied by Docker backend; protoforge binds 3002
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'hydi-ursula',
      script: 'ursula-dashboard-enhanced.js',
      cwd: 'F:\\HYDI_System',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production',
        DASHBOARD_PORT: 3005
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};


