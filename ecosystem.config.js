/**
 * PM2 ecosystem config for HYDI System v2
 * ----------------------------------------------------------------------------
 * Replaces the old 6-app config that pointed at stale scripts and the
 * C:\Users\Owner\HYDI_System path. The single authoritative way to start the
 * full system is `npm run boot` (scripts/boot-agent.js), which handles
 * dependency ordering, health gating, preflight, and graceful shutdown.
 *
 * PM2 wraps that single boot process and provides auto-restart if the boot
 * agent itself crashes.
 *
 * Usage:
 *   pm2 start ecosystem.config.js          # start
 *   pm2 logs hydi-boot                     # tail logs
 *   pm2 restart hydi-boot                  # restart
 *   pm2 stop hydi-boot                     # stop
 *   pm2 delete hydi-boot                   # remove from PM2
 *
 * To make it survive a reboot:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup        # follow the printed instructions (may need admin/sudo)
 *
 * For production mode (requires `npm run build` first):
 *   pm2 start ecosystem.config.js --env production
 */
module.exports = {
  apps: [
    {
      name: 'hydi-boot',
      script: 'scripts/boot-agent.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // Production mode uses `next start` instead of `next dev`.
      // Run `npm run build` first, then: pm2 start ecosystem.config.js --env production
      args: '',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // Pass --prod to boot-agent when running in production env.
      // PM2 doesn't support per-env args directly, so use a wrapper:
      //   pm2 start ecosystem.config.js --env production -- --prod
      // Or set NODE_ENV=production and boot-agent will detect it.
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      min_uptime: '30s',       // must stay up 30s before counted as "up"
      max_restarts: 10,        // don't loop forever on a persistent crash
      restart_delay: 5000,     // 5s between restarts to avoid hammering
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-hydi-boot.err.log',
      out_file: './logs/pm2-hydi-boot.out.log',
      merge_logs: true,
      kill_timeout: 10000,     // give boot-agent 10s for graceful shutdown
    },
  ],
};
