#!/usr/bin/env node
/**
 * PM2 Restart Helper for Windows
 *
 * Works around a PM2-on-Windows bug where `pm2 restart <name>` and
 * `pm2 start <name>` fail with "Process N not found" after a stop.
 * The bug is that PM2 internally calls restartProcessId() which
 * looks up the process by its PM2 ID, but on Windows the ID-to-pid
 * mapping becomes stale after a stop.
 *
 * This script does the reliable thing: delete + start from ecosystem.config.js.
 *
 * Usage:
 *   node scripts/pm2-restart.js [name]     # restart one app (default: hydi-boot)
 *   node scripts/pm2-restart.js all        # restart all apps
 *   node scripts/pm2-restart.js --prod     # restart in production mode
 */
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ECOSYSTEM = path.join(ROOT, 'ecosystem.config.js');
const target = process.argv[2] || 'hydi-boot';
const prodFlag = process.argv.includes('--prod') ? ' --env production' : '';

function run(cmd) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    // PM2 commands may return non-zero exit codes even on success
  }
}

if (target === 'all') {
  // Restart all HYDI apps
  console.log('Restarting all HYDI PM2 processes...');
  run('pm2 delete all');
  run(`pm2 start ecosystem.config.js${prodFlag}`);
} else {
  // Restart a single app
  console.log(`Restarting ${target}...`);

  // First try a normal restart — it may work if the process is still running
  try {
    execSync(`pm2 restart ${target}`, { cwd: ROOT, stdio: 'pipe' });
    console.log(`pm2 restart ${target} succeeded`);
    process.exit(0);
  } catch (e) {
    console.log(`pm2 restart ${target} failed (${e.message.split('\n')[0]}), falling back to delete + start...`);
  }

  // Fallback: delete + start from ecosystem config
  run(`pm2 delete ${target}`);
  run(`pm2 start ecosystem.config.js --only ${target}${prodFlag}`);
}

console.log('Done. Use `pm2 logs` to check status.');
