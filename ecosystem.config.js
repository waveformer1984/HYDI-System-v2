module.exports = {
  apps: [
    {
      name: 'hydi-protoforge',
      script: 'protoforge-mock.js',
      instances: 2, // Horizontal scaling for ingestion
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production',
        PORT: 3001
      },
      env_production: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production'
      },
      // Auto-restart configuration
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      
      // Health check
      health_check_grace_period: 3000,
      
      // Logging
      log_file: '/var/log/hydi/protoforge.log',
      out_file: '/var/log/hydi/protoforge-out.log',
      error_file: '/var/log/hydi/protoforge-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Process management
      kill_timeout: 5000,
      restart_delay: 4000,
      
      // Monitoring
      pmx: true,
      
      // Security
      node_args: '--max-old-space-size=512'
    },
    
    {
      name: 'hydi-processor',
      script: 'hydi-processor.js',
      instances: 1, // Vertical scaling - CPU intensive
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production'
      },
      env_production: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production'
      },
      
      // Auto-restart configuration
      autorestart: true,
      watch: false,
      max_memory_restart: '1G', // More memory for processing
      min_uptime: '10s',
      max_restarts: 5,
      
      // Health check
      health_check_grace_period: 3000,
      
      // Logging
      log_file: '/var/log/hydi/processor.log',
      out_file: '/var/log/hydi/processor-out.log',
      error_file: '/var/log/hydi/processor-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Process management
      kill_timeout: 10000, // Longer timeout for processing
      restart_delay: 10000,
      
      // Monitoring
      pmx: true,
      
      // CPU optimization
      node_args: '--max-old-space-size=1024'
    },
    
    {
      name: 'hydi-ursula',
      script: 'ursula-dashboard.js',
      instances: 1, // Single instance for SSE consistency
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production',
        DASHBOARD_PORT: 3002
      },
      env_production: {
        NODE_ENV: 'production',
        ENVIRONMENT: 'production',
        DASHBOARD_PORT: 3002
      },
      
      // Auto-restart configuration
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      
      // Health check
      health_check_grace_period: 3000,
      
      // Logging
      log_file: '/var/log/hydi/ursula.log',
      out_file: '/var/log/hydi/ursula-out.log',
      error_file: '/var/log/hydi/ursula-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Process management
      kill_timeout: 5000,
      restart_delay: 4000,
      
      // Monitoring
      pmx: true,
      
      // SSE optimization
      node_args: '--max-old-space-size=512'
    }
  ],
  
  // Deployment configuration
  deploy: {
    production: {
      user: 'hydi',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-org/hydi-system.git',
      path: '/var/www/hydi',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};
