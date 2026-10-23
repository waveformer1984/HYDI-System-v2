'use strict';

/**
 * Docker runtime collection — the container half of the runtime audit.
 *
 * The PM2 audit (collect.js / drift-audit.js) covers managed app processes;
 * the docker side (supabase_* containers, compose services) was previously
 * observed only by the retired src/heidi-executive RuntimeObserver. This
 * module ports that observation into the current plane — read-only,
 * bounded, and honest about environment:
 *
 *   - docker CLI missing        → { docker: 'NOT_CONFIGURED' }  (not a failure)
 *   - docker daemon unreachable → { docker: 'UNAVAILABLE' }
 *   - reachable                 → per-container state rows
 *
 * Every exec goes through one injectable seam (no shell — argv arrays only,
 * same defence-in-depth posture as InfrastructureAdapter's DOCKER_NAME).
 * Nothing here restarts, kills, or mutates containers.
 */

const { execFile } = require('child_process');

const DOCKER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.\-]*$/;

function defaultExec(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: (stdout || '').toString().trim(),
        stderr: (stderr || '').toString().trim(),
        error: err ? err.message : null,
      });
    });
  });
}

function isCliMissing(res) {
  const msg = `${res.error || ''} ${res.stderr || ''}`.toLowerCase();
  return msg.includes('enoent') || msg.includes('not recognized') || msg.includes('not found');
}

/**
 * Collect live docker container state.
 * opts.exec (cmd, args, timeoutMs) → Promise<{ok, stdout, stderr, error}>
 * is the single injectable seam — tests inject a stub, nothing else is
 * faked at module level.
 */
async function collectDockerContainers(opts = {}) {
  const exec = opts.exec || defaultExec;
  const timeoutMs = opts.timeoutMs || 10000;

  const ver = await exec('docker', ['version', '--format', '{{.Server.Version}}'], timeoutMs);
  if (!ver.ok) {
    if (isCliMissing(ver)) {
      return { docker: 'NOT_CONFIGURED', detail: ver.error || ver.stderr, containers: [] };
    }
    return { docker: 'UNAVAILABLE', detail: ver.error || ver.stderr, containers: [] };
  }

  const ps = await exec('docker', ['ps', '--all', '--format', '{{.Names}}\t{{.Status}}'], timeoutMs);
  if (!ps.ok) {
    return { docker: 'UNAVAILABLE', detail: ps.error || ps.stderr, containers: [] };
  }

  const containers = ps.stdout.split('\n').filter(Boolean).map((line) => {
    const [name, status] = line.split('\t');
    const lower = (status || '').toLowerCase();
    return {
      name: name || null,
      status: status || null,
      running: lower.startsWith('up'),
      exited: lower.includes('exited'),
      restarting: lower.includes('restarting'),
      restartCount: null, // filled below for non-running rows only
    };
  }).filter((c) => c.name);

  // Restart counts matter for unhealthy rows (crash-loop evidence); fetching
  // them per-container keeps the healthy-path probe count at 2.
  for (const c of containers) {
    if (c.running && !c.restarting) continue;
    if (!DOCKER_NAME.test(c.name)) continue; // never interpolate an unvalidated name
    const ins = await exec('docker', ['inspect', '--format', '{{.State.Status}}\t{{.RestartCount}}', c.name], timeoutMs);
    if (ins.ok) {
      const [state, restarts] = ins.stdout.split('\t');
      c.inspectState = state || null;
      c.restartCount = parseInt(restarts, 10) || 0;
    }
  }

  const crashed = containers.filter((c) => c.exited).length;
  const restarting = containers.filter((c) => c.restarting).length;
  return {
    docker: crashed > 0 || restarting > 0 ? 'DEGRADED' : 'HEALTHY',
    detail: `${containers.length} container(s): ${crashed} exited, ${restarting} restarting`,
    containers,
  };
}

/**
 * Read back one container's state — the verifier's independent check after a
 * bounded restart. Returns { exists, running, restarting, restartCount } —
 * never 'assumed'.
 */
async function inspectDockerContainer(name, opts = {}) {
  const exec = opts.exec || defaultExec;
  const timeoutMs = opts.timeoutMs || 10000;
  if (!name || !DOCKER_NAME.test(name)) {
    return { exists: false, running: false, restarting: false, restartCount: null, error: 'invalid container name' };
  }
  const ins = await exec('docker', ['inspect', '--format', '{{.State.Status}}\t{{.RestartCount}}', name], timeoutMs);
  if (!ins.ok) {
    return { exists: false, running: false, restarting: false, restartCount: null, error: ins.error || ins.stderr };
  }
  const [state, restarts] = ins.stdout.split('\t');
  return {
    exists: true,
    running: state === 'running',
    restarting: state === 'restarting',
    restartCount: parseInt(restarts, 10) || 0,
    error: null,
  };
}

module.exports = { collectDockerContainers, inspectDockerContainer, DOCKER_NAME };
