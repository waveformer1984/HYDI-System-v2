'use strict';
/**
 * Boot-agent side of the restart control channel.
 * ---------------------------------------------------------------------------
 * When RecoveryEngine decides a module must restart, it no longer spawns the
 * replacement itself (which severed ownership -- see scripts/boot-control.js
 * for the measured evidence). It writes a request, and boot-agent performs the
 * restart here, so the new process is still boot-agent's child and remains
 * stoppable by the supervisor.
 *
 * All process-touching behaviour is injected. That keeps this unit testable
 * without spawning anything, and keeps boot-agent's module-level state
 * (`running`, `spawnProcess`, `log`) where it already lives.
 */

/**
 * Perform one restart request.
 *
 * @param {{id:string, component:string}} req
 * @param {{
 *   findEntry: (component:string) => object|null,
 *   stopChild: (entry:object) => Promise<any>,
 *   spawnProcess: (mod:object) => object,
 *   waitForHealth: (mod:object) => Promise<boolean>,
 *   verifyRestarted?: (mod:object, child:object) => Promise<boolean>,
 *   recordLease?: (component:string, info:object) => any,
 *   log: (id:string, msg:string) => void,
 * }} deps
 * @returns {Promise<{status:'completed'|'failed', pid?:number, ownedBy?:string, error?:string}>}
 */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

function portListening(port, timeoutMs = 3000) {
  const net = require('net');
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (up) => { try { sock.destroy(); } catch (_) { /* */ } resolve(up); };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.once('connect', () => { clearTimeout(timer); done(true); });
    sock.once('error', () => { clearTimeout(timer); done(false); });
    try { sock.connect(port, '127.0.0.1'); } catch (_) { clearTimeout(timer); done(false); }
  });
}

// Default post-restart proof: the new child is a live process and, if the
// module owns a port, that port is listening. boot-agent may inject a stricter
// verifyRestarted, but a completed restart is never acked on health alone.
async function defaultVerifyRestarted(mod, child) {
  if (!isPidAlive(child && child.pid)) return false;
  if (mod && mod.port) return portListening(mod.port);
  return true;
}

// Default lease writer — the same durable ownership record RecoveryEngine
// writes when it spawns a detached replacement. child.pid here is the spawn
// wrapper pid, matching the lease's documented convention.
function defaultRecordLease(component, info) {
  return require('./recovery-lease').record(component, info);
}

async function handleRestartRequest(req, deps) {
  const { findEntry, stopChild, spawnProcess, waitForHealth, log } = deps;
  const component = req.component;

  const entry = findEntry(component);
  if (!entry) {
    return { status: 'failed', error: `${component} is not a module supervised by this boot agent` };
  }

  // boot-agent can only restart processes it actually owns. An entry marked
  // `external` is a port occupant it adopted for reporting purposes, not a
  // child it spawned -- it has no handle to stop, so "restarting" it would
  // mean spawning a duplicate alongside whatever is already bound to the port.
  if (entry.external || !entry.child) {
    // Exception: if the module's port is now FREE, the foreign occupant is
    // gone and respawning cannot collide with anything — adopt the module
    // into supervision by spawning it as a normal owned child.
    // (Live incident 2026-09-21: PM2 restarted hydi-boot while its children
    // kept running; they were classified 'unsupervised', later died, and no
    // policy could ever restart them — a permanent escalation loop. Refusing
    // is only correct while a live foreign occupant still owns the port.)
    const portFree = deps.isPortFree ? await deps.isPortFree(entry.mod) : false;
    if (!portFree) {
      return {
        status: 'failed',
        error: `${component} is not owned by this boot agent (external/unsupervised occupant); cannot restart what it did not spawn`,
      };
    }
    log(component, 'external occupant gone (port free) -- adopting module by supervised respawn');
  } else {
    // Mark before stopping. spawnProcess()'s exit handler treats every exit as
    // unexpected; without this an intentional restart is logged as a crash and,
    // outside DELEGATE_RECOVERY mode, triggers a full system shutdown.
    entry.child.intentionalStop = true;

    try {
      log(component, 'restart requested by RecoveryEngine -- stopping owned child');
      await stopChild(entry);
    } catch (e) {
      // Spawning on top of a process we failed to stop would duplicate the
      // service and collide on its port.
      entry.child.intentionalStop = false;
      return { status: 'failed', error: `failed to stop ${component}: ${e.message}` };
    }
  }

  let child;
  try {
    child = spawnProcess(entry.mod);
  } catch (e) {
    return { status: 'failed', error: `failed to spawn ${component}: ${e.message}` };
  }

  // Point the running entry at the new child. If this still referenced the
  // dead one, shutdown would stop nothing and leave the replacement running --
  // an orphan created by the very change meant to prevent them.
  entry.child = child;
  // Adoption-by-respawn: the module is now this boot agent's child — clear
  // the external marker and record the real pid so subsequent restarts,
  // shutdown, and supervision all treat it as owned.
  entry.external = false;
  entry.pid = child.pid;

  let healthy = false;
  try {
    healthy = await waitForHealth(entry.mod);
  } catch (e) {
    return { status: 'failed', error: `health check errored for ${component}: ${e.message}` };
  }

  if (!healthy) {
    return { status: 'failed', pid: child.pid, error: `${component} did not become healthy after restart` };
  }

  // A health endpoint is not the only thing a restart must prove. For modules
  // with no `health` block, waitForHealth resolves true vacuously -- which let
  // three of seven modules ack 'completed' with no verification at all
  // (red-team 2026-09-18). When there IS a health check, a passing probe is the
  // proof; when there is not, require at minimum that the new child is a live
  // process and -- if it owns a port -- that the port is actually listening.
  const verifyRestarted = deps.verifyRestarted || defaultVerifyRestarted;
  const verified = entry.mod.health ? true : await verifyRestarted(entry.mod, child);
  if (!verified) {
    return {
      status: 'failed',
      pid: child.pid,
      error: `${component} restarted but did not verify (process dead or port ${entry.mod.port ?? 'n/a'} not listening)`,
    };
  }

  // The restart is mechanically proven — but a completed ack must not be
  // issued while the durable ownership record still names the dead,
  // pre-restart pid. Measured 2026-09-18: a boot-control respawn restored
  // protoforge-core cleanly while .recovery-leases/protoforge-core.json kept
  // naming a dead pid, and that stale ownership claim fed repeated false
  // recovery evaluations. Record the new owner first; if the lease cannot
  // be written, the honest answer is 'failed' with the live pid — the
  // requester can then see the child exists but the ownership record
  // disagreed, rather than a fabricated clean restart.
  const recordLease = deps.recordLease || defaultRecordLease;
  try {
    recordLease(component, {
      pid: child.pid,
      command: entry.mod.command || null,
      args: entry.mod.args || [],
      recoveredBy: 'boot-agent.restart',
      cause: req.id,
    });
  } catch (e) {
    return {
      status: 'failed',
      pid: child.pid,
      error: `${component} restarted and verified but recovery lease update failed: ${e.message}`,
    };
  }

  log(component, `restart complete -- now owned at pid ${child.pid}`);
  return { status: 'completed', pid: child.pid, ownedBy: 'boot-agent' };
}

module.exports = { handleRestartRequest };
