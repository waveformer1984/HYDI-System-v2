const fs = require('fs');
const path = require('path');

/**
 * Local-first dashboard state store for HYDI health/status APIs.
 *
 * Mirrors the contract of the Supabase `system_dashboard` view and
 * the `infrastructure_health` singleton. No Supabase required.
 */

const DEFAULT_DATA_DIR = path.join(process.cwd(), 'data', 'hydi-local', 'health');

function getDataDir() {
  return process.env.HYDI_HEALTH_DATA_DIR || DEFAULT_DATA_DIR;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function file(name) {
  const dir = getDataDir();
  ensureDir(dir);
  return path.join(dir, name);
}

function atomicWrite(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

// The dashboard returned when nothing has ever been recorded.
//
// These values must describe "we have not measured this", not "everything is
// fine". `current_status: 'OK'` and a `last_check` of "now" used to be the
// defaults, which meant api/health.js reported status:"healthy" off a hardcoded
// constant with zero health runs behind it whenever the local branch was taken
// (api/health.js -> fetchLocalDashboard, chosen when shouldUseSupabase() is
// false — the local-first path).
//
// The Supabase branch reads system_dashboard, whose current_status is a scalar
// subquery over system_health_runs; with no rows it is NULL, so that branch
// correctly reports "degraded". These defaults mirror that empty-view shape
// exactly, so both branches give the same answer to "no evidence yet" instead
// of disagreeing about what silence means.
const DEFAULT_DASHBOARD = {
  // null, not 'OK' — api/health.js treats anything !== 'OK' as not healthy.
  current_status: null,
  trend_status: 'unknown',
  // Escalation mirrors the Supabase branch, which reports OK/none/"System
  // stable" on an empty table: having nothing to escalate is a real answer,
  // unlike claiming the system is healthy.
  escalation_level: 'OK',
  trend_reason: 'No health runs recorded yet',
  escalation_action: 'none',
  escalation_reason: 'System stable',
  jobs_queued: 0,
  jobs_failed: 0,
  jobs_dead: 0,
  events_last_hour: 0,
  auto_heals_24h: 0,
  critical_pct: 0,
  warning_pct: 0,
  avg_queue_size: 0,
  // null, not "now" — a default must not fabricate a check that never ran.
  last_check: null,
};

const DEFAULT_INFRASTRUCTURE = {
  id: 'singleton',
  overall: 'unknown',
  efficiency: null,
  power: null,
  thermal: null,
  scaffold: null,
  revenue: null,
  updated_at: new Date().toISOString(),
};

function readJson(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`[LocalDashboardStore] failed to read ${filePath}:`, e instanceof Error ? e.message : e);
  }
  return { ...defaultValue };
}

function getDashboard() {
  return readJson(file('dashboard.json'), DEFAULT_DASHBOARD);
}

function setDashboard(dashboard) {
  const merged = { ...getDashboard(), ...dashboard, last_check: new Date().toISOString() };
  atomicWrite(file('dashboard.json'), JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

function getInfrastructure() {
  return readJson(file('infrastructure.json'), DEFAULT_INFRASTRUCTURE);
}

function setInfrastructure(infra) {
  const merged = { ...getInfrastructure(), ...infra, updated_at: new Date().toISOString() };
  atomicWrite(file('infrastructure.json'), JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

function recordAutoHeal(actions = []) {
  const now = new Date().toISOString();
  const heal = { healed: actions.length, actions, timestamp: now };
  const healFile = file('auto-heal.jsonl');
  fs.appendFileSync(healFile, JSON.stringify(heal) + '\n', 'utf8');

  const dashboard = getDashboard();
  // Keep a 24h window count (simplified: count since 24 hours ago)
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  let count24h = 0;
  if (fs.existsSync(healFile)) {
    const lines = fs.readFileSync(healFile, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const h = JSON.parse(line);
        if (h.timestamp >= cutoff) count24h += h.healed || 0;
      } catch {}
    }
  }
  dashboard.auto_heals_24h = count24h;
  setDashboard(dashboard);
  return heal;
}

function listRecentAutoHeals(limit = 100) {
  const healFile = file('auto-heal.jsonl');
  if (!fs.existsSync(healFile)) return [];
  return fs
    .readFileSync(healFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-limit)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

module.exports = {
  getDashboard,
  setDashboard,
  getInfrastructure,
  setInfrastructure,
  recordAutoHeal,
  listRecentAutoHeals,
  getDataDir,
};
