/**
 * PM2 ecosystem config for HYDI System v2
 * ----------------------------------------------------------------------------
 * Replaces the old 6-app config that pointed at stale scripts and the
 * C:\Users\Owner\HYDI_System path. The single authoritative way to start the
 * full system is `npm run boot` (scripts/boot-agent.js), which handles
 * dependency ordering, health gating, preflight, and graceful shutdown.
 *
 * PM2 wraps that single boot process and provides auto-restart if the boot
 * agent itself crashes. A second PM2 process (hydi-watchdog) runs the
 * watchdog continuously, which calls RecoveryEngine on unhealthy endpoints
 * when HYDI_DELEGATE_RECOVERY is enabled.
 *
 * Supervision model (see SUPERVISION_MODEL.md):
 *   PM2 → watches hydi-boot (restarts if boot-agent crashes)
 *   boot-agent → spawns protoforge-core, heidi-web, heidi-mobile-chat
 *   watchdog → polls health endpoints every 2 min, calls RecoveryEngine
 *   RecoveryEngine → policy-governed restart (R1, max 2 attempts, circuit breaker)
 *
 * Usage:
 *   pm2 start ecosystem.config.js          # start both hydi-boot + hydi-watchdog
 *   pm2 logs hydi-boot                     # tail boot logs
 *   pm2 logs hydi-watchdog                 # tail watchdog logs
 *   pm2 restart hydi-boot                  # restart boot only
 *   pm2 stop hydi-watchdog                 # stop watchdog only
 *   pm2 delete all                         # remove all PM2 processes
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
        // Enable governed self-recovery: boot-agent delegates to RecoveryEngine
        // instead of shutting down on required child exit. See SUPERVISION_MODEL.md.
        HYDI_DELEGATE_RECOVERY: 'true',
      },
      env_production: {
        NODE_ENV: 'production',
        HYDI_DELEGATE_RECOVERY: 'true',
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
    {
      // Watchdog: continuously polls health endpoints and calls RecoveryEngine
      // when a component is unhealthy-but-alive (the case boot-agent can't see).
      // In DELEGATE mode, this is the trigger for RecoveryEngine.
      name: 'hydi-watchdog',
      script: 'scripts/watchdog.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: {
        NODE_ENV: 'development',
        HYDI_DELEGATE_RECOVERY: 'true',
        WATCHDOG_INTERVAL_MS: '30000',  // 30 seconds — fast enough to catch outages before users notice
      },
      env_production: {
        NODE_ENV: 'production',
        HYDI_DELEGATE_RECOVERY: 'true',
        WATCHDOG_INTERVAL_MS: '120000',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-hydi-watchdog.err.log',
      out_file: './logs/pm2-hydi-watchdog.out.log',
      merge_logs: true,
      kill_timeout: 5000,
    },
    {
      // HEIDI Cognitive-Loop Daemon: continuously runs the governed cognitive
      // loop with self-sufficiency integration (capability health observation,
      // blocker classification, governed self-repair). Single-instance locked.
      // Autonomy Level 2 — R0/R1 autonomous, R2+ human-required, R5 prohibited.
      name: 'hydi-daemon',
      // Use a JS wrapper that loads tsx and imports the TypeScript daemon.
      // PM2 on Windows can't directly run the .bin/tsx shim.
      // In production, run `npm run build` first and switch to the compiled JS.
      script: 'scripts/heidi-daemon-launcher.js',
      args: '--no-stabilization',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // CRITICAL: On Windows, PM2's default stop behavior uses
      // `taskkill /pid <pid> /T /F` (force kill the entire process tree),
      // which gives no chance for graceful shutdown. With
      // shutdown_with_message: true, PM2 calls proc.send('shutdown')
      // instead, which the launcher relays to the daemon via IPC.
      // PM2 then waits up to kill_timeout (15s) for the process to exit
      // on its own before falling back to SIGKILL.
      shutdown_with_message: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-hydi-daemon.err.log',
      out_file: './logs/pm2-hydi-daemon.out.log',
      merge_logs: true,
      // kill_timeout starts when PM2 sends the 'shutdown' IPC message
      // (NOT when `pm2 stop` is called — PM2 has its own 0-11s internal
      // processing delay before sending the message, but that happens
      // before the kill_timeout timer starts).
      //
      // Measured timing chain (clean process tree, no stale processes):
      //   PM2 sends shutdown → launcher receives: ~0ms
      //   Launcher receives → daemon receives: 6ms-1.4s (IPC channel)
      //   Daemon waits for in-flight work: 0-30s (cognitive cycle timeout)
      //   Cleanup (audit record + lock release): 3ms
      //   Total from IPC receipt: 1.4 + 30 + 0.003 = 31.4s
      //
      // kill_timeout = 35s gives 3.6s margin over the 31.4s worst case.
      // This means `pm2 stop`/`restart` blocks for at most 35s (plus
      // PM2's own 0-11s internal delay) in the worst case where a
      // cognitive cycle is in flight. In normal operation (no in-flight
      // work), the daemon exits in <100ms.
      //
      // SHUTDOWN_WAIT_TIMEOUT_MS in heidi-daemon.ts is 31s (30s cycle
      // timeout + 1s buffer). The 3.6s kill_timeout margin covers the
      // 1.4s IPC delivery delay + 3ms cleanup + 2.2s timer jitter.
      kill_timeout: 35000,
    },
  ],
};
