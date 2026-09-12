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
      // CRITICAL: On Windows, PM2's default stop behavior uses
      // `taskkill /pid <pid> /T /F` (force kill the entire process tree),
      // which gives no chance for graceful shutdown. With
      // shutdown_with_message: true, PM2 sends an IPC 'shutdown' message
      // instead, which boot-agent.js handles by gracefully stopping all
      // child processes (next dev, protoforge-core, etc.) in reverse order.
      // PM2 then waits up to kill_timeout (20s) for the process to exit
      // on its own before falling back to force kill.
      shutdown_with_message: true,
      kill_timeout: 20000,     // 20s — boot-agent needs time to SIGTERM next dev + protoforge-core

      // Single-instance contract (see scripts/boot-instance-lease.js).
      //
      // PM2 has been observed to leave the outgoing hydi-boot fork alive next to
      // its replacement: during a restart the old fork's exit event arrives
      // AFTER the replacement is already online, PM2 attributes it to the
      // replacement ("App [hydi-boot:4] exited with code [0]"), and autorestart
      // spawns a second fork restart_delay later. Both forks then run their own
      // hydi-orchestrator core loop and job-executor-poller.
      //
      // boot-agent now arbitrates this itself via a lease file: newest claim
      // wins, and the superseded instance shuts its modules down and exits with
      // SUPERSEDED_EXIT_CODE (75). Listing 75 here tells PM2 that an orderly
      // stand-down is not a crash, so it does not immediately respawn the
      // instance that just correctly removed itself.
      stop_exit_codes: [75],
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
      // PM2 then waits up to kill_timeout (50s) for the process to exit
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
      // to the process (verified from PM2 7.0.1 source: lib/God/Methods.js
      // — God.processIsDead() is called synchronously after proc.send(),
      // and the setTimeout(kill_timeout) is in God.processIsDead()).
      // The PM2 CLI → God RPC delay (0-11s observed) happens BEFORE the
      // kill_timeout timer starts, so it is NOT part of the budget.
      //
      // Measured IPC delivery delay (20-sample distribution test, 5s
      // interval stress test, 500ms polling):
      //   idle:   p50=3839ms, p95=5466ms, max=5466ms
      //   loaded: p50=4784ms, p95=5423ms, max=6024ms
      // Measured total shutdown duration (10-sample re-test with 100ms
      // polling fix):
      //   idle:   p50=25144ms, p95=32902ms, max=32902ms
      //   loaded: p50=24121ms, p95=31975ms, max=31975ms
      //
      // Budget (from PM2 message send to process exit):
      //   IPC delivery (max measured):       6024ms
      //   Shutdown wait (SHUTDOWN_WAIT):    31000ms
      //   Polling overshoot (100ms polls):    ~100ms
      //   Cleanup (audit record + lock):      ~100ms
      //   Total worst case:                ~37224ms
      //
      // kill_timeout = 50000ms gives 12776ms margin (34.3% over worst
      // case). Per-condition margin with 100ms polling:
      //   idle:   50000 - 38615 = 11385ms (29.5%)
      //   loaded: 50000 - 37034 = 12966ms (35.0%)
      // This means `pm2 stop`/`restart` blocks for at most 50s (plus
      // PM2's own 0-11s internal delay) in the worst case where a
      // cognitive cycle is in flight. In normal operation (no in-flight
      // work), the daemon exits in <100ms.
      //
      // SHUTDOWN_WAIT_TIMEOUT_MS in heidi-daemon.ts is 31s (30s cycle
      // timeout + 1s buffer). The 12.8s kill_timeout margin covers the
      // 6s IPC delivery delay + 100ms polling overshoot + 100ms cleanup
      // + 6.6s additional safety for event-loop jitter under load.
      kill_timeout: 50000,
    },
    {
      // System Health Producer: runs true-system-health.js on an interval and
      // verifies the row actually landed in system_health_runs.
      //
      // Without this, system_dashboard.current_status is a scalar subquery over
      // an empty table -> NULL -> /api/health reports "degraded" forever. The
      // health check existed only as a manual CLI; nothing scheduled it.
      name: 'hydi-system-health',
      script: 'scripts/system-health-scheduler.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: {
        NODE_ENV: 'development',
        SYSTEM_HEALTH_INTERVAL_MS: '300000',
        SYSTEM_HEALTH_TIMEOUT_MS: '120000',
      },
      env_production: {
        NODE_ENV: 'production',
        SYSTEM_HEALTH_INTERVAL_MS: '300000',
        SYSTEM_HEALTH_TIMEOUT_MS: '120000',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-system-health.err.log',
      out_file: './logs/pm2-system-health.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // HYDI Mission Runner v1 -- protoforge.daily_opportunity_scan.
      // Gives Heidi one concrete daily operational job: find real public
      // signals relevant to Rezonate, score them deterministically,
      // persist them, and produce a briefing -- see lib/missions/README.md.
      // R0/R1 only: read-only outbound HTTP, local persistence, no
      // external contact, no spending. Human approval required for
      // anything past "recommend" (there is no execution step in v1 at
      // all -- see lib/missions/approval.js).
      //
      // NOT started automatically by this config change alone -- added so
      // the app definition exists and is reviewable; an operator runs
      // `pm2 start ecosystem.config.js --only hydi-protoforge-scout` (or
      // `pm2 reload`) to actually activate it.
      name: 'hydi-protoforge-scout',
      script: 'scripts/protoforge-opportunity-scheduler.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: {
        NODE_ENV: 'development',
        PROTOFORGE_SCOUT_INTERVAL_MS: '86400000',
        PROTOFORGE_SCOUT_TIMEOUT_MS: '60000',
      },
      env_production: {
        NODE_ENV: 'production',
        PROTOFORGE_SCOUT_INTERVAL_MS: '86400000',
        PROTOFORGE_SCOUT_TIMEOUT_MS: '60000',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-protoforge-scout.err.log',
      out_file: './logs/pm2-protoforge-scout.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Stuck Job Scheduler: continuously runs the StuckJobDetector on an
      // hourly interval to autonomously detect and recover stuck jobs.
      // This is the first real autonomous operations goal — it runs on a
      // real recurring trigger, not a one-off script.
      // See lib/operational/StuckJobDetector.ts for the bounded recovery
      // actions (retry once for executing, escalate for awaiting_review).
      name: 'hydi-stuck-job-scheduler',
      script: 'scripts/stuck-job-scheduler.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: {
        NODE_ENV: 'development',
        STUCK_JOB_INTERVAL_MS: '3600000',  // 1 hour
        STUCK_JOB_EXECUTING_HOURS: '4',
        STUCK_JOB_REVIEW_HOURS: '48',
      },
      env_production: {
        NODE_ENV: 'production',
        STUCK_JOB_INTERVAL_MS: '3600000',
        STUCK_JOB_EXECUTING_HOURS: '4',
        STUCK_JOB_REVIEW_HOURS: '48',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-stuck-job-scheduler.err.log',
      out_file: './logs/pm2-stuck-job-scheduler.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Revenue Reconciliation Scheduler: runs the
      // RevenueReconciliationDetector on a daily schedule.
      // STRICTLY READ-ONLY — never modifies financial state.
      // Discrepancies are escalated through EscalationNotifier.
      name: 'hydi-revenue-reconciliation',
      script: 'scripts/revenue-reconciliation-scheduler.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: {
        NODE_ENV: 'development',
        RECONCILIATION_INTERVAL_MS: '86400000',  // 24 hours
        RECONCILIATION_OBSERVE_ONLY: 'false',
      },
      env_production: {
        NODE_ENV: 'production',
        RECONCILIATION_INTERVAL_MS: '86400000',
        RECONCILIATION_OBSERVE_ONLY: 'false',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-revenue-reconciliation.err.log',
      out_file: './logs/pm2-revenue-reconciliation.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Failed Webhook Retry Scheduler: runs the FailedWebhookDetector
      // every 30 minutes. Retries failed webhooks ONCE (bounded),
      // then escalates persistent failures. Stale 'processing' webhooks
      // are escalated (not auto-reset) to avoid duplicate processing.
      name: 'hydi-failed-webhook-retry',
      script: 'scripts/failed-webhook-scheduler.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: {
        NODE_ENV: 'development',
        WEBHOOK_RETRY_INTERVAL_MS: '1800000',  // 30 minutes
        WEBHOOK_STALE_THRESHOLD_MS: '3600000', // 1 hour
        WEBHOOK_RETRY_OBSERVE_ONLY: 'false',
      },
      env_production: {
        NODE_ENV: 'production',
        WEBHOOK_RETRY_INTERVAL_MS: '1800000',
        WEBHOOK_STALE_THRESHOLD_MS: '3600000',
        WEBHOOK_RETRY_OBSERVE_ONLY: 'false',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-failed-webhook-retry.err.log',
      out_file: './logs/pm2-failed-webhook-retry.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
  ],
};
