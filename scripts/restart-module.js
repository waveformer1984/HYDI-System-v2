#!/usr/bin/env node
'use strict';
/**
 * Restart a single boot.config.json module: stop ONLY the PID currently
 * bound to its port (never a blanket process kill -- see the hard rule
 * against `taskkill /IM node.exe` learned the hard way earlier in this
 * repo's history), then re-spawn it detached via boot-agent.js so it starts
 * fresh under the same health-gated, idempotent path as a normal boot.
 *
 * Usage: node scripts/restart-module.js <module-id>
 *
 * This is deliberately narrow: it does not confirm the new instance became
 * healthy (that would mean blocking on it, which conflicts with detaching).
 * Callers should re-check health separately after a few seconds.
 */

const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function loadModule(id, configPath = path.join(ROOT, 'boot.config.json')) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const mod = (config.modules || []).find((m) => m.id === id);
  if (!mod) {
    const known = (config.modules || []).map((m) => m.id).join(', ');
    throw new Error(`Unknown module id: '${id}'. Known ids: ${known}`);
  }
  if (!mod.port) {
    throw new Error(`Module '${id}' has no port in boot.config.json -- nothing to restart by port.`);
  }
  return mod;
}

function findPidOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = cp.execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
      const line = out.split('\n').find((l) => l.includes(`:${port} `) && /LISTENING/.test(l));
      if (!line) return null;
      const parts = line.trim().split(/\s+/);
      return parts[parts.length - 1];
    }
    const out = cp.execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' }).trim();
    return out.split('\n')[0] || null;
  } catch {
    return null; // nothing listening, or the lookup tool isn't available
  }
}

function stopPid(pid) {
  if (process.platform === 'win32') {
    cp.execFileSync('taskkill', ['/PID', pid, '/F']);
  } else {
    cp.execFileSync('kill', ['-9', pid]);
  }
}

function spawnDetached(id) {
  const child = cp.spawn(
    process.execPath,
    [path.join(ROOT, 'scripts/boot-agent.js'), `--only=${id}`],
    { cwd: ROOT, detached: true, stdio: 'ignore' }
  );
  child.unref();
  return child;
}

/** Full restart flow for one module id. Returns a summary object; never throws for "not running". */
function restartModule(id, { log = console.log } = {}) {
  const mod = loadModule(id);
  const pid = findPidOnPort(mod.port);

  if (pid) {
    log(`[restart-module] Stopping ${id} (pid ${pid}, port ${mod.port})...`);
    stopPid(pid);
    log(`[restart-module] pid ${pid} stopped.`);
  } else {
    log(`[restart-module] ${id} was not running on port ${mod.port}.`);
  }

  log(`[restart-module] Starting ${id} via boot-agent (detached)...`);
  const child = spawnDetached(id);
  log(`[restart-module] Restart initiated for '${id}' (new supervisor pid ${child.pid}). Check health separately.`);

  return { id, stoppedPid: pid || null, supervisorPid: child.pid };
}

if (require.main === module) {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: node scripts/restart-module.js <module-id>');
    process.exit(1);
  }
  try {
    restartModule(id);
  } catch (e) {
    console.error(`[restart-module] ${e.message}`);
    process.exit(1);
  }
}

module.exports = { restartModule, findPidOnPort, loadModule };
