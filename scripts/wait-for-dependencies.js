#!/usr/bin/env node
/**
 * Dependency Gating: Wait for services to be ready
 *
 * Blocks startup until critical dependencies report healthy.
 * Prevents: orphaned processes, database connection errors, startup race conditions
 *
 * Usage:
 *   node scripts/wait-for-dependencies.js               # check every registry entry
 *   node scripts/wait-for-dependencies.js <service-key>  # only that service's depends_on
 */

const http = require('http');
const PORTS_CONFIG = require('../.ports.json');

const targetService = process.argv[2];

if (targetService && !PORTS_CONFIG.services[targetService]) {
  console.error(`Unknown service '${targetService}' in .ports.json -- refusing to silently check nothing.`);
  console.error(`Known services: ${Object.keys(PORTS_CONFIG.services).join(', ')}`);
  process.exit(1);
}

const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
};

/**
 * Determine which dependencies are critical based on .ports.json registry.
 *
 * .ports.json's `external` flag means something different to
 * check-ports.js (which uses it for "Docker/another process legitimately
 * owns this port, don't flag it as a conflict with our own process") than
 * it does here. ollama and supabase are both marked external for that
 * reason, but for local-first HYDI they're required local dependencies
 * (Ollama daemon / Docker Desktop's local Supabase) this process needs
 * running -- not services genuinely managed elsewhere that don't need a
 * reachability check. Only skip truly-external, non-boot-critical entries;
 * ollama and supabase are always checked when present in the registry.
 *
 * When targetService is given, only that service's declared depends_on
 * (e.g. next-app -> ["supabase"], not ollama) are checked -- gating
 * `npm run dev` on Supabase shouldn't also require Ollama to be up when
 * next-app's own registry entry doesn't depend on it.
 */
function getCriticalDeps() {
  const deps = {};
  const allowedKeys = targetService
    ? new Set(PORTS_CONFIG.services[targetService].depends_on || [])
    : null;

  for (const [key, config] of Object.entries(PORTS_CONFIG.services)) {
    if (allowedKeys && !allowedKeys.has(key)) continue;

    if (config.external && key !== 'ollama' && key !== 'supabase') {
      console.log(`${colors.gray('ℹ Skipping external service:')} ${config.name}`);
      continue;
    }

    // Map service key to health check config
    if (key === 'ollama') {
      deps.ollama = {
        port: config.port,
        path: '/api/tags',
        timeout: 30000,
        description: 'Local LLM embeddings',
      };
    }
    if (key === 'supabase') {
      deps.supabase = {
        port: config.port,
        path: '/health',
        timeout: 30000,
        description: 'PostgreSQL database',
      };
    }
  }

  return deps;
}

const CRITICAL_DEPS = getCriticalDeps();

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

  const depsToCheck = Object.entries(CRITICAL_DEPS);
  if (depsToCheck.length === 0) {
    console.log('  No critical dependencies configured.\n');
  } else {
    depsToCheck.forEach(([name, config]) => {
      console.log(`  • Check ${name}: curl http://localhost:${config.port}${config.path}`);
    });
    console.log('');
  }

  process.exit(1);
}

// Run
waitForDependencies().catch((err) => {
  console.error(colors.red('❌ Error:'), err.message);
  process.exit(1);
});
