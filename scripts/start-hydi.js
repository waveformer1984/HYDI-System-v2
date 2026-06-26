#!/usr/bin/env node
/**
 * HYDI Startup Orchestrator
 *
 * Single command to start all services in the correct order:
 * 1. Check ports (fail fast on conflicts)
 * 2. Wait for dependencies (Supabase, Ollama)
 * 3. Start services with dependency ordering
 * 4. Monitor for crashes
 *
 * Usage:
 *   npm run start:hydi
 *   OR
 *   node scripts/start-hydi.js
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
};

// Service startup order (respects dependencies)
const STARTUP_ORDER = [
  {
    name: 'Supabase',
    cmd: 'supabase',
    args: ['start'],
    cwd: process.cwd(),
    background: true,
    waitForHealth: true,
    description: 'PostgreSQL database + REST API',
  },
  {
    name: 'Ollama',
    cmd: process.platform === 'win32' ? 'ollama' : 'ollama',
    args: ['serve'],
    background: true,
    waitForHealth: true,
    description: 'Local LLM embeddings & inference',
  },
  {
    name: 'HEIDI Core',
    cmd: 'node',
    args: ['heidi-core/index-clean-3458.js'],
    env: { HEIDI_CORE_PORT: '3458' },
    background: true,
    description: 'AI orchestrator & agent router',
  },
  {
    name: 'HEIDI Mobile Chat',
    cmd: 'node',
    args: ['launch-heidi-mobile.js'],
    env: { HEIDI_PORT: '3006' },
    background: true,
    description: 'Chat API for mobile clients',
  },
  {
    name: 'Next.js Frontend',
    cmd: 'npm',
    args: ['run', 'dev'],
    background: false, // Keep in foreground for visibility
    description: 'React dashboard (DashHub)',
  },
];

const runningProcesses = [];

/**
 * Log with timestamp
 */
function log(level, message) {
  const time = new Date().toLocaleTimeString();
  const icons = {
    info: 'ℹ️ ',
    success: '✅',
    error: '❌',
    warn: '⚠️ ',
    wait: '⏳',
  };
  console.log(`${colors.gray(`[${time}]`)} ${icons[level] || ''} ${message}`);
}

/**
 * Check if port is available
 */
function checkPorts() {
  log('info', 'Checking port availability...');
  try {
    execSync('node scripts/check-ports.js', { stdio: 'inherit' });
    return true;
  } catch (err) {
    log('error', 'Port check failed. Aborting startup.');
    process.exit(1);
  }
}

/**
 * Wait for dependencies
 */
function waitForDependencies() {
  log('info', 'Waiting for critical dependencies...');
  try {
    execSync('node scripts/wait-for-dependencies.js', { stdio: 'inherit' });
    return true;
  } catch (err) {
    log('error', 'Dependencies not ready. Aborting startup.');
    process.exit(1);
  }
}

/**
 * Start a service
 */
function startService(service, index) {
  log('wait', `[${index}/${STARTUP_ORDER.length}] Starting ${service.name}...`);

  const proc = spawn(service.cmd, service.args, {
    cwd: service.cwd || process.cwd(),
    env: { ...process.env, ...service.env },
    stdio: service.background ? 'pipe' : 'inherit',
  });

  if (service.background) {
    // Capture output for debugging
    if (proc.stdout) {
      proc.stdout.on('data', (data) => {
        const line = data.toString().trim();
        if (line) console.log(`  ${colors.gray(`[${service.name}]`)} ${line}`);
      });
    }
    if (proc.stderr) {
      proc.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) console.log(`  ${colors.red(`[${service.name}]`)} ${line}`);
      });
    }

    // Handle crashes
    proc.on('exit', (code) => {
      log('error', `${service.name} crashed with exit code ${code}`);
      log('error', 'Stopping remaining services...');
      cleanup();
    });
  }

  runningProcesses.push({ name: service.name, process: proc });
  log('success', `${service.name} started (PID ${proc.pid})`);

  return proc;
}

/**
 * Graceful shutdown
 */
function cleanup() {
  log('warn', 'Shutting down services...');
  for (const { name, process: proc } of runningProcesses) {
    log('info', `Stopping ${name}...`);
    proc.kill('SIGTERM');
  }
  process.exit(1);
}

/**
 * Main orchestration
 */
async function orchestrate() {
  console.log(`\n${colors.cyan('🚀 HYDI Startup Orchestrator\n')}`);

  // Phase 1: Validate
  checkPorts();
  console.log('');

  // Phase 2: Wait for critical deps
  waitForDependencies();

  // Phase 3: Start services
  console.log(`\n${colors.cyan('🔄 Starting services in order...')}\n`);
  for (let i = 0; i < STARTUP_ORDER.length; i++) {
    const service = STARTUP_ORDER[i];
    startService(service, i + 1);

    // Give each service time to start
    if (i < STARTUP_ORDER.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`\n${colors.green('✅ All services started!')}`);
  console.log('\nDashboard: http://localhost:3000');
  console.log('Chat API:  http://localhost:3006');
  console.log('Core:      http://localhost:3458\n');
}

// Start
orchestrate().catch((err) => {
  log('error', err.message);
  cleanup();
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('warn', 'Received SIGINT...');
  cleanup();
});

process.on('SIGTERM', () => {
  log('warn', 'Received SIGTERM...');
  cleanup();
});
