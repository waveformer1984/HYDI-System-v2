/**
 * Unit test for scripts/wait-for-dependencies.js's service-scoping guard.
 *
 * This script previously never actually checked anything: ollama and
 * supabase are both marked `external: true` in .ports.json (correctly, for
 * check-ports.js's different "don't flag this port as our own conflict"
 * purpose), and the old getCriticalDeps() reused that same flag to mean
 * "skip checking reachability" -- so CRITICAL_DEPS was always empty and
 * the script trivially reported success. Fixed to check ollama/supabase
 * regardless of `external`, and added an optional <service-key> argument
 * (used by predev/prestart as `next-app`, whose .ports.json depends_on is
 * ["supabase"] only, not ollama) with a guard against silently checking
 * nothing when the given service name doesn't exist in the registry.
 *
 * The full health-check retry loop isn't covered here -- it needs a live
 * Supabase/Ollama (or HTTP mocking inside a spawned child process, which
 * isn't practical for this script's structure) -- but the fast-fail guard
 * runs with no network calls and is a real regression risk on its own
 * (a typo'd service name would otherwise silently check nothing and always
 * report "ready").
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/wait-for-dependencies.js');

describe('scripts/wait-for-dependencies.js - service scoping guard', () => {
  it('exits non-zero with a clear error for an unknown service name, rather than silently checking nothing', () => {
    const result = spawnSync('node', [SCRIPT_PATH, 'not-a-real-service'], {
      encoding: 'utf8',
      timeout: 10000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Unknown service 'not-a-real-service'/);
    expect(result.stderr).toMatch(/next-app/); // known services listed for troubleshooting
  });
});

describe('scripts/wait-for-dependencies.js - dependency scoping logic', () => {
  // Exercises the same filtering getCriticalDeps() uses, directly against
  // the real .ports.json, without invoking the script's network calls.
  const PORTS_CONFIG = require('../../.ports.json');

  function criticalDepsFor(targetService) {
    const allowedKeys = targetService
      ? new Set(PORTS_CONFIG.services[targetService]?.depends_on || [])
      : null;
    const deps = {};
    for (const [key, config] of Object.entries(PORTS_CONFIG.services)) {
      if (allowedKeys && !allowedKeys.has(key)) continue;
      if (config.external && key !== 'ollama' && key !== 'supabase') continue;
      if (key === 'ollama') deps.ollama = { port: config.port };
      if (key === 'supabase') deps.supabase = { port: config.port };
    }
    return deps;
  }

  it('next-app depends only on supabase, not ollama', () => {
    const deps = criticalDepsFor('next-app');
    expect(Object.keys(deps)).toEqual(['supabase']);
  });

  it('checking with no target service includes both ollama and supabase', () => {
    const deps = criticalDepsFor(null);
    expect(Object.keys(deps).sort()).toEqual(['ollama', 'supabase']);
  });
});
