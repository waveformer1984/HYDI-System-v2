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
      });
    }
  }
  return endpoints;
}
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
function checkEndpoint(ep) {
  return new Promise((resolve) => {
    const url = new URL(ep.url);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(ep.url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          name: ep.name,
          url: ep.url,
          required: ep.required,
          ok: res.statusCode >= 200 && res.statusCode < 500,
          statusCode: res.statusCode,
          body: body.slice(0, 200),
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ name: ep.name, url: ep.url, required: ep.required, ok: false, statusCode: 0, body: 'timeout' });
    });
    req.on('error', (e) => {
      resolve({ name: ep.name, url: ep.url, required: ep.required, ok: false, statusCode: 0, body: e.message });
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

// Phase 6: Infrastructure health checks with observation confidence
//
// KEY CHANGE: Service-level checks now run INDEPENDENTLY of docker inspect.
// If docker inspect fails but the REST API responds, the container is healthy
// and the observer (docker CLI) is broken. Recovery is NOT authorized.
function checkInfrastructure() {
  const results = [];
  const { execSync } = require('child_process');

  // Docker CLI — use shared resolver for deterministic discovery
  const { getDockerCmd } = require('./resolve-docker');
  const DOCKER_CMD = getDockerCmd();

  // --- Supabase DB: gather independent observation sources ---
  const dbSources = [];

  // Source 1: Docker container state (observer — can fail independently)
  let dbDockerStatus = 'unknown';
  let dbDockerOk = false;
  let dbDockerObserverFailed = false;
  if (DOCKER_CMD) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = execSync(`${DOCKER_CMD} inspect --format "{{.State.Status}}" supabase_db_HYDI-System-v2`, {
          encoding: 'utf8', timeout: 8000, stdio: 'pipe', windowsHide: true,
        });
        dbDockerStatus = out.trim();
        dbDockerOk = dbDockerStatus === 'running';
        break;
      } catch (e) {
        if (attempt === 0) continue;
        dbDockerStatus = 'docker inspect failed';
        dbDockerObserverFailed = true; // observer failure, not target failure
      }
    }
  } else {
    dbDockerStatus = 'docker not available';
    dbDockerObserverFailed = true;
  }
  dbSources.push({
    name: 'docker-inspect',
    ok: dbDockerOk,
    value: dbDockerStatus,
    isObserverFailure: dbDockerObserverFailed,
    checkedAt: new Date().toISOString(),
  });

  // Source 2: Service-level REST API probe (independent of docker inspect)
  const dbSvcCheck = checkSupabaseServiceLevel();
  dbSources.push({
    name: 'rest-probe',
    ok: dbSvcCheck.ok,
    value: dbSvcCheck.ok ? 'REST API responding' : `REST API fail: ${dbSvcCheck.error}`,
    isObserverFailure: false, // this is a real target check
    checkedAt: new Date().toISOString(),
  });

  // Classify the observation
  const dbAssessment = classifyObservation('supabase_db', dbSources);
  observationMetrics.recordObservation(dbAssessment);
  const dbHysteresisState = observationHysteresis.record('supabase_db', dbAssessment);

  // Determine final ok state: target is healthy if ANY independent source confirms it
  // AND the failure classification is not CONFIRMED_FAILURE
  const dbOk = dbAssessment.classification === 'OBSERVER_FAILURE'
    ? true // observer failed but service is healthy — do NOT report as down
    : dbAssessment.recoveryAuthorized
      ? false // confirmed failure
      : dbSources.some((s) => s.ok); // at least one source says ok

  results.push({
    name: 'supabase_db',
    url: 'docker://supabase_db_HYDI-System-v2',
    required: true,
    ok: dbOk,
    statusCode: dbOk ? 200 : 503,
    body: `${dbDockerStatus} + ${dbSvcCheck.ok ? 'service-ok' : 'service-fail'} | ${dbAssessment.classification} (${dbAssessment.confidence}) hysteresis=${dbHysteresisState}`,
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

  // Check Ollama
  results.push({
    name: 'ollama',
    url: 'http://127.0.0.1:11434/api/tags',
    required: false,
    _checkOllama: true,
  });

  return results;
}

// Check Ollama health endpoint
function checkOllama() {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:11434/api/tags', { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          name: 'ollama',
          url: 'http://127.0.0.1:11434/api/tags',
          required: false,
          ok: res.statusCode >= 200 && res.statusCode < 500,
          statusCode: res.statusCode,
          body: body.slice(0, 200),
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({
        name: 'ollama', url: 'http://127.0.0.1:11434/api/tags', required: false,
        ok: false, statusCode: 0, body: 'timeout',
      });
    });
    req.on('error', (e) => {
      resolve({
        name: 'ollama', url: 'http://127.0.0.1:11434/api/tags', required: false,
        ok: false, statusCode: 0, body: e.message,
      });
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
  log(`METRICS observations=${m.totalObservations} observerFailures=${m.observerFailures} uncertain=${m.uncertainObservations} confirmed=${m.confirmedFailures} falseRecoveriesPrevented=${m.falseRecoveriesPrevented} recoveryAttempts=${m.recoveryAttempts} successful=${m.successfulRecoveries} failed=${m.failedRecoveries} escalations=${m.escalations}`);
}

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------
async function runCheck() {
  // Check boot.config.json endpoints
  const endpointResults = await Promise.all(ENDPOINTS.map(checkEndpoint));

  // Phase 5: Check infrastructure (Docker containers, Ollama)
  const infraResults = checkInfrastructure().filter((r) => !r._checkOllama);
  const ollamaResult = await checkOllama();
  infraResults.push(ollamaResult);

  const allResults = [...endpointResults, ...infraResults];
  const failures = allResults.filter((r) => !r.ok);
  const allOk = failures.length === 0;

  if (allOk) {
    const names = allResults.map((r) => `${r.name}:${r.statusCode}`).join('  ');
    log(`OK    all ${allResults.length} endpoints healthy  ${names}`);
  } else {
    for (const f of failures) {
      log(`FAIL  ${f.name}  ${f.url}  status=${f.statusCode}  error=${f.body}`);
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
            { cwd: root, timeout: 120000, stdio: 'pipe', windowsHide: true },
            (err) => {
              if (err) {
                log(`DELEGATE  RecoveryEngine failed for ${f.name}: ${err.message}`);
                observationHysteresis.markRecovered(f.name, false);
                observationMetrics.recordRecoveryAttempt(false);
              } else {
                log(`DELEGATE  RecoveryEngine completed for ${f.name}`);
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

main().catch((e) => {
  log(`watchdog error: ${e.message}`);
  process.exit(1);
});
