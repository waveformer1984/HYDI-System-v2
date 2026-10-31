'use strict';
/**
 * Kong-wedge self-heal.
 * ----------------------------------------------------------------------------
 * Symptom (observed 2026-10-31 on Frank): after any WSL restart the Supabase
 * containers report `Up` in `docker ps`, but the host port-forward for Kong
 * (`SUPABASE_URL`, :54321) stops answering - every request is refused. Nothing
 * in the container knows it is wedged, so the stack reports itself healthy
 * while hydi-daemon logs `rest=down` and dies on it.
 *
 * Fix that worked by hand: `docker restart supabase_kong_<project>` rebinds
 * the forward and REST returns 200.
 *
 * What this does, once per hydi-system-health cycle:
 *   1. GET <SUPABASE_URL>/rest/v1/ - any HTTP response means the forward is
 *      alive; we do nothing.
 *   2. Only when the request is refused (fetch throws / no response): check
 *      `docker ps` for a `supabase_kong_*` container that is `Up`.
 *   3. Only when such a container exists: `docker restart <name>` (exactly
 *      that one - never any other container), wait, re-probe REST.
 *   4. At most one restart attempt per COOLDOWN_MS, durable in a state file
 *      so a scheduler restart cannot bypass it. Every attempt is logged.
 *
 * Everything injectable so the refusal + container-up case is testable
 * without Docker or a socket.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const COOLDOWN_MS = parseInt(process.env.KONG_HEAL_COOLDOWN_MS || '600000', 10); // 10 min
const PROBE_TIMEOUT_MS = parseInt(process.env.KONG_HEAL_PROBE_TIMEOUT_MS || '8000', 10);
const RECHECK_DELAY_MS = parseInt(process.env.KONG_HEAL_RECHECK_DELAY_MS || '15000', 10);
const STATE_FILE = path.join(__dirname, '..', '..', 'logs', 'kong-heal-last.json');
const KONG_NAME_RE = /^supabase_kong_\S+/;

const MAX_LOG_LINE = 500;

/**
 * Make one safe log line out of text that may carry probe or docker error
 * messages: control characters (newlines included) become spaces, so one
 * call can never forge extra lines, and the line is capped in length.
 */
function sanitizeLogLine(line) {
  // eslint-disable-next-line no-control-regex
  const flat = String(line).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim();
  return flat.length > MAX_LOG_LINE ? `${flat.slice(0, MAX_LOG_LINE)}…` : flat;
}

function defaultLog(line) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(STATE_FILE.replace(/\.json$/, '.log'), `${new Date().toISOString()} ${sanitizeLogLine(line)}\n`);
  } catch (_) { /* logging must never throw */ }
}

function docker(args) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout));
    });
  });
}

async function probeRest(base, timeoutMs) {
  const url = `${String(base).replace(/\/$/, '')}/rest/v1/`;
  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.status;
}

function readLastAttempt(stateFile) {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    return typeof j.lastAttemptAt === 'string' ? Date.parse(j.lastAttemptAt) : null;
  } catch (_) {
    return null;
  }
}

function writeLastAttempt(stateFile, at) {
  try {
    const dir = path.dirname(stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ lastAttemptAt: at }));
  } catch (_) { /* state write is best-effort */ }
}

/**
 * One probe+heal decision. Returns a small object describing what happened;
 * never throws, never restarts anything except a single supabase_kong_*.
 */
async function maybeHealKong(deps = {}) {
  const supabaseUrl = deps.supabaseUrl || process.env.SUPABASE_URL;
  const fetcher = deps.fetcher || probeRest;
  const dockerRunner = deps.dockerRunner || docker;
  const stateFile = deps.stateFile || STATE_FILE;
  const cooldownMs = deps.cooldownMs ?? COOLDOWN_MS;
  const recheckDelayMs = deps.recheckDelayMs ?? RECHECK_DELAY_MS;
  const log = deps.log || defaultLog;
  const now = deps.now || (() => Date.now());

  if (!supabaseUrl) return { action: 'none', reason: 'SUPABASE_URL not set' };

  // Same switch as lib/operational/live-action-guard.ts: the Tier 1 test
  // guard sets it so no test can reach the real docker. Without this, every
  // runCycle() test in CI (SUPABASE_URL set, Kong blocked by the guard, real
  // docker present) went on to `docker restart supabase_kong_*` and waited
  // 15s. Tests that inject a dockerRunner still exercise the full path.
  if (process.env.HYDI_DISABLE_LIVE_ACTIONS === '1' && !deps.dockerRunner) {
    return { action: 'none', reason: 'live actions disabled (HYDI_DISABLE_LIVE_ACTIONS)' };
  }

  // 1. Is REST reachable? Any HTTP status (even 4xx) means the forward works.
  try {
    const status = await fetcher(supabaseUrl, PROBE_TIMEOUT_MS);
    return { action: 'none', reason: `rest reachable (HTTP ${status})`, status };
  } catch (_) { /* refused / timed out - candidate for heal */ }

  // 2. Is there an Up kong container? If not, Docker isn't the problem.
  let ps;
  try {
    ps = await dockerRunner(['ps', '--format', '{{.Names}} {{.Status}}']);
  } catch (e) {
    log(`kong-heal: docker ps failed (${e.message}) - not healing`);
    return { action: 'none', reason: `rest refused; docker ps failed: ${e.message}` };
  }

  const kong = ps
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => KONG_NAME_RE.test(l) && /\bUp\b/i.test(l))
    .map((l) => l.split(/\s+/)[0])[0];

  if (!kong) {
    log('kong-heal: rest refused and no Up supabase_kong_* container - not healing');
    return { action: 'none', reason: 'rest refused; no Up supabase_kong_* container' };
  }

  // 3. Cooldown: at most one attempt per window, durable across restarts.
  const last = readLastAttempt(stateFile);
  const at = now();
  if (last !== null && at - last < cooldownMs) {
    log(`kong-heal: rest refused and ${kong} is Up, but within ${cooldownMs}ms cooldown (last ${new Date(last).toISOString()}) - skipping`);
    return { action: 'rate-limited', reason: `within cooldown`, container: kong, lastAttemptAt: last };
  }

  // 4. The one permitted action: restart exactly that container.
  log(`kong-heal: rest refused; ${kong} is Up - restarting it to rebind the port-forward`);
  writeLastAttempt(stateFile, new Date(at).toISOString());
  try {
    await dockerRunner(['restart', kong]);
  } catch (e) {
    log(`kong-heal: docker restart ${kong} failed: ${e.message}`);
    return { action: 'restart-failed', reason: e.message, container: kong };
  }

  await new Promise((r) => setTimeout(r, recheckDelayMs));

  try {
    const status = await fetcher(supabaseUrl, PROBE_TIMEOUT_MS);
    log(`kong-heal: ${kong} restarted; REST now answers HTTP ${status} - recovered`);
    return { action: 'recovered', container: kong, status };
  } catch (_) {
    log(`kong-heal: ${kong} restarted but REST still refused - manual look needed`);
    return { action: 'still-refused', container: kong };
  }
}

module.exports = { maybeHealKong, sanitizeLogLine, COOLDOWN_MS, STATE_FILE };
