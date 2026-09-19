'use strict';
/**
 * Boot control channel — routes recovery restarts through the boot authority
 * so ownership is never severed.
 * ---------------------------------------------------------------------------
 * The gap this closes (measured 2026-09-18, HYDI_BASELINE.json):
 *
 *   RecoveryEngine.restartProcess() spawns replacements
 *   `{ shell: true, detached: true }` + `child.unref()`. That is genuinely
 *   necessary for the standalone `hydi:recover` CLI — an attached child would
 *   be killed the moment the CLI exits, making recovery transient. But the
 *   consequence is that a recovered process is not a child of boot-agent, so:
 *     - boot-agent cannot watch it for `exit`
 *     - the supervisor cannot stop it
 *     - it shows up with dead ancestry
 *
 *   Observed: protoforge-core and heidi-web were both ORPHAN with DEAD
 *   ancestry. heidi-mobile-chat was the only owned service — precisely
 *   because it had never been recovered. Every recovery converted a
 *   supervised module into an orphan.
 *
 * scripts/recovery-lease.js:22-34 already named this fix and deferred it:
 * "Full continuous re-supervision would require routing the actual spawn
 * through boot-agent itself (a live IPC channel into the running boot-agent
 * process)". This file is that channel.
 *
 * Division of responsibility is unchanged from SUPERVISION_MODEL.md:
 * RecoveryEngine still owns the *policy decision* (is a restart authorized,
 * within budget, not observer-confused). boot-agent owns the *spawn*, because
 * it owns the process. Only the mechanism moves.
 *
 * Why a filesystem queue and not a socket: this system already has four
 * documented port collisions (3000/3001/3005/3006). Adding a listening port
 * to the boot authority would add a fifth plus a new attack surface. A
 * directory of small JSON files is durable across either side restarting,
 * works identically on Windows and POSIX, and is trivially inspectable by an
 * operator during an incident.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Test seam, mirroring RECOVERY_LEASE_DIR / HYDI_BOOT_LEASE_PATH. Production never sets it. */
const CONTROL_DIR = process.env.BOOT_CONTROL_DIR
  ? path.resolve(process.env.BOOT_CONTROL_DIR)
  : path.resolve(__dirname, '..', '.hydi-boot-control');

const BOOT_LEASE_PATH = process.env.HYDI_BOOT_LEASE_PATH
  ? path.resolve(process.env.HYDI_BOOT_LEASE_PATH)
  : path.resolve(__dirname, '..', '.hydi-boot.lock');

/**
 * How long a restart request stays actionable. A request older than this is
 * ignored rather than executed: if boot-agent was down when the request was
 * written, replaying a stale order on its next start could restart a module
 * that is currently healthy, for a failure that resolved long ago.
 */
const REQUEST_TTL_MS = 2 * 60 * 1000;

function requestPath(id) { return path.join(CONTROL_DIR, `${id}.request.json`); }
function ackPath(id) { return path.join(CONTROL_DIR, `${id}.ack.json`); }

/** Atomic write: temp file in the same directory, then rename. */
function writeJsonAtomic(target, body) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

/**
 * Request/ack authentication (red-team 2026-09-18).
 * ---------------------------------------------------------------------------
 * The control directory is writable by any same-user process, and the files
 * previously carried NO authentication — a forged `*.request.json` made
 * boot-agent stop-and-respawn a supervised module (an unauthenticated DoS
 * every RESTART_COOLDOWN per component), and a planted `*.ack.json` could
 * fabricate a successful restart. Both directions are now signed: an HMAC
 * over the record's identity fields, verified on read. Unsigned, mis-signed,
 * or tampered records are dropped, never acted on.
 *
 * Key: HYDI_APPROVAL_SECRET, falling back to SUPABASE_SERVICE_ROLE_KEY —
 * the same chain as lib/governance/approval-signing.ts. Residual (documented,
 * not silently ignored): a same-user attacker who can also read the repo's
 * .env can mint valid signatures — the boundary this draws is against
 * forgery without key access, not against full env compromise. If no key is
 * configured the channel fails closed: requests cannot be minted and reads
 * verify nothing.
 */
function controlSecret() {
  const k = process.env.HYDI_APPROVAL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return k && k.length > 0 ? k : null;
}

function signFields(fields) {
  const key = controlSecret();
  if (!key) return null;
  const body = Object.keys(fields).sort().map((k) => `${k}=${String(fields[k] ?? '')}`).join('|');
  return crypto.createHmac('sha256', key).update(body).digest('hex');
}

function verifySigned(record, fields) {
  const expected = signFields(fields);
  const given = record && record.signature;
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requestSignatureFields(entry) {
  return { id: entry.id, component: entry.component, requestedAt: entry.requestedAt, requestedBy: entry.requestedBy };
}

function ackSignatureFields(entry) {
  return { id: entry.id, status: entry.status, pid: entry.pid, ownedBy: entry.ownedBy, acknowledgedAt: entry.acknowledgedAt };
}

/**
 * Ask the boot authority to restart `component`. Returns the request record.
 * Writing a request does not restart anything by itself — boot-agent must be
 * running and polling for it to be acted on.
 * Throws when no signing key is configured: an unverifiable restart order
 * must not exist on disk at all.
 */
function requestRestart(component, info = {}) {
  const entry = {
    id: crypto.randomUUID(),
    component,
    requestedAt: new Date().toISOString(),
    requestedBy: info.requestedBy || 'unknown',
    reason: info.reason || null,
    cause: info.cause || null,
  };
  const signature = signFields(requestSignatureFields(entry));
  if (!signature) {
    throw new Error('boot-control: no signing key configured (HYDI_APPROVAL_SECRET / SUPABASE_SERVICE_ROLE_KEY) — refusing to write an unverifiable restart request');
  }
  entry.signature = signature;
  writeJsonAtomic(requestPath(entry.id), entry);
  return entry;
}

/**
 * Requests that are still actionable: not yet acknowledged, not past TTL,
 * and parseable. A malformed file is skipped, never thrown — a corrupt
 * control file must not be able to take the boot authority down.
 */
function pendingRequests() {
  let names;
  try { names = fs.readdirSync(CONTROL_DIR); } catch (_) { return []; }

  const now = Date.now();
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.request.json')) continue;
    const req = readJson(path.join(CONTROL_DIR, name));
    if (!req || typeof req.id !== 'string' || typeof req.component !== 'string') continue;
    // Forgery check: the request must carry a valid signature over its
    // identity fields — a file planted by any other writer is dropped.
    if (!verifySigned(req, requestSignatureFields(req))) continue;
    if (fs.existsSync(ackPath(req.id))) continue;

    const age = now - new Date(req.requestedAt).getTime();
    if (!Number.isFinite(age) || age > REQUEST_TTL_MS) continue;

    out.push(req);
  }
  return out.sort((a, b) => new Date(a.requestedAt) - new Date(b.requestedAt));
}

/**
 * Record the outcome of a restart request. `status` is 'completed' or
 * 'failed' — there is deliberately no third "probably fine" value.
 */
function ackRequest(id, result = {}) {
  const entry = {
    id,
    status: result.status || 'failed',
    pid: result.pid ?? null,
    ownedBy: result.ownedBy || null,
    error: result.error || null,
    acknowledgedAt: new Date().toISOString(),
  };
  const signature = signFields(ackSignatureFields(entry));
  if (!signature) {
    throw new Error('boot-control: no signing key configured — refusing to write an unverifiable ack');
  }
  entry.signature = signature;
  writeJsonAtomic(ackPath(id), entry);
  return entry;
}

/** The ack for `id`, or null if absent OR its signature does not verify — a planted ack reads as no ack. */
function readAck(id) {
  const ack = readJson(ackPath(id));
  if (!ack) return null;
  if (!verifySigned(ack, ackSignatureFields(ack))) return null;
  return ack;
}

/**
 * Wait for an ack. On timeout returns `{ status: 'timeout' }` rather than
 * throwing or guessing — the caller must be able to tell "boot-agent said it
 * failed" apart from "boot-agent never answered", because those need
 * different recovery decisions.
 */
async function waitForAck(id, { timeoutMs = 120000, pollMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (; ;) {
    const ack = readAck(id);
    if (ack) return ack;
    if (Date.now() >= deadline) {
      return { id, status: 'timeout', acknowledgedAt: null };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but belongs to another user.
    return e && e.code === 'EPERM';
  }
}

/**
 * Is a boot authority currently running and therefore able to perform an
 * owned restart? Fail-closed: a missing, corrupt, or stale lease reads as
 * "not available". An unknown must never resolve to "yes, go ahead" — that
 * is what would silently reintroduce the orphan-making path.
 */
function isBootAuthorityAlive() {
  const lease = readJson(BOOT_LEASE_PATH);
  if (!lease || typeof lease.bootId !== 'string') return false;
  return isPidAlive(lease.pid);
}

/** Remove a completed exchange. Used by boot-agent after acking. */
function clearRequest(id) {
  for (const f of [requestPath(id), ackPath(id)]) {
    try { fs.unlinkSync(f); } catch (_) { /* already gone */ }
  }
}

module.exports = {
  requestRestart,
  pendingRequests,
  ackRequest,
  readAck,
  waitForAck,
  isBootAuthorityAlive,
  isPidAlive,
  clearRequest,
  CONTROL_DIR,
  REQUEST_TTL_MS,
};
