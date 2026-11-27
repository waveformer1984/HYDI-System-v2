/**
 * PM2 ecosystem config for HYDI System v2
 * ----------------------------------------------------------------------------
 * Replaces the old 6-app config that pointed at stale scripts and the
 * C:\Users\Owner\HYDI_System path. The single authoritative way to start the
 * full system is `npm run boot` (scripts/boot-agent.js), which handles
 * dependency ordering, health gating, preflight, and graceful shutdown.
 *
 * PM2 wraps that single boot process and provides auto-restart if the boot
 * agent itself crashes. Seven former per-tick PM2 apps (watchdog, schedulers,
 * etc.) are supervised by a single `hydi-schedulers` process — see
 * scripts/hydi-schedulers.js.
 *
 * Supervision model (see SUPERVISION_MODEL.md):
 *   PM2 → watches hydi-boot (restarts if boot-agent crashes)
 *   boot-agent → spawns protoforge-core, heidi-web, heidi-mobile-chat
 *   hydi-schedulers → spawns each hydi-* tick script on its own cadence
 *   RecoveryEngine → policy-governed restart (R1, max 2 attempts, circuit breaker)
 *
 * Custom field `autostart: false` — declared for drift audit / `pm2 --only`, but
 * skipped by `scripts/pm2-start-declared.js` (used from start-heidi-everything.ps1).
 *
 * Usage:
 *   node scripts/pm2-start-declared.js     # start every app with autostart !== false
 *   pm2 logs hydi-boot                     # tail boot logs
 *   pm2 logs hydi-schedulers               # tail scheduler supervisor
 *   pm2 restart hydi-boot                  # restart boot only
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
const path = require('path');
const os = require('os');

const HEIDI_MOBILE_TOKEN_FILE = path.join(os.homedir(), '.hydi', 'heidi-mobile-token');

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
      // Exponential restart backoff (1s, 1.5s, 2.25s, ~15s cap) replaces
      // the flat delay: a dependency outage becomes a slow self-healing
      // retry instead of a restart storm that exhausts max_restarts and
      // leaves the app errored forever — nothing comes back when the
      // dependency does. Takes effect on `pm2 start/reload`, not on an
      // already-running entry whose PM2 settings have drifted from git.
      exp_backoff_restart_delay: 2000,
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
      // HEIDI Cognitive-Loop Daemon: continuously runs the governed cognitive
      // loop with self-sufficiency integration (capability health observation,
      // blocker classification, governed self-repair). Single-instance locked.
      // Autonomy Level 2 — R0/R1 autonomous, R2+ human-required, R5 prohibited.
      name: 'hydi-daemon',
      // The JS entry registers tsx and loads the TypeScript daemon in-process.
      // PM2 owns this exact PID; no daemon child can survive a PM2 restart.
      // require('tsx/cjs') hooks require() only — every `await import('../lib/...')`
      // of an extensionless .ts file (CredentialRunbookRegistry,
      // ExternalCapabilityAcquisitionEngine, delegated-operator, the
      // CognitiveCore lazy imports) failed ERR_MODULE_NOT_FOUND inside the
      // daemon. The launcher owns BOTH hooks now: require('tsx/cjs') plus
      // require('tsx/esm/api').register() - no node_args needed, which also
      // stops PM2's cached process definition from silently dropping them.
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
      // On Windows this gives the in-process daemon a catchable IPC shutdown
      // request before PM2's force-kill fallback.
      shutdown_with_message: true,
      autorestart: true,
      watch: false,
      // Was 500M. The daemon's RSS normally swings ~40-900MB between GCs, so
      // PM2 kept memory-restarting it (3,700+ restarts by 2026-10-24). On
      // Windows each memory restart races the graceful IPC shutdown: PM2
      // starts the replacement, then reads the old process's late exit as
      // the new one dying, forgets the replacement, and spawns another that
      // finds the lock held and exits 1 — an untracked daemon plus an
      // endless restart loop. Keep this well above normal peak; a real leak
      // still gets caught.
      max_memory_restart: '1536M',
      min_uptime: '30s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-hydi-daemon.err.log',
      out_file: './logs/pm2-hydi-daemon.out.log',
      merge_logs: true,
      // The daemon bounds in-flight waiting at 31s and ownership cleanup at
      // 2s. This 50s ceiling leaves margin before PM2 force-kills it.
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
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-system-health.err.log',
      out_file: './logs/pm2-system-health.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Revenue Streams Module: webhook retries + subscription/checkout reconcile.
      name: 'hydi-billing-worker',
      script: 'scripts/billing-worker.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: {
        NODE_ENV: 'development',
        BILLING_WORKER_INTERVAL_SECONDS: '30',
        BILLING_RECONCILE_INTERVAL_MINUTES: '15',
      },
      env_production: {
        NODE_ENV: 'production',
        BILLING_WORKER_INTERVAL_SECONDS: '30',
        BILLING_RECONCILE_INTERVAL_MINUTES: '15',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-billing-worker.err.log',
      out_file: './logs/pm2-billing-worker.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Canonical owner of the legacy Heidi Core HTTP service on :3459.
      // Matches start-heidi-everything.ps1 exactly: node server.js from
      // heidi-core/ with HEIDI_PORT=3459 and execution disabled.
      name: 'heidi-core',
      script: 'server.js',
      args: '',
      cwd: path.join(__dirname, 'heidi-core'),
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        HEIDI_PORT: '3459',
        HEIDI_ALLOW_EXEC: 'false',
        // Governed control plane (watchdog -> RecoveryEngine) owns recovery;
        // HealthObserver inside heidi-core becomes observe-only and stops
        // dispatching restart missions. See heidi-core/missions/health-observer.js.
        HYDI_DELEGATE_RECOVERY: 'true',
      },
      env_production: {
        NODE_ENV: 'production',
        HEIDI_PORT: '3459',
        HEIDI_ALLOW_EXEC: 'false',
        HYDI_DELEGATE_RECOVERY: 'true',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'C:\\ProtoForge_Ecosystem\\logs\\pm2-heidi-core.err.log',
      out_file: 'C:\\ProtoForge_Ecosystem\\logs\\pm2-heidi-core.out.log',
      merge_logs: true,
      kill_timeout: 15000,
    },
    {
      // Heidi Web Layer — the canonical 'heidi-web' service's runtime owner.
      //
      // Ownership contract (reconciled 2026-09-27):
      //   boot.config.json:  heidi-web { supervisor: 'pm2', supervisedAs:
      //                       'heidi-web-standalone' } -- metadata only,
      //                       boot-agent never spawns it
      //   ecosystem.config:  THIS entry -- the actual PM2 runtime owner
      //   RecoveryEngine:    heidi-web -> heidi-web-standalone (pm2NameFor)
      //   watchdog:          probes canonical service id 'heidi-web'
      //
      // Why this exists: heidi-web-standalone was previously created by an
      // ad-hoc `pm2 start` + `pm2 save` and was never declared here -- a
      // PM2 resurrect would have silently lost the port-3000 owner.
      //
      // The live process is PM2 forking the Next CLI binary directly in
      // fork mode (script path next/dist/bin/next, cwd = repo root). Since
      // #321 it runs the production build (`next start --hostname 0.0.0.0
      // --port 3000`, requires a prior `next build`) rather than `next dev`.
      name: 'heidi-web-standalone',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --hostname 0.0.0.0 --port 3000',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        EXECUTION_FABRIC_PERSIST: 'postgres',
        // Pinned explicitly: a pm2 daemon or shell-inherited HOSTNAME
        // (e.g. Git Bash's HOSTNAME=DESKTOP-*) would otherwise redirect
        // `next start` to bind that name instead of every interface.
        HOSTNAME: '0.0.0.0',
        PORT: '3000',
      },
      env_production: {
        NODE_ENV: 'production',
        EXECUTION_FABRIC_PERSIST: 'postgres',
      },
      autorestart: true,
      watch: false,
      // Raised 1G→1.5G: base RSS ~50MB, but a local-model load + in-flight
      // request spikes it past 1G and PM2 killed it mid-request. 1.5G still
      // catches runaway leaks without firing on normal request bursts.
      max_memory_restart: '1536M',
      min_uptime: '30s',       // Next dev needs time to compile the first route
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-heidi-web-standalone.err.log',
      out_file: './logs/pm2-heidi-web-standalone.out.log',
      merge_logs: true,
      kill_timeout: 15000,     // Next dev needs time to close watchers/sockets
    },
    {
      // Revenue autopilot tick. boot.config.json also starts this as
      // `npx tsx scripts/revenue-autopilot-tick.ts`. PM2 on Windows cannot
      // run the .bin/tsx shim, so this entry uses the tsx CLI directly —
      // the same program, the same arguments. scripts/lib/process-lock.js
      // refuses a second copy. If the audit says MISSING while work is
      // still happening, the boot child holds the lock; pick one supervisor.
      name: 'hydi-revenue-autopilot-tick',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'scripts/revenue-autopilot-tick.ts',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-revenue-autopilot-tick.err.log',
      out_file: './logs/pm2-revenue-autopilot-tick.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Declared from the script header:
      //   pm2 start scripts/stripe-webhook-listener.js --name hydi-stripe-webhook-listener
      // Dev/test-mode `stripe listen` bridge. Exits if the Stripe CLI is absent.
      name: 'hydi-stripe-webhook-listener',
      script: 'scripts/stripe-webhook-listener.js',
      args: '',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-stripe-webhook-listener.err.log',
      out_file: './logs/pm2-stripe-webhook-listener.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Public ingress tunnel: ngrok http 3000. Previously ran undeclared
      // (ad-hoc pm2 start) — the runtime audit flagged it UNDECLARED even
      // though it is the live webhook/mobile ingress. Declared so
      // `pm2 resurrect` restores it after reboot.
      name: 'hydi-public-tunnel',
      // Runs the ngrok binary outside this repo — no repo-SHA provenance
      // exists. external:true tells the drift audit to check presence and
      // declared config only. A restart rotates the free-tier URL; the
      // audit deliberately never restarts it.
      external: true,
      script: path.join(process.env.LOCALAPPDATA || path.join(__dirname, '..', '..'), 'ngrok', 'ngrok.exe'),
      args: 'http 3000 --log=stdout',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      restart_delay: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      // No max_restarts / exp_backoff_restart_delay / kill_timeout: this
      // entry declares what PM2 actually runs (tunnel was started manually
      // and is never restarted — a restart rotates the free-tier URL).
      error_file: './logs/pm2-public-tunnel.err.log',
      out_file: './logs/pm2-public-tunnel.out.log',
      merge_logs: true,
    },
    {
      // Heidi agent (heidi-core/heidi-agent.js) — Phase 2 persistent loop + optional advisory API.
      name: 'heidi-agent',
      script: 'heidi-core/heidi-agent.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: {
        NODE_ENV: 'development',
        HEIDI_ALLOW_EXEC: 'false',
        HEIDI_BIND_HOST: '127.0.0.1',
        HEIDI_ADVISORY_ALLOWED_ORIGINS: 'http://127.0.0.1:3100',
        HEIDI_AGENT_PERSISTENT_LOOP: 'true',
        HEIDI_AGENT_PORT: '3462',
        HEIDI_ADVISOR_MODEL: 'qwen2.5:3b-instruct-q4_K_M',
        HEIDI_AGENT_CYCLE_MS: '30000',
        HEIDI_AGENT_REFLECT_EVERY_N: '10',
        // HEIDI_ADVISORY_MODE stays off unless operator enables Ursula approvals (:3461).
      },
      env_production: {
        NODE_ENV: 'production',
        HEIDI_ALLOW_EXEC: 'false',
        HEIDI_BIND_HOST: '127.0.0.1',
        HEIDI_ADVISORY_ALLOWED_ORIGINS: 'http://127.0.0.1:3100',
        HEIDI_AGENT_PERSISTENT_LOOP: 'true',
        HEIDI_AGENT_PORT: '3462',
        HEIDI_ADVISOR_MODEL: 'qwen2.5:3b-instruct-q4_K_M',
        HEIDI_AGENT_CYCLE_MS: '30000',
        HEIDI_AGENT_REFLECT_EVERY_N: '10',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-heidi-agent.err.log',
      out_file: './logs/pm2-heidi-agent.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Frank deploy watcher (scripts/frank-auto-deploy.js). Previously an
      // ad-hoc pm2 start — flagged UNDECLARED by the runtime audit.
      name: 'frank-auto-deploy',
      script: 'scripts/frank-auto-deploy.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-frank-auto-deploy.err.log',
      out_file: './logs/pm2-frank-auto-deploy.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Storage guard (scripts/frank-storage-guard.js, docs/STORAGE_PROGRAM.md).
      // Long-lived loop with its own 15-minute interval: measures free
      // space, clears only regenerable caches in tiers, writes
      // .runtime/storage/status.json, alerts #alerts on level changes.
      name: 'frank-storage-guard',
      script: 'scripts/frank-storage-guard.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-frank-storage-guard.err.log',
      out_file: './logs/pm2-frank-storage-guard.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Rezonate storefront app on :3001. Declared in boot.config.json
      // (PR #409) as a PM2-supervised module; this entry is the PM2-side
      // declaration the runtime audit compares against.
      name: 'rezonate-app',
      script: 'src/index.js',
      cwd: path.join(__dirname, 'protoforge-applications', 'rezonate'),
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: { NODE_ENV: 'development', PORT: '3001' },
      env_production: { NODE_ENV: 'production', PORT: '3001' },
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: path.join(__dirname, 'logs', 'pm2-rezonate-app.err.log'),
      out_file: path.join(__dirname, 'logs', 'pm2-rezonate-app.out.log'),
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Heidi's phone chat on :3006 (launch-heidi-mobile.js). Until 2026-10-31
      // it ran only as a hand-started process that nothing restarted, and
      // boot-agent merely adopted it as external(UNSUPERVISED). PM2 now owns
      // it; boot.config.json marks the module supervisor:'pm2'.
      // HEIDI_MOBILE_REQUIRE_TOKEN=1: the server refuses to start (exit 78,
      // not restarted) unless HEIDI_MOBILE_TOKEN is in the environment, so it
      // can never come up on the tailnet without device login. The token value
      // is never in this file; PM2 reads HEIDI_MOBILE_TOKEN_FILE (default
      // ~/.hydi/heidi-mobile-token) at process start. See CLAUDE.md.
      name: 'heidi-mobile-chat',
      script: 'launch-heidi-mobile.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: {
        NODE_ENV: 'development',
        HEIDI_MOBILE_PORT: '3006',
        HEIDI_MOBILE_REQUIRE_TOKEN: '1',
        HEIDI_MOBILE_TOKEN_FILE: HEIDI_MOBILE_TOKEN_FILE,
      },
      env_production: {
        NODE_ENV: 'production',
        HEIDI_MOBILE_PORT: '3006',
        HEIDI_MOBILE_REQUIRE_TOKEN: '1',
        HEIDI_MOBILE_TOKEN_FILE: HEIDI_MOBILE_TOKEN_FILE,
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      stop_exit_codes: [78],
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: path.join(__dirname, 'logs', 'pm2-heidi-mobile-chat.err.log'),
      out_file: path.join(__dirname, 'logs', 'pm2-heidi-mobile-chat.out.log'),
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Declared from LOCAL_CI.md:
      //   pm2 start scripts/local-ci.js --name hydi-local-ci -- --watch --include-main --interval 10
      // Posts local-ci/* commit statuses. Stop it on a machine that should
      // not watch GitHub; the audit will then report MISSING.
      // autostart: false — Frank starts this manually when GitHub runners are down.
      name: 'hydi-local-ci',
      autostart: false,
      script: 'scripts/local-ci.js',
      args: '--watch --include-main --interval 10',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-local-ci.err.log',
      out_file: './logs/pm2-local-ci.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      // Frank observer (scripts/frank-observer.js, docs/FRANK_OBSERVATION.md).
      // Long-lived 60s loop: guarantees a fresh observatory sample, writes
      // the combined snapshot to .runtime/observation/frank.json, and posts
      // #alerts when a critical issue holds for two passes. Read-only.
      // autostart: false — optional demo app; start with pm2 --only proto-yi.
      name: 'proto-yi',
      autostart: false,
      script: 'src/index.js',
      cwd: 'protoforge-applications/proto-yi',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', PORT: '3010' },
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '../../logs/pm2-proto-yi.err.log',
      out_file: '../../logs/pm2-proto-yi.out.log',
      merge_logs: true,
      time: true,
      kill_timeout: 5000
    },
    {
      name: 'ursula-local',
      script: 'node_modules/next/dist/bin/next',
      args: 'start --hostname 127.0.0.1 --port 3100',
      cwd: 'apps/ursula-frontend',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', PORT: '3100' },
      autorestart: true,
      watch: false,
      max_memory_restart: '600M',
      min_uptime: '15s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '../../logs/pm2-ursula-local.err.log',
      out_file: '../../logs/pm2-ursula-local.out.log',
      merge_logs: true,
      time: true,
      kill_timeout: 5000,
      wait_ready: false,
      listen_timeout: 10000
    },
    {
      name: 'frank-observer',
      script: 'scripts/frank-observer.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      args: '',
      env: { NODE_ENV: 'development' },
      env_production: { NODE_ENV: 'production' },
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-frank-observer.err.log',
      out_file: './logs/pm2-frank-observer.out.log',
      merge_logs: true,
      kill_timeout: 10000,
    },
    {
      name: 'heidi-pool',
      script: 'scripts/heidi-pool.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        POOL_MAX_CLONES: '12',
        POOL_LLM_SLOTS: '1',
        EXECUTION_FABRIC_PERSIST: 'postgres',
      },
      env_production: {
        NODE_ENV: 'production',
        POOL_MAX_CLONES: '12',
        POOL_LLM_SLOTS: '1',
        EXECUTION_FABRIC_PERSIST: 'postgres',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-heidi-pool.err.log',
      out_file: './logs/pm2-heidi-pool.out.log',
      merge_logs: true,
      kill_timeout: 15000,
    },
    {
      // Supervises hydi-watchdog, model-prep, daily loop, protoforge scout,
      // stuck-job, revenue reconciliation, failed-webhook retry (and more).
      // Those scripts stay in scripts/ — they are not duplicated as PM2 apps.
      name: 'hydi-schedulers',
      script: 'scripts/hydi-schedulers.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-hydi-schedulers.err.log',
      out_file: './logs/pm2-hydi-schedulers.out.log',
      merge_logs: true,
      kill_timeout: 15000,
    },
  ],
};
