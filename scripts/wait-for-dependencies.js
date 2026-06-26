#!/usr/bin/env node
/**
 * Dependency Gating: Wait for services to be ready
 *
 * Blocks startup until critical dependencies report healthy.
 * Prevents: orphaned processes, database connection errors, startup race conditions
 *
 * Usage:
 *   node scripts/wait-for-dependencies.js
 */

const http = require('http');
const PORTS_CONFIG = require('../.ports.json');

const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
};

// Critical dependencies that must be ready before startup
const CRITICAL_DEPS = {
  supabase: {
    port: 54321,
    path: '/health',
    timeout: 30000, // 30s max wait
    description: 'PostgreSQL database',
  },
  ollama: {
    port: 11434,
    path: '/api/tags',
    timeout: 30000,
    description: 'Local LLM embeddings',
  },
};

/**
 * Check if a service is healthy
 */
function checkHealth(name, config) {
  return new Promise((resolve) => {
    const url = `http://127.0.0.1:${config.port}${config.path}`;
    const timeout = setTimeout(() => {
      resolve({ name, ok: false, reason: 'Timeout' });
    }, 5000);

    http
      .get(url, { timeout: 5000 }, (res) => {
        clearTimeout(timeout);
        resolve({
          name,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          reason: res.statusCode,
        });
      })
      .on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          name,
          ok: false,
          reason: err.code || err.message,
        });
      });
  });
}

/**
 * Wait for all dependencies with exponential backoff
 */
async function waitForDependencies() {
  console.log(`\n${colors.cyan('⏳ Waiting for dependencies...')}\n`);

  const maxRetries = 12; // 12 * 5s = 60s total
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    console.log(
      `${colors.gray(`[${new Date().toLocaleTimeString()}]`)} Attempt ${attempt}/${maxRetries}...`
    );

    const results = await Promise.all(
      Object.entries(CRITICAL_DEPS).map(([name, config]) => checkHealth(name, config))
    );

    const allHealthy = results.every((r) => r.ok);

    // Report status
    for (const result of results) {
      const status = result.ok
        ? colors.green(`✓ ${result.name}`)
        : colors.red(`✗ ${result.name} (${result.reason})`);
      console.log(`         ${status}`);
    }

    if (allHealthy) {
      console.log(`\n${colors.green('✅ All dependencies ready!')}\n`);
      return true;
    }

    if (attempt < maxRetries) {
      const waitTime = Math.min(5000 * Math.pow(1.2, attempt - 1), 30000);
      console.log(colors.yellow(`   Retrying in ${(waitTime / 1000).toFixed(1)}s...\n`));
      await new Promise((r) => setTimeout(r, waitTime));
    }
  }

  // Failed
  console.log(colors.red('\n❌ Dependencies not ready after 60s. Aborting startup.\n'));
  console.log('Troubleshooting:');
  console.log('  1. Check Supabase: supabase status');
  console.log('  2. Check Ollama: curl http://localhost:11434/api/tags');
  console.log('  3. View logs: supabase logs -f\n');

  process.exit(1);
}

// Run
waitForDependencies().catch((err) => {
  console.error(colors.red('❌ Error:'), err.message);
  process.exit(1);
});
