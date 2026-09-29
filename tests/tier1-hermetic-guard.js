'use strict';
/**
 * Tier 1 hermeticity guard (Phase 12).
 *
 * Why this exists rather than env vars alone
 * ------------------------------------------
 * The first hermeticity measurement redirected PG_PORT / SUPABASE_URL /
 * OLLAMA_URL to a closed port and reported 14 non-hermetic suites. That number
 * was an UNDERCOUNT: several test files hardcode the real endpoints and never
 * read those variables at all --
 * tests/unit/heidi-cognitive-loop-qualification.test.ts:25 literally sets
 * `port: 54322`. Those suites connected to the live database throughout the
 * experiment and appeared hermetic because nothing had actually been taken
 * away from them.
 *
 * Environment variables are a request. This is enforcement: outbound TCP to a
 * known local service port is refused inside Tier 1, whatever the caller
 * believed it was configured to do. A test that needs a service now fails
 * loudly and names itself, instead of silently depending on whether the
 * developer happened to have Docker running.
 *
 * Model (hardened 2026-09-18 after red-team)
 * ------------------------------------------
 * The original guard only refused a fixed port list. That left four live
 * bypasses, all demonstrated against the real suite:
 *
 *   - a service port missing from the list (:5050 heidi-bridge, :3001
 *     supabase-rest, :3459/:3461) was reachable mid-test;
 *   - a named pipe skipped the numeric-port check entirely, and
 *     \\.\pipe\docker_engine connected -> container escape from "hermetic" test;
 *   - child_process spawned a fresh `net` module -> a `node` child connected to
 *     live Postgres on :54322;
 *   - any non-loopback host (api.openai.com, cloud Supabase, an attacker box)
 *     was unrestricted because only local ports were listed.
 *
 * The corrected model: loopback to a NON-service port is allowed (in-test
 * servers are legitimate); loopback to a known service port is refused; every
 * non-loopback destination is refused; infra named pipes are refused; and the
 * guard is propagated to spawned node children via NODE_OPTIONS so a child
 * cannot inherit a clean net module.
 *
 * Scope: connections only. Nothing is stopped, nothing is reconfigured, and
 * this file is loaded solely by the Tier 1 jest config -- Tier 2+ run without
 * it and reach real services normally.
 *
 * Residual (documented, not silently missing): a spawned NON-node child
 * (pg_native via libpq, a compiled binary) and a child spawned with an env that
 * strips NODE_OPTIONS can still reach the network -- a guard inside the JS
 * runtime cannot police a foreign binary. The blocked-port env poisoning in
 * jest.config.js is the second layer for that case.
 */

// Idempotent: the guard is injected into spawned node children via NODE_OPTIONS
// --require, and a child may also load the same jest config. Loading twice must
// not wrap connect() in itself (that would recurse).
if (!global.__HYDI_TIER1_GUARD_LOADED) {
  global.__HYDI_TIER1_GUARD_LOADED = true;

  // Live-action kill-switch: the socket guard below cannot police
  // child_process — SelfRepairEngine repair handlers exec'd a real
  // `ollama serve` through it (and could reach docker restarts). Setting
  // this env makes every live-mutation boundary (lib/operational/
  // live-action-guard.ts) refuse honestly instead of executing. Spawned
  // node children inherit it via env, same as NODE_OPTIONS.
  process.env.HYDI_DISABLE_LIVE_ACTIONS = '1';

  const net = require('net');

  /**
   * Loopback service ports Tier 1 must never need -- the known local services a
   * test must be proven independent of, not merely configured away from.
   */
  const BLOCKED_PORTS = new Set([
    3000,  // heidi-web
    3001,  // supabase-rest (alt) / stray web
    3005,  // protoforge-core
    3006,  // heidi-mobile-chat
    3459,  // heidi-core
    3461,  // advisory / heidi aux
    5000,  // ursula flask
    5050,  // heidi-bridge (was reachable live mid-test, red-team 2026-09-18)
    5432,  // ursula postgres
    6379,  // redis
    11434, // ollama
    54321, // supabase kong / REST
    54322, // supabase postgres
    54323, // supabase studio
    54324, // supabase inbucket
    54325, // supabase storage
    54326, // supabase realtime
    54327, // supabase analytics
  ]);

  /**
   * Named pipes / IPC endpoints that reach outside the test sandbox. A string
   * first arg to net.connect() is a pipe path, not a port -- the numeric check
   * never ran on it. docker_engine is a container escape; the rest are local
   * daemons a hermetic test must not depend on. In-process IPC between Jest
   * workers does not traverse net.connect, so this does not break the runner.
   */
  const BLOCKED_PIPE = /docker|containerd|podman|kubelet|npipe|sql|postgres|mongo|redis|openssh|winbind/i;

  function isLoopbackHost(host) {
    if (!host) return true; // connect(port) with no host defaults to localhost
    const h = String(host).toLowerCase();
    return (
      h === 'localhost' ||
      h === '::1' ||
      h === '0.0.0.0' ||
      h === '::' ||
      h.startsWith('127.') ||
      h.endsWith('.localhost')
    );
  }

  function describeCaller() {
    // Surface the test file responsible, so the failure is actionable.
    const stack = new Error().stack || '';
    const line = stack
      .split('\n')
      .find((l) => /[\\/]tests[\\/]/.test(l) && !/tier1-hermetic-guard/.test(l));
    return line ? line.trim() : 'unknown caller';
  }

  function refuse(target) {
    const err = new Error(
      `TIER1_HERMETICITY_VIOLATION: outbound connection to ${target} was refused.\n` +
      `  Tier 1 is the hermetic fast gate and must run with every external service unavailable.\n` +
      `  This test requires a service (or a remote host), so it belongs in Tier 2 (npm run test:local).\n` +
      `  Add it to tests/TEST_TIERS.json -> tiers.tier2_local_service.members.\n` +
      `  Origin: ${describeCaller()}`
    );
    err.code = 'TIER1_HERMETICITY_VIOLATION';
    return err;
  }

  const realConnect = net.Socket.prototype.connect;

  net.Socket.prototype.connect = function patchedConnect(...args) {
    // net.Socket.connect accepts (options), (port[, host]), or (path).
    let port;
    let host;
    let pipePath;
    const first = args[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      if (typeof first.path === 'string' && first.port == null) {
        pipePath = first.path; // { path: '\\\\.\\pipe\\x' } named-pipe connect
      } else {
        port = Number(first.port);
        host = first.host;
      }
    } else if (typeof first === 'number') {
      port = first;
      host = typeof args[1] === 'string' ? args[1] : undefined;
    } else if (typeof first === 'string') {
      // A non-numeric string is a named-pipe / IPC path, not a port.
      if (Number.isFinite(Number(first))) {
        port = Number(first);
        host = typeof args[1] === 'string' ? args[1] : undefined;
      } else {
        pipePath = first;
      }
    }

    let violation = null;
    if (pipePath) {
      if (BLOCKED_PIPE.test(pipePath)) violation = refuse(`pipe ${pipePath}`);
    } else if (Number.isFinite(port)) {
      if (!isLoopbackHost(host)) violation = refuse(`${host || 'remote'}:${port} (non-loopback)`);
      else if (BLOCKED_PORTS.has(port)) violation = refuse(`${host || 'localhost'}:${port}`);
    }

    if (violation) {
      // Emit asynchronously, exactly as a real ECONNREFUSED would, and do NOT
      // throw. A synchronous throw escapes pg's async connect path as an
      // unhandled exception and kills the Jest worker outright -- a guard that
      // takes down the runner cannot tell you which tests are non-hermetic.
      process.nextTick(() => this.emit('error', violation));
      return this;
    }

    return realConnect.apply(this, args);
  };

  // fetch() does not go through net.Socket in undici, so guard it separately.
  const realFetch = global.fetch;
  if (typeof realFetch === 'function') {
    global.fetch = function guardedFetch(input, init) {
      let url;
      try {
        url = typeof input === 'string' ? new URL(input) : input && input.url ? new URL(input.url) : null;
      } catch {
        url = null;
      }
      if (url) {
        const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
        if (!isLoopbackHost(url.hostname)) {
          return Promise.reject(refuse(`${url.hostname}:${port} (non-loopback)`));
        }
        if (BLOCKED_PORTS.has(port)) {
          return Promise.reject(refuse(`${url.hostname}:${port}`));
        }
      }
      return realFetch.call(this, input, init);
    };
  }

  // Spawned node children get a fresh `net` module the patch above does not
  // reach. Rather than patching child_process (which would break exec's
  // differing signature and risk the runner), propagate via NODE_OPTIONS:
  // spawned node children inherit process.env by default, so they load this
  // guard too. Loopback-to-non-service-port stays allowed in the child, so an
  // in-test spawned server is unaffected.
  try {
    const guardPath = __filename.replace(/\\/g, '/');
    const existing = process.env.NODE_OPTIONS || '';
    if (!existing.includes(guardPath)) {
      process.env.NODE_OPTIONS = `${existing} --require "${guardPath}"`.trim();
    }
  } catch {
    // A child inheriting a clean net module is a known residual, never fatal.
  }

  module.exports = { BLOCKED_PORTS };
} else {
  module.exports = { BLOCKED_PORTS: new Set() };
}
