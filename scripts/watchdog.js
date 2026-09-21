#!/usr/bin/env node
'use strict';
/**
 * HYDI Watchdog
 * ----------------------------------------------------------------------------
 * Independently polls the health endpoints of the three boot-managed HTTP
 * services and logs results. On any failure, writes a timestamped entry to
 * logs/watchdog.log and (optionally) POSTs an alert to WATCHDOG_WEBHOOK_URL.
 *
 * Two modes:
 *   node scripts/watchdog.js          # long-running, polls every 2 minutes
 *   node scripts/watchdog.js --once   # single check, then exit
 *
 * The --once mode is suitable for a Windows Scheduled Task that runs every
 * 2 minutes. The long-running mode is suitable for PM2.
 *
 * Environment:
 *   WATCHDOG_WEBHOOK_URL  (optional) — if set, POSTs JSON alerts on failures
 *   WATCHDOG_INTERVAL_MS  (optional) — poll interval, default 120000 (2 min)
 *
 * Log file: logs/watchdog.log (created automatically)
 * ---------------------------------------------------------------------------
 */

// Install TypeScript loader so we can import lib/operational/*.ts
// (same pattern as the recover CLI script)
require('./babel-register');

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// SelfHealthMonitor — HEIDI's own operational health (memory growth,
// stuck recoveries, stale observation cycles, persistence failures).
// Wired into the watchdog so HEIDI monitors itself alongside components.
const { SelfHealthMonitor } = require('../lib/operational/SelfHealthMonitor');
const { SystemStateModel } = require('../lib/operational/SystemStateModel');
const { evaluateEndpointHealth } = require('../lib/operational/EndpointHealthContract');

// Phase 6: Observation confidence — distinguishes observer failure from target failure
const {
  classifyObservation,
  ObservationHysteresis,
  ObservationMetricsCollector,
} = require('../lib/operational/ObservationConfidence');

const ROOT = path.resolve(__dirname, '..');

// --- Observation confidence state (persists across watchdog cycles) ---
const observationHysteresis = new ObservationHysteresis({
  consecutiveFailuresToConfirm: 2,  // need 2 consecutive confirmed failures to recover
  consecutiveSuccessesToReset: 1,
  maxHistoryPerComponent: 10,
});
const observationMetrics = new ObservationMetricsCollector();

// --- Self-health monitor instance ---
// Uses a lightweight SystemStateModel that only receives self-health events.
const selfStateModel = new SystemStateModel();
selfStateModel.registerComponent('heidi-self', 'system');
const selfHealthMonitor = new SelfHealthMonitor(ROOT, selfStateModel);
const LOG_DIR = path.resolve(ROOT, 'logs');
const LOG_FILE = path.resolve(LOG_DIR, 'watchdog.log');

// Health endpoints are derived from boot.config.json — not hard-coded.
// This ensures the watchdog always monitors the same modules that
// boot-agent starts.
function loadEndpointsFromBootConfig() {
  const configPath = path.resolve(ROOT, 'boot.config.json');
  if (!fs.existsSync(configPath)) {
    console.error('watchdog: boot.config.json not found');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const endpoints = [];
  for (const mod of config.modules || []) {
    if (!mod.enabled) continue;
    if (mod.type === 'process' && mod.health && mod.health.url) {
      endpoints.push({
        name: mod.id,
        url: mod.health.url,
        required: mod.required !== false,
        graceMs: mod.health.graceMs ?? config.defaultGraceMs,
      });
    }
  }
  return endpoints;
}
const { delegateTimeoutMs } = require('./delegate-timeout');
const ENDPOINTS = loadEndpointsFromBootConfig();

const INTERVAL_MS = parseInt(process.env.WATCHDOG_INTERVAL_MS || '30000', 10);
const WEBHOOK_URL = process.env.WATCHDOG_WEBHOOK_URL || '';
const ONCE = process.argv.includes('--once');

// HYDI_DELEGATE_RECOVERY: when true, watchdog calls RecoveryEngine to evaluate
// and potentially restart unhealthy components (the "alive but sick" case that
// boot-agent can't see). When false (default), watchdog is observe-only
// (log + webhook). See SUPERVISION_MODEL.md for the full supervision model.
const DELEGATE_RECOVERY = process.env.HYDI_DELEGATE_RECOVERY === 'true';

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(line) {
  const ts = new Date().toISOString();
  const entry = `${ts} ${line}`;
  console.log(entry);
  ensureLogDir();
  fs.appendFileSync(LOG_FILE, entry + '\n');
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
// Bug found 2026-09-12: protoforge-core crashed and stayed down for 9+ hours
// (272 consecutive real ECONNREFUSED polls) because checkEndpoint/checkOllama
// never fed their observations into classifyObservation/observationHysteresis
// -- only the Docker-based checks (supabase_db, supabase_rest) did that. Every
// endpoint result's `f._hysteresisState` was therefore always undefined,
// which the recovery gate below defaults to 'HEALTHY', so the
// "need FAILURE_CONFIRMED" branch fired on literally every poll forever and
// RecoveryEngine was never called, no matter how long the outage ran.
//
// classifyEndpointObservation() closes that gap, but deliberately does NOT
// reuse verdict.ok/observerFailure verbatim: those answer "should this be
// reported as ok in the endpoint's own state", and DEGRADED endpoints (e.g.
// heidi-web correctly reporting a real CRITICAL escalation -- see this
// session's earlier health-transport-contract work) are ok:false there on
// purpose. Recovery must not trigger for that case: the process is alive and
// truthfully reporting a real problem a restart cannot fix, and "recovering"
// it would be exactly the false-green-by-recovery this project has spent
// real effort eliminating elsewhere. Only UNAVAILABLE (unreachable, 5xx,
// 404 -- the process itself is not answering) is a target failure a process
// restart can plausibly address. UNKNOWN (unparseable body, no contract, an
// unverifiable auth response) is an observer failure, same as the Docker
// checks' own convention.
function classifyEndpointObservation(name, state) {
  const source = {
    name: `${name}-endpoint-check`,
    ok: state !== 'UNAVAILABLE',
    value: state,
    isObserverFailure: state === 'UNKNOWN',
    checkedAt: new Date().toISOString(),
  };
  const assessment = classifyObservation(name, [source]);
  observationMetrics.recordObservation(assessment);
  const hysteresisState = observationHysteresis.record(name, assessment);
  return { assessment, hysteresisState };
}

// Phase II: health is decided by the endpoint's declared contract, not by the
// status code. `ok: statusCode >= 200 && < 500` used to report HTTP 200 +
// {"status":"degraded"} as healthy, and would have reported a 404 as healthy
// too. See lib/operational/EndpointHealthContract.ts for the per-endpoint
// contracts and the full rationale.
function checkEndpoint(ep) {
  return new Promise((resolve) => {
    const url = new URL(ep.url);
    const lib = url.protocol === 'https:' ? https : http;

    const settle = (observation) => {
      const verdict = evaluateEndpointHealth(ep.name, observation);
      const { assessment, hysteresisState } = classifyEndpointObservation(ep.name, verdict.state);
      resolve({
        name: ep.name,
        url: ep.url,
        required: ep.required,
        ok: verdict.ok,
        statusCode: observation.statusCode,
        state: verdict.state,
        reason: verdict.reason,
        observerFailure: verdict.observerFailure,
        body: (observation.transportError || observation.bodyText || '').slice(0, 200),
        _assessment: assessment,
        _hysteresisState: hysteresisState,
      });
    };

    const req = lib.get(ep.url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        settle({ statusCode: res.statusCode, bodyText: body });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      settle({ statusCode: 0, bodyText: '', transportError: 'timeout' });
    });
    req.on('error', (e) => {
      settle({ statusCode: 0, bodyText: '', transportError: e.message });
    });
  });
}

// Service-level Supabase check: verify REST API responds through Kong gateway.
// This proves both DB connectivity (REST needs DB) and REST API functionality.
// Uses a helper script to avoid inline script escaping issues on Windows.
// Retries once to handle transient failures during container warm-up.
function checkSupabaseServiceLevel() {
  const { execSync } = require('child_process');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      execSync('node scripts/check-supabase-service.js', {
        encoding: 'utf8', timeout: 10000, stdio: 'pipe', cwd: ROOT, windowsHide: true,
      });
      return { ok: true };
    } catch (e) {
      if (attempt === 0) continue; // retry once
      const msg = e.message ? e.message.substring(0, 80) : 'check failed';
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: 'check failed' };
}

// Host-side Postgres data-plane probe.
// Live incident 2026-09-21: Docker Desktop's host port-forward for :54322
// died while the container stayed healthy — pg_isready inside the container
// passed, docker inspect said 'running', yet every host-side connection was
// terminated. The daemon's pg pool (heidi_events writer) starved silently for
// 13.5h. A bare TCP connect is INSUFFICIENT — the wedged forward still
// accepted sockets. The probe must prove Postgres answers the protocol:
// send an SSLRequest and require the 'S'/'N' response byte.
function checkPostgresHost() {
  const net = require('net');
  return new Promise((resolve) => {
    let settled = false;
    const sock = new net.Socket();
    const done = (ok, error) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch { /* already gone */ }
      resolve({ ok, error });
    };
    sock.setTimeout(5000);
    sock.once('timeout', () => done(false, 'pg probe timeout'));
    sock.once('error', (e) => done(false, (e && e.message) || 'connect error'));
    sock.connect(54322, '127.0.0.1', () => {
      // SSLRequest: int32 length=8, int32 code=80877103. Postgres replies
      // a single byte 'S' (SSL ok) or 'N' (no SSL). Any answer proves the
      // forward is forwarding protocol, not just accepting sockets.
      const buf = Buffer.alloc(8);
      buf.writeUInt32BE(8, 0);
      buf.writeUInt32BE(80877103, 4);
      sock.once('data', (d) => {
        const b = d.length > 0 ? d[0] : 0;
        done(b === 0x53 || b === 0x4e, b ? `pg reply '${String.fromCharCode(b)}'` : 'empty reply');
      });
      sock.write(buf);
    });
  });
}

// Phase 6: Infrastructure health checks with observation confidence
//
// KEY CHANGE: Service-level checks now run INDEPENDENTLY of docker inspect.
// If docker inspect fails but the REST API responds, the container is healthy
// and the observer (docker CLI) is broken. Recovery is NOT authorized.
async function checkInfrastructure() {
  const results = [];
  const { execSync } = require('child_process');

  // Docker CLI — use shared resolver for deterministic discovery
  const { getDockerCmd } = require('./resolve-docker');
  const DOCKER_CMD = getDockerCmd();

  // --- Supabase DB ---
  // Sole voting source: the host-side pg protocol probe (:54322). The
  // component's function is serving Postgres to host consumers (daemon pool,
  // migrations, verify scripts); a "running" container with a dead host
  // forward is DOWN — the 2026-09-21 wedge proved docker liveness and the
  // Kong-path REST probe both stayed green while :54322 was dead for 13.5h.
  // docker inspect is kept as corroborating evidence text only.
  let dbDockerStatus = 'unknown';
  if (DOCKER_CMD) {
    try {
      dbDockerStatus = execSync(`${DOCKER_CMD} inspect --format "{{.State.Status}}" supabase_db_HYDI-System-v2`, {
        encoding: 'utf8', timeout: 8000, stdio: 'pipe', windowsHide: true,
      }).trim();
    } catch {
      dbDockerStatus = 'docker inspect failed';
    }
  } else {
    dbDockerStatus = 'docker not available';
  }

  const dbSources = [];
  const pgCheck = await checkPostgresHost();
  dbSources.push({
    name: 'pg-host-probe',
    ok: pgCheck.ok,
    value: pgCheck.ok ? 'Postgres :54322 answering protocol' : `pg probe fail: ${pgCheck.error}`,
    isObserverFailure: false, // a dead data-plane is a target failure, not observer blindness
    checkedAt: new Date().toISOString(),
  });

  const dbAssessment = classifyObservation('supabase_db', dbSources);
  observationMetrics.recordObservation(dbAssessment);
  const dbHysteresisState = observationHysteresis.record('supabase_db', dbAssessment);

  const dbOk = dbAssessment.classification === 'OBSERVER_FAILURE' ? true : pgCheck.ok;

  results.push({
    name: 'supabase_db',
    url: 'docker://supabase_db_HYDI-System-v2',
    required: true,
    ok: dbOk,
    statusCode: dbOk ? 200 : 503,
    body: `${dbDockerStatus} + ${pgCheck.ok ? 'pg-ok' : 'pg-fail'} | ${dbAssessment.classification} (${dbAssessment.confidence}) hysteresis=${dbHysteresisState}`,
    _assessment: dbAssessment,
    _hysteresisState: dbHysteresisState,
  });

  // --- Supabase REST: gather independent observation sources ---
  const restSources = [];

  // Source 1: Docker container state
  let restDockerStatus = 'unknown';
  let restDockerOk = false;
  let restDockerObserverFailed = false;
  if (DOCKER_CMD) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = execSync(`${DOCKER_CMD} inspect --format "{{.State.Status}}" supabase_rest_HYDI-System-v2`, {
          encoding: 'utf8', timeout: 8000, stdio: 'pipe', windowsHide: true,
        });
        restDockerStatus = out.trim();
        restDockerOk = restDockerStatus === 'running';
        break;
      } catch (e) {
        if (attempt === 0) { continue; }
        restDockerStatus = 'docker inspect failed';
        restDockerObserverFailed = true;
      }
    }
  } else {
    restDockerStatus = 'docker not available';
    restDockerObserverFailed = true;
  }
  restSources.push({
    name: 'docker-inspect',
    ok: restDockerOk,
    value: restDockerStatus,
    isObserverFailure: restDockerObserverFailed,
    checkedAt: new Date().toISOString(),
  });

  // Source 2: Service-level REST API probe (independent)
  const restSvcCheck = checkSupabaseServiceLevel();
  restSources.push({
    name: 'rest-probe',
    ok: restSvcCheck.ok,
    value: restSvcCheck.ok ? 'REST API responding' : `REST API fail: ${restSvcCheck.error}`,
    isObserverFailure: false,
    checkedAt: new Date().toISOString(),
  });

  // Classify
  const restAssessment = classifyObservation('supabase_rest', restSources);
  observationMetrics.recordObservation(restAssessment);
  const restHysteresisState = observationHysteresis.record('supabase_rest', restAssessment);

  const restOk = restAssessment.classification === 'OBSERVER_FAILURE'
    ? true
    : restAssessment.recoveryAuthorized
      ? false
      : restSources.some((s) => s.ok);

  results.push({
    name: 'supabase_rest',
    url: 'docker://supabase_rest_HYDI-System-v2',
    required: true,
    ok: restOk,
    statusCode: restOk ? 200 : 503,
    body: `${restDockerStatus} + ${restSvcCheck.ok ? 'service-ok' : 'service-fail'} | ${restAssessment.classification} (${restAssessment.confidence}) hysteresis=${restHysteresisState}`,
    _assessment: restAssessment,
    _hysteresisState: restHysteresisState,
  });

  // --- Supabase Kong gateway ---
  // Live incident 2026-09-21: Kong wedged (listening on :54321 but not
  // completing HTTP) while every docker inspect reported 'running'. The
  // failure dissolved into supabase_db's multi-source 'any source ok' rule —
  // no component owned the gateway, so nothing ever delegated its restart
  // and protoforge-core recovery deadlocked on the 'database' dependency.
  // For Kong the service-level probe IS the component's function: a running
  // container that cannot serve REST is DOWN, not corroborated-healthy.
  const kongSources = [];

  // Source 1: Docker container state (corroborating evidence only)
  let kongDockerStatus = 'unknown';
  let kongDockerObserverFailed = false;
  if (DOCKER_CMD) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = execSync(`${DOCKER_CMD} inspect --format "{{.State.Status}}" supabase_kong_HYDI-System-v2`, {
          encoding: 'utf8', timeout: 8000, stdio: 'pipe', windowsHide: true,
        });
        kongDockerStatus = out.trim();
        break;
      } catch (e) {
        if (attempt === 0) continue;
        kongDockerStatus = 'docker inspect failed';
        kongDockerObserverFailed = true;
      }
    }
  } else {
    kongDockerStatus = 'docker not available';
    kongDockerObserverFailed = true;
  }
  // Source: REST probe through the gateway — the ONLY voting source.
  // For Kong, "container running" is liveness evidence, not service
  // evidence: including docker-inspect as an ok-source would classify a
  // wedged-but-running gateway as OBSERVATION_UNCERTAIN (conflicting
  // evidence) and silently mask exactly the failure this check exists to
  // catch. Docker status is retained in the result body for diagnostics.
  const kongSvcCheck = checkSupabaseServiceLevel();
  kongSources.push({
    name: 'rest-probe',
    ok: kongSvcCheck.ok,
    value: kongSvcCheck.ok ? 'Kong REST responding' : `Kong REST fail: ${kongSvcCheck.error}`,
    isObserverFailure: false,
    checkedAt: new Date().toISOString(),
  });

  const kongAssessment = classifyObservation('supabase_kong', kongSources);
  observationMetrics.recordObservation(kongAssessment);
  const kongHysteresisState = observationHysteresis.record('supabase_kong', kongAssessment);

  // The probe IS the measured layer: if REST through Kong fails, the gateway
  // is down regardless of container state (wedged or exited — restart_container
  // is the remedy for both). docker-inspect remains as corroborating evidence
  // in the assessment, but cannot mask a failed data-plane probe.
  const kongOk = kongSvcCheck.ok;

  results.push({
    name: 'supabase_kong',
    url: 'http://127.0.0.1:54321/rest/v1/',
    required: true,
    ok: kongOk,
    statusCode: kongOk ? 200 : 503,
    body: `${kongDockerStatus} + ${kongSvcCheck.ok ? 'gateway-ok' : 'gateway-fail'} | ${kongAssessment.classification} (${kongAssessment.confidence}) hysteresis=${kongHysteresisState}`,
    graceMs: 60000,
    _assessment: kongAssessment,
    _hysteresisState: kongHysteresisState,
  });

  // Check Ollama
  results.push({
    name: 'ollama',
    url: 'http://127.0.0.1:11434/api/tags',
    required: false,
    _checkOllama: true,
  });

  return results;
}

// Check Ollama health endpoint.
// Phase II: this carried the same status-code-only predicate as checkEndpoint,
// so a reachable Ollama serving zero models scored as healthy. It now goes
// through the same contract evaluator.
const OLLAMA_URL = 'http://127.0.0.1:11434/api/tags';
function checkOllama() {
  return new Promise((resolve) => {
    const settle = (observation) => {
      const verdict = evaluateEndpointHealth('ollama', observation);
      const { assessment, hysteresisState } = classifyEndpointObservation('ollama', verdict.state);
      resolve({
        name: 'ollama',
        url: OLLAMA_URL,
        required: false,
        ok: verdict.ok,
        statusCode: observation.statusCode,
        state: verdict.state,
        reason: verdict.reason,
        observerFailure: verdict.observerFailure,
        body: (observation.transportError || observation.bodyText || '').slice(0, 200),
        _assessment: assessment,
        _hysteresisState: hysteresisState,
      });
    };

    const req = http.get(OLLAMA_URL, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        settle({ statusCode: res.statusCode, bodyText: body });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      settle({ statusCode: 0, bodyText: '', transportError: 'timeout' });
    });
    req.on('error', (e) => {
      settle({ statusCode: 0, bodyText: '', transportError: e.message });
    });
  });
}

// ---------------------------------------------------------------------------
// Webhook alert
// ---------------------------------------------------------------------------
function sendWebhook(failures) {
  if (!WEBHOOK_URL) return;
  const payload = JSON.stringify({
    text: `HYDI Watchdog: ${failures.length} endpoint(s) down`,
    failures: failures.map((f) => ({ name: f.name, url: f.url, status: f.statusCode, error: f.body })),
    timestamp: new Date().toISOString(),
  });
  const url = new URL(WEBHOOK_URL);
  const lib = url.protocol === 'https:' ? https : http;
  const req = lib.request(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    timeout: 10000,
  }, (res) => { res.resume(); });
  req.on('error', () => { /* swallow — webhook is best-effort */ });
  req.on('timeout', () => { req.destroy(); });
  req.write(payload);
  req.end();
}

// ---------------------------------------------------------------------------
// Phase 6: Observation event recording (durable evidence)
// ---------------------------------------------------------------------------
const OPS_DIR = path.resolve(ROOT, '.hydi-operational');
function recordObservationEvent(component, assessment, hysteresisState, recoveryDispatched) {
  try {
    if (!fs.existsSync(OPS_DIR)) fs.mkdirSync(OPS_DIR, { recursive: true });
    const event = {
      timestamp: new Date().toISOString(),
      component,
      classification: assessment?.classification || 'UNKNOWN',
      confidence: assessment?.confidence || 'NONE',
      hysteresisState,
      recoveryDispatched,
      reason: assessment?.reason || '',
      sources: assessment?.sources?.map((s) => ({ name: s.name, ok: s.ok, value: s.value, isObserverFailure: s.isObserverFailure })) || [],
    };
    const file = path.resolve(OPS_DIR, 'observation-events.jsonl');
    fs.appendFileSync(file, JSON.stringify(event) + '\n');
  } catch { /* best-effort — don't block watchdog */ }
}

function logObservationMetrics() {
  const m = observationMetrics.getMetrics();
  log(`METRICS observations=${m.totalObservations} observerFailures=${m.observerFailures} uncertain=${m.uncertainObservations} confirmed=${m.confirmedFailures} falseRecoveriesPrevented=${m.falseRecoveriesPrevented} recoveryAttempts=${m.recoveryAttempts} successful=${m.successfulRecoveries} failed=${m.failedRecoveries} escalations=${m.escalations} exhaustions=${m.recoveryExhaustions} retries=${m.retryCount} verificationFailures=${m.verificationFailures} dependencyBlocked=${m.dependencyBlockedRecoveries} observerBlocked=${m.observerBlockedRecoveries} duplicatePrevented=${m.duplicateRecoveriesPrevented} intelligentStops=${m.intelligentStops}`);
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------
async function runCheck() {
  // Check boot.config.json endpoints
  const endpointResults = await Promise.all(ENDPOINTS.map(checkEndpoint));

  // Phase 5: Check infrastructure (Docker containers, Ollama)
  const infraResults = (await checkInfrastructure()).filter((r) => !r._checkOllama);
  const ollamaResult = await checkOllama();
  infraResults.push(ollamaResult);

  const allResults = [...endpointResults, ...infraResults];
  const failures = allResults.filter((r) => !r.ok);
  const allOk = failures.length === 0;

  if (allOk) {
    // Phase II: log the verdict state, not the raw status code. "heidi-web:200"
    // was the shape that let a degraded service read as healthy at a glance.
    const names = allResults.map((r) => `${r.name}:${r.state || r.statusCode}`).join('  ');
    log(`OK    all ${allResults.length} endpoints healthy  ${names}`);
  } else {
    for (const f of failures) {
      const state = f.state ? `state=${f.state}  ` : '';
      const reason = f.reason ? `  reason=${f.reason}` : '';
      log(`FAIL  ${f.name}  ${f.url}  ${state}status=${f.statusCode}  error=${f.body}${reason}`);
    }
    const okNames = allResults.filter((r) => r.ok).map((r) => r.name).join(',');
    log(`ALERT ${failures.length}/${allResults.length} endpoints down (ok: ${okNames || 'none'})`);
    sendWebhook(failures);

    // If DELEGATE_RECOVERY is enabled, call RecoveryEngine for each REQUIRED
    // failure. Optional components are observe-only — RecoveryEngine's policy
    // for optional components is 'no_action', so calling it would just loop
    // 3 times doing nothing and then escalate, producing misleading logs.
    // See SUPERVISION_MODEL.md for the full supervision model.
    //
    // Phase 6: Recovery is now gated by observation confidence and hysteresis.
    // A single failed observation does NOT trigger recovery when:
    //   - The failure classification is OBSERVER_FAILURE (observer broke, not target)
    //   - The failure classification is OBSERVATION_UNCERTAIN (insufficient evidence)
    //   - The hysteresis state is not FAILURE_CONFIRMED (need consecutive failures)
    //
    // Recovery is dispatched in PARALLEL so a stuck/slow recovery on one
    // component does not block detection and recovery of others. Each
    // recovery has its own 120s timeout.
    if (DELEGATE_RECOVERY) {
      const { exec } = require('child_process');
      const root = path.resolve(__dirname, '..');
      const recoveryPromises = [];
      for (const f of failures) {
        if (!f.required) {
          log(`OBSERVE  ${f.name} is optional — logging only, not calling RecoveryEngine`);
          continue;
        }

        // Phase II: an endpoint verdict of UNKNOWN means we failed to obtain
        // evidence (unparseable body, undeclared contract, auth rejection) --
        // not that the target is broken. Recovering on that would be acting on
        // our own blindness. Same principle as the OBSERVER_FAILURE gate below,
        // applied to the HTTP endpoint path.
        if (f.observerFailure) {
          log(`OBSERVE  ${f.name} state=${f.state} is an observer failure -- recovery NOT authorized. ${f.reason}`);
          observationMetrics.recordEscalation();
          continue;
        }

        // Phase 6: Gate recovery on observation confidence
        const assessment = f._assessment;
        const hystState = f._hysteresisState || 'HEALTHY';

        if (assessment && !assessment.recoveryAuthorized) {
          // Observer failure or uncertain — do NOT recover
          log(`OBSERVE  ${f.name} failure classified as ${assessment.classification} (${assessment.confidence}) — recovery NOT authorized. ${assessment.reason}`);
          observationMetrics.recordEscalation();
          // Record the prevented false recovery
          recordObservationEvent(f.name, assessment, hystState, false);
          continue;
        }

        if (hystState !== 'FAILURE_CONFIRMED' && hystState !== 'FAILURE_SUSPECTED') {
          log(`OBSERVE  ${f.name} hysteresis state=${hystState} — need FAILURE_CONFIRMED before recovery. Waiting for corroboration.`);
          continue;
        }

        if (hystState === 'FAILURE_SUSPECTED') {
          log(`OBSERVE  ${f.name} failure suspected but not yet confirmed (hysteresis=FAILURE_SUSPECTED) — waiting for consecutive failure.`);
          continue;
        }

        log(`DELEGATE  calling RecoveryEngine for ${f.name} (hysteresis=FAILURE_CONFIRMED, classification=${assessment?.classification || 'N/A'})`);
        observationHysteresis.markRecovering(f.name);
        recordObservationEvent(f.name, assessment, hystState, true);
        recoveryPromises.push(new Promise((resolve) => {
          const child = exec(
            `node scripts/hydi-recover.js --governed --component=${f.name}`,
            { cwd: root, timeout: delegateTimeoutMs(f), stdio: 'pipe', windowsHide: true },
            (err, stdout, stderr) => {
              // hydi-recover.js prints its governedRecover() result (the exact
              // decision/denial reason) to stdout via console.log — previously
              // discarded here, leaving `err.message`'s generic "Command
              // failed: <cmd>" wrapper as the only visible detail on failure.
              const out = (stdout || '').trim();
              const errOut = (stderr || '').trim();
              if (err) {
                log(`DELEGATE  RecoveryEngine failed for ${f.name}: ${err.message}`);
                if (out) log(`DELEGATE  ${f.name} stdout: ${out.slice(0, 2000)}`);
                if (errOut) log(`DELEGATE  ${f.name} stderr: ${errOut.slice(0, 2000)}`);
                observationHysteresis.markRecovered(f.name, false);
                observationMetrics.recordRecoveryAttempt(false);
              } else {
                log(`DELEGATE  RecoveryEngine completed for ${f.name}`);
                if (out) log(`DELEGATE  ${f.name} stdout: ${out.slice(0, 2000)}`);
                observationHysteresis.markRecovered(f.name, true);
                observationMetrics.recordRecoveryAttempt(true);
              }
              resolve();
            }
          );
          // Don't let the child keep the watchdog alive
          child.unref();
        }));
      }
      await Promise.all(recoveryPromises);
    }
  }

  // Record that this observation cycle completed (feeds SelfHealthMonitor)
  selfHealthMonitor.recordObservationCycle();

  // Run self-health check every 5th cycle (every ~2.5 min at 30s interval)
  // to detect memory growth, stuck recoveries, or persistence failures.
  if (selfCheckCounter % 5 === 0) {
    const selfHealth = selfHealthMonitor.check();
    if (selfHealth.state !== 'HEALTHY') {
      log(`SELF-HEALTH ${selfHealth.state} — mem=${selfHealth.memoryUsageMb}MB, stuckRecoveries=${selfHealth.stuckRecoveries}, persistenceWritable=${selfHealth.persistenceWritable}${selfHealth.degradedReason ? ', reason=' + selfHealth.degradedReason : ''}`);
    }
    // Phase 6: Log observation metrics every 5th cycle
    logObservationMetrics();
  }
  selfCheckCounter++;

  return allOk;
}

let selfCheckCounter = 0;

async function main() {
  log(`watchdog started (mode=${ONCE ? 'once' : 'continuous'}, interval=${INTERVAL_MS}ms, webhook=${WEBHOOK_URL ? 'on' : 'off'})`);

  if (ONCE) {
    const ok = await runCheck();
    process.exit(ok ? 0 : 1);
  }

  // Continuous mode
  await runCheck();
  setInterval(runCheck, INTERVAL_MS);

  // Keep the process alive
  process.on('SIGINT', () => { log('watchdog stopped'); process.exit(0); });
  process.on('SIGTERM', () => { log('watchdog stopped'); process.exit(0); });
}

// Guarded so `require('./watchdog')` (used by tests to reach
// classifyEndpointObservation/checkEndpoint/checkOllama in isolation) never
// auto-executes the live monitoring loop -- mirrors the identical guard
// added to scripts/boot-agent.js earlier in this project's history for the
// same reason: requiring this file unconditionally ran real HTTP checks,
// real Docker calls, and real log writes.
module.exports = { classifyEndpointObservation, checkEndpoint, checkOllama };

if (require.main === module) {
  main().catch((e) => {
    log(`watchdog error: ${e.message}`);
    process.exit(1);
  });
}
