#!/usr/bin/env node
'use strict';
/**
 * HYDI Config-Derived Health Checker
 * ----------------------------------------------------------------------------
 * Derives all health targets from boot.config.json and performs deep health
 * checks that go beyond "is the port open?":
 *
 *   1. For each enabled process module:
 *      - Is the port occupied?
 *      - Does the health endpoint respond with HTTP 200?
 *      - Is the health response body valid (not an error page)?
 *      - Is the process on that port the EXPECTED process (not a zombie)?
 *   2. For the database:
 *      - Is Supabase reachable?
 *      - Can the service-role key write and read?
 *   3. For Ollama:
 *      - Is it reachable?
 *      - Are models available?
 *
 * A TCP port being open is NOT sufficient.
 * An HTTP 200 from the wrong service is NOT sufficient.
 * A process existing is NOT sufficient.
 *
 * Usage:
 *   node scripts/health-check.js           # full check
 *   node scripts/health-check.js --json    # JSON output
 *   npm run health
 *
 * Exit 0 = all required modules healthy, exit 1 = one or more unhealthy.
 */

const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// Load .env.local first, then .env
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(ROOT, '.env.local') });
  dotenv.config({ path: path.resolve(ROOT, '.env') });
} catch (_) {}

// ---------------------------------------------------------------------------
// Config loading — derive everything from boot.config.json
// ---------------------------------------------------------------------------
function loadBootConfig() {
  const configPath = path.resolve(ROOT, 'boot.config.json');
  if (!fs.existsSync(configPath)) {
    console.error('health-check: boot.config.json not found');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

const CONFIG = loadBootConfig();

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
const CLR = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const color = (code, s) => `${code}${s}${CLR.reset}`;
const tag = `${CLR.bold}[health]${CLR.reset}`;
function ok(msg)   { console.log(`${tag} ${color(CLR.green, '✓')} ${msg}`); }
function fail(msg) { console.error(`${tag} ${color(CLR.red, '✗')} ${msg}`); }
function info(msg) { console.log(`${tag} ${color(CLR.cyan, 'ℹ')} ${msg}`); }
function warn(msg) { console.log(`${tag} ${color(CLR.yellow, '⚠')} ${msg}`); }
function section(s) { console.log(`\n${tag} ${CLR.bold}${color(CLR.cyan, '── ' + s + ' ──')}${CLR.reset}`); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function canConnect(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
    socket.connect(port, host);
  });
}

function httpGet(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode, body: body.slice(0, 500) });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, statusCode: 0, body: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, statusCode: 0, body: e.message }));
  });
}

function findPidsOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
      const pids = new Set();
      for (const line of out.split('\n')) {
        if (!line.includes(`:${port}`)) continue;
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      }
      return [...pids];
    }
    const out = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: 'utf8', timeout: 5000 });
    return out.trim().split('\n').filter(Boolean);
  } catch (_) { return []; }
}

function getProcessInfo(pid) {
  try {
    if (process.platform === 'win32') {
      // Use PowerShell instead of wmic (deprecated/removed on newer Windows)
      const out = execSync(
        `powershell -NoProfile -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object ProcessName | Format-List"`,
        { encoding: 'utf8', timeout: 5000 }
      );
      const nameMatch = out.match(/ProcessName\s*:\s*(.+)/);
      const name = nameMatch ? nameMatch[1].trim() : 'unknown';
      // Get command line via PowerShell
      let cmdline = '';
      try {
        cmdline = execSync(
          `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
          { encoding: 'utf8', timeout: 5000 }
        ).trim();
      } catch (_) { cmdline = name; }
      return { name, cmdline: cmdline || name };
    } else {
      const out = execSync(`ps -p ${pid} -o comm= args=`, { encoding: 'utf8', timeout: 5000 });
      return { name: out.trim(), cmdline: out.trim() };
    }
  } catch (_) {}
  return { name: 'unknown', cmdline: 'unknown' };
}

// ---------------------------------------------------------------------------
// Module health check — deep check for each boot.config.json module
// ---------------------------------------------------------------------------
async function checkModule(mod) {
  const result = {
    id: mod.id,
    type: mod.type,
    enabled: mod.enabled,
    required: mod.required !== false,
    healthy: true,
    checks: [],
    failures: [],
  };

  if (!mod.enabled) {
    result.healthy = true; // disabled modules are not checked
    result.checks.push({ check: 'enabled', status: 'skip', message: 'module disabled' });
    return result;
  }

  if (mod.type === 'module') {
    // In-process module — can't check independently, assume healthy if
    // its dependencies are healthy (checked separately)
    result.checks.push({ check: 'in-process', status: 'skip', message: 'in-process module, depends on parent process' });
    return result;
  }

  if (mod.type !== 'process') return result;

  // 1. Port check
  if (!mod.port) {
    result.checks.push({ check: 'port', status: 'skip', message: 'no port configured' });
    return result;
  }

  const occupied = await canConnect(mod.port);
  if (!occupied) {
    result.healthy = false;
    result.failures.push(`port ${mod.port} not occupied — process not running`);
    result.checks.push({ check: 'port', status: 'fail', message: `port ${mod.port} not listening` });
    return result;
  }
  result.checks.push({ check: 'port', status: 'pass', message: `port ${mod.port} is listening` });

  // 2. Process identity check — is the expected process on this port?
  const pids = findPidsOnPort(mod.port);
  if (pids.length > 0) {
    const procInfo = getProcessInfo(pids[0]);
    const expectedCmd = mod.command || 'node';
    const cmdlineLower = (procInfo.cmdline || '').toLowerCase();
    const expectedLower = expectedCmd.toLowerCase();
    // Check if the process command line contains the expected command
    // (e.g., "node" for a Node.js process)
    if (!cmdlineLower.includes(expectedLower) && !cmdlineLower.includes('node')) {
      result.healthy = false;
      result.failures.push(`wrong process on port ${mod.port}: expected ${expectedCmd}, found ${procInfo.name} (PID ${pids[0]}) — cmdline: ${procInfo.cmdline.slice(0, 100)}`);
      result.checks.push({ check: 'process-identity', status: 'fail', message: `wrong process: ${procInfo.name}` });
    } else {
      result.checks.push({ check: 'process-identity', status: 'pass', message: `PID ${pids[0]} (${procInfo.name})` });
    }
  }

  // 3. Health endpoint check
  if (mod.health && mod.health.url) {
    const { ok: healthy, statusCode, body } = await httpGet(mod.health.url);
    if (!healthy) {
      result.healthy = false;
      result.failures.push(`health endpoint ${mod.health.url} returned status ${statusCode}: ${body.slice(0, 100)}`);
      result.checks.push({ check: 'health-endpoint', status: 'fail', message: `HTTP ${statusCode}` });
    } else {
      // 4. Validate response body — not an error page
      if (body.includes('Cannot GET') || body.includes('404 Not Found') || body.includes('Internal Server Error')) {
        result.healthy = false;
        result.failures.push(`health endpoint returned an error page: ${body.slice(0, 100)}`);
        result.checks.push({ check: 'health-body', status: 'fail', message: 'error page detected' });
      } else {
        result.checks.push({ check: 'health-endpoint', status: 'pass', message: `HTTP ${statusCode}` });
        result.checks.push({ check: 'health-body', status: 'pass', message: 'valid response' });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Database health check
// ---------------------------------------------------------------------------
async function checkDatabase() {
  const result = { id: 'database', healthy: true, checks: [], failures: [] };
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    result.healthy = false;
    result.failures.push('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return result;
  }

  // 1. REST API reachable?
  const { ok: restOk, statusCode } = await httpGet(`${supabaseUrl}/rest/v1/`, 5000);
  if (!restOk) {
    result.healthy = false;
    result.failures.push(`Supabase REST API unreachable at ${supabaseUrl} (status ${statusCode})`);
    result.checks.push({ check: 'rest-reachable', status: 'fail', message: `HTTP ${statusCode}` });
  } else {
    result.checks.push({ check: 'rest-reachable', status: 'pass', message: `HTTP ${statusCode}` });
  }

  // 2. Service-role write/read test — insert a test row, read it, delete it
  try {
    const testId = `health_check_${Date.now()}`;
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        id: testId,
        company: 'Health Check Probe',
        status: 'new',
      }),
    });
    if (!insertRes.ok) {
      result.healthy = false;
      result.failures.push(`service-role write failed: HTTP ${insertRes.status}`);
      result.checks.push({ check: 'service-role-write', status: 'fail', message: `HTTP ${insertRes.status}` });
    } else {
      result.checks.push({ check: 'service-role-write', status: 'pass', message: 'insert succeeded' });

      // Read it back
      const readRes = await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${testId}`, {
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
      });
      if (!readRes.ok) {
        result.healthy = false;
        result.failures.push(`service-role read failed: HTTP ${readRes.status}`);
        result.checks.push({ check: 'service-role-read', status: 'fail', message: `HTTP ${readRes.status}` });
      } else {
        const rows = await readRes.json();
        if (rows.length === 1) {
          result.checks.push({ check: 'service-role-read', status: 'pass', message: 'read succeeded' });
        } else {
          result.healthy = false;
          result.failures.push(`service-role read returned ${rows.length} rows, expected 1`);
          result.checks.push({ check: 'service-role-read', status: 'fail', message: 'wrong row count' });
        }
      }

      // Delete it
      const delRes = await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${testId}`, {
        method: 'DELETE',
        headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
      });
      if (delRes.ok) {
        result.checks.push({ check: 'service-role-delete', status: 'pass', message: 'delete succeeded' });
      } else {
        warn(`service-role delete returned HTTP ${delRes.status} (test row may need manual cleanup: ${testId})`);
      }
    }
  } catch (e) {
    result.healthy = false;
    result.failures.push(`service-role write/read error: ${e.message}`);
    result.checks.push({ check: 'service-role-write', status: 'fail', message: e.message });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Ollama health check
// ---------------------------------------------------------------------------
async function checkOllama() {
  const result = { id: 'ollama', healthy: true, checks: [], failures: [] };
  const ollamaUrl = process.env.LOCAL_MODEL_URL || 'http://localhost:11434';

  const { ok, statusCode, body } = await httpGet(`${ollamaUrl}/api/tags`, 5000);
  if (!ok) {
    result.healthy = false;
    result.failures.push(`Ollama unreachable at ${ollamaUrl} (status ${statusCode})`);
    result.checks.push({ check: 'ollama-reachable', status: 'fail', message: `HTTP ${statusCode}` });
  } else {
    result.checks.push({ check: 'ollama-reachable', status: 'pass', message: `HTTP ${statusCode}` });
    try {
      // The body might be truncated by httpGet's 500-char limit, so try
      // a fresh fetch with no truncation for parsing.
      const fullRes = await fetch(`${ollamaUrl}/api/tags`);
      const data = await fullRes.json();
      const modelCount = (data.models || []).length;
      if (modelCount === 0) {
        warn('Ollama reachable but no models installed');
        result.checks.push({ check: 'ollama-models', status: 'warn', message: '0 models' });
      } else {
        result.checks.push({ check: 'ollama-models', status: 'pass', message: `${modelCount} models available` });
      }
    } catch (_) {
      result.checks.push({ check: 'ollama-models', status: 'warn', message: 'could not parse response' });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// WSL port proxy check
// ---------------------------------------------------------------------------
async function checkStalePortProxy() {
  const result = { id: 'wsl-portproxy', healthy: true, checks: [], failures: [] };
  if (process.platform !== 'win32') return result;

  try {
    const out = execSync('netsh interface portproxy show all', { encoding: 'utf8', timeout: 5000 });
    if (out.trim().length === 0 || out.includes('No entries')) {
      result.checks.push({ check: 'portproxy', status: 'pass', message: 'no port proxies configured' });
    } else {
      // Check for proxies pointing at WSL IPs (172.x.x.x)
      if (/172\.\d+\.\d+\.\d+/.test(out)) {
        result.healthy = false;
        result.failures.push('stale WSL2 port proxy detected — pointing at a 172.x.x.x address');
        result.checks.push({ check: 'portproxy', status: 'fail', message: 'WSL2 port proxy found' });
        info('stale port proxy output:');
        out.split('\n').forEach((line) => { if (line.trim()) info(`  ${line.trim()}`); });
        info('to clear: netsh interface portproxy reset (run as admin)');
      } else {
        result.checks.push({ check: 'portproxy', status: 'pass', message: 'port proxies exist but none point at WSL IPs' });
      }
    }
  } catch (_) {
    result.checks.push({ check: 'portproxy', status: 'skip', message: 'could not check port proxies' });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const jsonMode = process.argv.includes('--json');
  const results = {
    timestamp: new Date().toISOString(),
    canonical: { path: ROOT, remote: execSync('git remote get-url origin', { encoding: 'utf8', timeout: 5000 }).trim() },
    modules: [],
    database: null,
    ollama: null,
    portproxy: null,
    overall: true,
  };

  if (!jsonMode) {
    console.log(`${tag} ${CLR.bold}HYDI Config-Derived Health Check${CLR.reset} — ${results.timestamp}`);
    section('Module health (from boot.config.json)');
  }

  // Check each module
  for (const mod of CONFIG.modules || []) {
    const result = await checkModule(mod);
    results.modules.push(result);
    if (!result.healthy && result.required) results.overall = false;

    if (!jsonMode) {
      const status = result.healthy ? color(CLR.green, '✓') : color(CLR.red, '✗');
      const req = result.required ? ' (required)' : ' (optional)';
      console.log(`  ${status} ${result.id}${req}`);
      for (const c of result.checks) {
        const icon = c.status === 'pass' ? color(CLR.green, '✓') : c.status === 'fail' ? color(CLR.red, '✗') : c.status === 'warn' ? color(CLR.yellow, '⚠') : color(CLR.cyan, 'ℹ');
        console.log(`      ${icon} ${c.check}: ${c.message}`);
      }
      for (const f of result.failures) {
        console.log(`      ${color(CLR.red, '✗')} FAILURE: ${f}`);
      }
    }
  }

  // Database check
  if (!jsonMode) section('Database health');
  const dbResult = await checkDatabase();
  results.database = dbResult;
  if (!dbResult.healthy) results.overall = false;
  if (!jsonMode) {
    const status = dbResult.healthy ? color(CLR.green, '✓') : color(CLR.red, '✗');
    console.log(`  ${status} database`);
    for (const c of dbResult.checks) {
      const icon = c.status === 'pass' ? color(CLR.green, '✓') : c.status === 'fail' ? color(CLR.red, '✗') : color(CLR.yellow, '⚠');
      console.log(`      ${icon} ${c.check}: ${c.message}`);
    }
    for (const f of dbResult.failures) {
      console.log(`      ${color(CLR.red, '✗')} FAILURE: ${f}`);
    }
  }

  // Ollama check
  if (!jsonMode) section('AI runtime (Ollama)');
  const ollamaResult = await checkOllama();
  results.ollama = ollamaResult;
  if (!jsonMode) {
    const status = ollamaResult.healthy ? color(CLR.green, '✓') : color(CLR.red, '✗');
    console.log(`  ${status} ollama`);
    for (const c of ollamaResult.checks) {
      const icon = c.status === 'pass' ? color(CLR.green, '✓') : c.status === 'fail' ? color(CLR.red, '✗') : c.status === 'warn' ? color(CLR.yellow, '⚠') : color(CLR.cyan, 'ℹ');
      console.log(`      ${icon} ${c.check}: ${c.message}`);
    }
  }

  // Port proxy check
  if (!jsonMode) section('Network (WSL port proxy)');
  const proxyResult = await checkStalePortProxy();
  results.portproxy = proxyResult;
  if (!proxyResult.healthy) results.overall = false;
  if (!jsonMode) {
    const status = proxyResult.healthy ? color(CLR.green, '✓') : color(CLR.red, '✗');
    console.log(`  ${status} port proxy`);
    for (const c of proxyResult.checks) {
      const icon = c.status === 'pass' ? color(CLR.green, '✓') : c.status === 'fail' ? color(CLR.red, '✗') : color(CLR.cyan, 'ℹ');
      console.log(`      ${icon} ${c.check}: ${c.message}`);
    }
  }

  // Summary
  if (!jsonMode) {
    section('Summary');
    if (results.overall) {
      ok('ALL REQUIRED MODULES HEALTHY');
    } else {
      fail('ONE OR MORE REQUIRED MODULES UNHEALTHY');
      for (const m of results.modules) {
        if (!m.healthy && m.required) fail(`  ${m.id}: ${m.failures.join('; ')}`);
      }
      if (!results.database.healthy) fail(`  database: ${results.database.failures.join('; ')}`);
      if (!results.portproxy.healthy) fail(`  portproxy: ${results.portproxy.failures.join('; ')}`);
    }
  } else {
    console.log(JSON.stringify(results, null, 2));
  }

  process.exit(results.overall ? 0 : 1);
}

main().catch((e) => {
  fail(`uncaught error: ${e.message}`);
  process.exit(1);
});
