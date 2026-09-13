#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

/**
 * `hydi doctor` — comprehensive local diagnostic command.
 *
 * Answers:
 *   - Is HEIDI alive?
 *   - Is the runtime healthy?
 *   - Are required ports available?
 *   - Are expected processes running?
 *   - Are required containers running?
 *   - Is local persistence available?
 *   - Is Ollama available?
 *   - Are bridges healthy?
 *   - Are configuration invariants satisfied?
 *   - Are required directories writable?
 *   - Is the recovery engine functional?
 *   - Is the audit journal writable?
 *   - Are there unresolved incidents?
 *   - Is the system safe to operate?
 *
 * Identifies actionable failures rather than merely printing "ERROR".
 *
 * Usage:
 *   node scripts/hydi-doctor.js
 *   node scripts/hydi-doctor.js --json
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const JSON_MODE = process.argv.includes('--json');

function check(label, fn) {
  try {
    const result = fn();
    return { label, status: 'pass', detail: result, actionable: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { label, status: 'fail', detail: msg, actionable: e.actionable || msg };
  }
}

function checkAsync(label, fn) {
  return fn().then(
    (result) => ({ label, status: 'pass', detail: result, actionable: null }),
    (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      return { label, status: 'fail', detail: msg, actionable: e.actionable || msg };
    },
  );
}

function getHealthEndpoint(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 500) {
          resolve({ statusCode: res.statusCode, body });
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', (e) => reject(e));
  });
}

function findPidOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000, windowsHide: true });
      for (const line of out.split('\n')) {
        if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(pid)) return pid;
      }
    } else {
      const out = execSync(`lsof -ti :${port}`, { encoding: 'utf8', timeout: 5000, windowsHide: true });
      const pid = parseInt(out.trim(), 10);
      if (!isNaN(pid)) return pid;
    }
  } catch { /* no process */ }
  return null;
}

async function runDoctor() {
  const results = [];

  // 1. Is HEIDI alive? (check if boot-agent or PM2 is running)
  results.push(check('HEIDI process alive', () => {
    try {
      const out = execSync('pm2 list', { encoding: 'utf8', timeout: 10000, windowsHide: true });
      if (out.includes('hydi-boot') && out.includes('online')) {
        return 'PM2 hydi-boot is online';
      }
      const err = new Error('PM2 hydi-boot is not online');
      err.actionable = 'Run: pm2 start ecosystem.config.js';
      throw err;
    } catch (e) {
      // PM2 might not be running — check if processes are on ports directly
      const corePid = findPidOnPort(3005);
      if (corePid) return `protoforge-core running (PID ${corePid}) — PM2 not detected`;
      const err = new Error('No HEIDI process detected');
      err.actionable = 'Run: npm run boot  OR  pm2 start ecosystem.config.js';
      throw err;
    }
  }));

  // 2. ProtoForge core health
  results.push(await checkAsync('ProtoForge core (port 3005)', async () => {
    const h = await getHealthEndpoint('http://127.0.0.1:3005/health');
    return `HTTP ${h.statusCode}: ${h.body}`;
  }));

  // 3. Heidi Web health
  results.push(await checkAsync('Heidi Web (port 3000)', async () => {
    const h = await getHealthEndpoint('http://127.0.0.1:3000/api/health');
    let parsed;
    try { parsed = JSON.parse(h.body); } catch { parsed = {}; }
    if (parsed.status === 'degraded') {
      return `HTTP ${h.statusCode} — application-level degraded (expected without full Supabase history)`;
    }
    return `HTTP ${h.statusCode}: ${h.body.slice(0, 100)}`;
  }));

  // 4. Heidi Mobile Chat health
  results.push(await checkAsync('Heidi Mobile Chat (port 3006)', async () => {
    const h = await getHealthEndpoint('http://127.0.0.1:3006/api/health');
    return `HTTP ${h.statusCode}: ${h.body.slice(0, 100)}`;
  }));

  // 5. Ollama availability
  results.push(await checkAsync('Ollama local AI (port 11434)', async () => {
    const h = await getHealthEndpoint('http://127.0.0.1:11434/api/tags');
    let parsed;
    try { parsed = JSON.parse(h.body); } catch { parsed = { models: [] }; }
    const modelCount = parsed.models ? parsed.models.length : 0;
    if (modelCount === 0) {
      const w = new Error('Ollama running but no models installed');
      w.actionable = 'Run: ollama pull llama3.2';
      throw w;
    }
    return `${modelCount} models available (e.g. ${parsed.models[0]?.name})`;
  }));

  // 6. Docker containers — use shared resolver for deterministic discovery
  const { resolveDocker } = require('./resolve-docker');
  const dockerInfo = resolveDocker({ timeoutMs: 8000 });

  results.push(check('Docker daemon', () => {
    if (dockerInfo.status === 'unavailable') {
      const e = new Error('Docker CLI not found in PATH or common install locations');
      e.actionable = 'Install Docker Desktop or add docker.exe to PATH';
      throw e;
    }
    if (dockerInfo.status === 'cli_only') {
      const e = new Error(`Docker CLI found at ${dockerInfo.path} but daemon not responding`);
      e.actionable = 'Start Docker Desktop';
      throw e;
    }
    return `Docker daemon responding (via ${dockerInfo.path})`;
  }));

  const DOCKER_CMD = dockerInfo.cmd;

  results.push(check('Supabase DB container', () => {
    if (!DOCKER_CMD) {
      const e = new Error('Docker not available');
      e.actionable = 'Start Docker Desktop';
      throw e;
    }
    try {
      const out = execSync(`${DOCKER_CMD} inspect --format "{{.State.Health.Status}}" supabase_db_HYDI-System-v2`, {
        encoding: 'utf8', timeout: 8000, windowsHide: true,
      });
      const status = out.trim();
      if (status !== 'healthy') {
        const e = new Error(`DB container status: ${status}`);
        e.actionable = 'Run: docker restart supabase_db_HYDI-System-v2';
        throw e;
      }
      return 'healthy';
    } catch (e) {
      const err = new Error('DB container not accessible');
      err.actionable = 'Run: npx supabase start  OR  docker restart supabase_db_HYDI-System-v2';
      throw err;
    }
  }));

  // 7. Local persistence (operational event journal)
  results.push(check('Operational event journal writable', () => {
    const dir = path.resolve(ROOT, '.hydi-operational');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const testFile = path.join(dir, '.write-test');
    fs.writeFileSync(testFile, String(Date.now()), 'utf8');
    fs.unlinkSync(testFile);
    return `${dir} is writable`;
  }));

  // 8. Policy decision record store
  results.push(check('Policy decision records writable', () => {
    const file = path.resolve(ROOT, '.hydi-operational', 'policy-decisions.jsonl');
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Check if we can append
    fs.appendFileSync(file, '', 'utf8');
    return `${file} is appendable`;
  }));

  // 9. Required directories writable
  for (const dir of ['logs', 'data', '.hydi-operational']) {
    results.push(check(`Directory writable: ${dir}`, () => {
      const full = path.resolve(ROOT, dir);
      if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
      const testFile = path.join(full, '.write-test');
      fs.writeFileSync(testFile, '1', 'utf8');
      fs.unlinkSync(testFile);
      return 'writable';
    }));
  }

  // 10. Git repository identity
  results.push(check('Git repository identity', () => {
    const out = execSync('git remote -v', { cwd: ROOT, encoding: 'utf8', timeout: 5000, windowsHide: true });
    if (!out.includes('HYDI-System-v2')) {
      throw new Error('Not in HYDI-System-v2 repository');
    }
    const branch = execSync('git branch --show-current', { cwd: ROOT, encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
    return `branch: ${branch}`;
  }));

  // 11. Boot config exists and is valid
  results.push(check('Boot config valid', () => {
    const configPath = path.resolve(ROOT, 'boot.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const modules = (config.modules || []).filter((m) => m.enabled);
    return `${modules.length} enabled modules`;
  }));

  // 12. Recovery engine functional (check if hydi-recover runs)
  results.push(await checkAsync('Recovery engine functional', async () => {
    try {
      const out = execSync('node scripts/hydi-recover.js --dry-run', {
        cwd: ROOT, timeout: 30000, encoding: 'utf8', stdio: 'pipe', windowsHide: true,
      });
      return 'dry-run succeeded';
    } catch (e) {
      // Exit code 1 with "HEALTHY" or "no actions" is normal — all components healthy
      const out = e.stdout || e.stderr || '';
      if (out.includes('HEALTHY') || out.includes('no actions')) {
        return 'dry-run completed (all healthy, no actions needed)';
      }
      const err = new Error('Recovery engine dry-run failed');
      err.actionable = 'Check lib/operational/RecoveryEngine.ts for errors';
      throw err;
    }
  }));

  // 13. Unresolved incidents (only count recent — last 24h)
  // Phase 7 Fix: Check for incident_resolved events that cancel out
  // recovery_failed/escalation_triggered events. An incident that was
  // resolved (manually or by a subsequent successful recovery) should
  // NOT be counted as unresolved.
  results.push(check('Unresolved incidents', () => {
    const eventsFile = path.resolve(ROOT, '.hydi-operational', 'operational-events.jsonl');
    if (!fs.existsSync(eventsFile)) return 'no event log yet (clean)';
    const events = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean);
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    // Track resolved incidents by correlationId
    const resolvedCorrelationIds = new Set();
    const unresolvedEvents = [];

    // First pass: collect all resolved correlation IDs
    for (const line of events) {
      try {
        const evt = JSON.parse(line);
        if (evt.type === 'incident_resolved' || evt.type === 'recovery_completed') {
          if (evt.actionResult === 'success' && evt.correlationId) {
            resolvedCorrelationIds.add(evt.correlationId);
          }
        }
      } catch { /* skip malformed */ }
    }

    // Second pass: count unresolved failure/escalation events
    // that have NOT been resolved
    for (const line of events) {
      try {
        const evt = JSON.parse(line);
        if (evt.type === 'recovery_failed' || evt.type === 'escalation_triggered') {
          const evtTime = new Date(evt.timestamp).getTime();
          if (evtTime > oneDayAgo) {
            // Check if this incident was resolved
            const correlationId = evt.correlationId;
            if (correlationId && resolvedCorrelationIds.has(correlationId)) {
              continue; // resolved — don't count
            }
            unresolvedEvents.push(evt);
          }
        }
      } catch { /* skip malformed */ }
    }

    if (unresolvedEvents.length > 0) {
      const e = new Error(`${unresolvedEvents.length} unresolved failure/escalation events (last 24h)`);
      e.actionable = 'Run: node scripts/hydi-recover.js --governed  to attempt recovery';
      throw e;
    }
    return 'no unresolved incidents (last 24h)';
  }));

  // 14. Stripe key safety check
  results.push(check('Stripe key safety', () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return 'STRIPE_SECRET_KEY not set — Stripe disabled (safe)';
    if (key.startsWith('sk_live_')) {
      const e = new Error('LIVE Stripe key detected in environment');
      e.actionable = 'Remove the live key and use sk_test_ for development. Rotate the live key in Stripe Dashboard.';
      throw e;
    }
    if (key.startsWith('sk_test_')) return 'test key in use (safe)';
    return `unknown key format (prefix: ${key.slice(0, 7)})`;
  }));

  // 15. System safe to operate
  const failures = results.filter((r) => r.status === 'fail');
  results.push({
    label: 'System safe to operate',
    status: failures.length === 0 ? 'pass' : 'fail',
    detail: failures.length === 0
      ? 'all checks passed'
      : `${failures.length} check(s) failed`,
    actionable: failures.length === 0
      ? null
      : failures.map((f) => `  - ${f.label}: ${f.actionable}`).join('\n'),
  });

  // Output
  const totalPassed = results.filter((r) => r.status === 'pass').length;
  const totalFailed = results.filter((r) => r.status === 'fail').length;

  if (JSON_MODE) {
    const output = {
      timestamp: new Date().toISOString(),
      checks: results,
      summary: {
        total: results.length,
        passed: totalPassed,
        failed: totalFailed,
        safeToOperate: totalFailed === 0,
      },
    };
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log('\n=== HEIDI DOCTOR ===\n');
    for (const r of results) {
      const icon = r.status === 'pass' ? '[OK]' : '[FAIL]';
      console.log(`  ${icon} ${r.label}: ${r.detail}`);
      if (r.status === 'fail' && r.actionable) {
        console.log(`         → Action: ${r.actionable}`);
      }
    }
    console.log(`\n  ${totalPassed} passed, ${totalFailed} failed`);
    console.log(`  Verdict: ${totalFailed === 0 ? 'SAFE TO OPERATE' : 'ISSUES DETECTED — see actionable items above'}\n`);
  }

  process.exit(totalFailed === 0 ? 0 : 1);
}

runDoctor().catch((e) => {
  console.error('Doctor failed:', e.message);
  process.exit(2);
});
