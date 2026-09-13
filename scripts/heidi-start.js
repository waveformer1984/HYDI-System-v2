#!/usr/bin/env node
/**
 * HEIDI Start — Single-command startup
 *
 * Brings up the HEIDI operational system in one command:
 *   npm run heidi:start
 *
 * Sequence:
 *   1. Check prerequisites (Node version, .env.local exists)
 *   2. Initialize persistence directories
 *   3. Start the HEIDI daemon (self-sufficiency loop)
 *   4. Wait for first cycle to complete
 *   5. Print status
 *
 * The daemon runs in the foreground. Press Ctrl+C to stop.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DAEMON_SCRIPT = path.resolve(ROOT, 'scripts', 'heidi-daemon.ts');

function log(msg) {
  console.log(`[heidi:start] ${msg}`);
}

function error(msg) {
  console.error(`[heidi:start] ERROR: ${msg}`);
}

async function main() {
  log('Starting HEIDI operational system...');

  // 1. Check prerequisites
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (major < 20) {
    error(`Node >= 20 required, found ${nodeVersion}`);
    process.exit(1);
  }
  log(`Node ${nodeVersion} OK`);

  // 2. Initialize persistence directories
  const opDir = path.resolve(ROOT, '.hydi-operational');
  if (!fs.existsSync(opDir)) {
    fs.mkdirSync(opDir, { recursive: true });
    log('Created .hydi-operational/ directory');
  }

  // 3. Check if daemon is already running
  const lockPath = path.resolve(ROOT, '.heidi-daemon.lock');
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      try {
        process.kill(lock.pid, 0);
        error(`HEIDI daemon is already running (PID ${lock.pid})`);
        error('Stop it first with: npm run heidi:stop');
        process.exit(1);
      } catch {
        // Stale lock — remove it
        fs.unlinkSync(lockPath);
        log('Removed stale lock file');
      }
    } catch {
      // Corrupt lock — remove it
      fs.unlinkSync(lockPath);
      log('Removed corrupt lock file');
    }
  }

  // 4. Start the daemon
  log('Starting HEIDI daemon...');
  log(`  Script: ${DAEMON_SCRIPT}`);
  log(`  Mode: foreground (Ctrl+C to stop)`);
  log('');

  const daemon = spawn('npx', ['tsx', DAEMON_SCRIPT, '--interval=60000'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });

  // Forward signals
  process.on('SIGINT', () => {
    log('Received SIGINT — stopping HEIDI daemon...');
    daemon.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    log('Received SIGTERM — stopping HEIDI daemon...');
    daemon.kill('SIGTERM');
  });

  daemon.on('exit', (code) => {
    log(`HEIDI daemon exited with code ${code}`);
    process.exit(code || 0);
  });
}

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
