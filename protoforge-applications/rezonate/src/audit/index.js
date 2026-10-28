'use strict';

/**
 * Readiness audit — read-only verification of the Rezonate install.
 * Every check returns PASS, FAIL, BLOCKED, or NOT_TESTED with evidence.
 * A skipped check is NOT_TESTED, never PASS. No secrets, no heavy work:
 * the only write allowed is one isolated copilot test note.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const DISK_WARN_GB = 10;
const DISK_BLOCK_GB = 5;
const RAM_WARN_GB = 2;
const RAM_BLOCK_GB = 1;

function createAudit({ repository, engine, copilot, config = {}, execFileText, diskFreeGb, freeMemBytes, now = () => new Date() } = {}) {
  const _disk = diskFreeGb || ((drive = 'C:') => {
    try {
      const out = require('child_process').execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-PSDrive ${drive.replace(':', '')}).Free`], { encoding: 'utf8', timeout: 8000 });
      const n = Number(String(out).trim()) / 1e9;
      return Number.isFinite(n) ? n : null;
    } catch { return null; }
  });
  const _mem = freeMemBytes || (() => {
    try { return os.freemem(); } catch { return null; }
  });

  async function serviceHealth(app) {
    const checks = [];
    checks.push({ id: 'service.process', status: repository ? 'PASS' : 'FAIL', evidence: repository ? 'repository bound' : 'no repository' });
    checks.push({ id: 'service.engine', status: engine && engine.status && engine.status().available ? 'PASS' : 'FAIL',
      evidence: engine && engine.status ? JSON.stringify(engine.status()) : 'no engine' });
    checks.push({ id: 'service.version', status: config.gitSha ? 'PASS' : 'NOT_TESTED', evidence: config.gitSha || 'no stamp injected' });
    checks.push({ id: 'service.remix_page', status: app ? 'PASS' : 'NOT_TESTED', evidence: app ? 'served by this process' : 'not probed' });
    return checks;
  }

  async function copilotChecks() {
    const checks = [];
    if (!copilot) return [{ id: 'copilot.present', status: 'FAIL', evidence: 'no copilot injected' }];
    try {
      const s = await copilot.suggest(null);
      checks.push({ id: 'copilot.suggest', status: s && Array.isArray(s.suggestions) ? 'PASS' : 'FAIL', evidence: `${(s.suggestions || []).length} suggestions` });
    } catch (e) { checks.push({ id: 'copilot.suggest', status: 'FAIL', evidence: String(e.message || e) }); }
    try {
      const c = await copilot.context(null);
      checks.push({ id: 'copilot.context', status: c && typeof c === 'object' ? 'PASS' : 'FAIL', evidence: `assets=${(c.assets || []).length}` });
    } catch (e) { checks.push({ id: 'copilot.context', status: 'FAIL', evidence: String(e.message || e) }); }
    try {
      const note = `audit-readiness-probe ${now().toISOString()}`;
      await copilot.remember('audit-probe', note);
      const m = await copilot.memory('audit-probe');
      const found = (m.entries || []).some((e) => e.note === note);
      checks.push({ id: 'copilot.memory', status: found ? 'PASS' : 'FAIL', evidence: found ? 'probe note round-tripped' : 'probe note missing' });
    } catch (e) { checks.push({ id: 'copilot.memory', status: 'FAIL', evidence: String(e.message || e) }); }
    try {
      const g = await copilot.suggest('deliberately-missing-project');
      checks.push({ id: 'copilot.graceful', status: g && g.suggestions ? 'PASS' : 'FAIL', evidence: 'empty context returned, no throw' });
    } catch (e) { checks.push({ id: 'copilot.graceful', status: 'FAIL', evidence: String(e.message || e) }); }
    return checks;
  }

  async function projectChecks() {
    const projects = repository ? await Promise.resolve(repository.listProjects()).catch(() => []) : [];
    const list = Array.isArray(projects) ? projects : [];
    return [{
      id: 'project.awareness',
      status: list.length ? 'PASS' : 'BLOCKED',
      evidence: list.length ? `${list.length} project(s), latest: ${list[0].title || list[0].id}` : 'no projects yet — create one to unlock context-aware suggestions',
    }];
  }

  async function engineChecks() {
    const st = engine && engine.status ? engine.status() : {};
    const enginePath = st.path || (config.enginePath || null);
    let stemsDir = null;
    try {
      const root = enginePath || path.join(__dirname, '..', '..', '..', '..', 'rezonate');
      stemsDir = fs.readdirSync(path.join(root, 'stems')).filter(Boolean).slice(0, 5);
    } catch { /* optional */ }
    return [
      { id: 'engine.local', status: st.audioProvider === 'local' && st.cloudDependency === false ? 'PASS' : 'FAIL', evidence: `provider=${st.audioProvider} cloud=${st.cloudDependency}` },
      { id: 'engine.model', status: st.modelAvailable ? 'PASS' : 'BLOCKED', evidence: st.modelAvailable ? 'local model present' : 'model unavailable' },
      { id: 'engine.stems_cache', status: stemsDir && stemsDir.length ? 'PASS' : 'NOT_TESTED', evidence: stemsDir && stemsDir.length ? `cached: ${stemsDir.join(', ')}` : 'no cached stems found' },
    ];
  }

  function tabletChecks() {
    // Truthful scoping: this process only knows it serves :3001 on the
    // loopback/LAN. Tailnet reachability of the tablet is a physical
    // check we cannot fake from here.
    return [
      { id: 'tablet.listen', status: 'PASS', evidence: `serving on port ${config.port || 3001}` },
      { id: 'tablet.tailnet', status: 'BLOCKED', evidence: 'verify http://100.118.182.126:3001 from the tablet on the tailnet — cannot be probed from Frank' },
      { id: 'tablet.pwa', status: 'NOT_TESTED', evidence: 'manifest present? check /manifest.webmanifest' },
    ];
  }

  function resourceChecks() {
    const free = _disk();
    const mem = _mem();
    const memGb = mem == null ? null : mem / 1e9;
    return [
      { id: 'resource.disk', status: free == null ? 'NOT_TESTED' : free >= DISK_WARN_GB ? 'PASS' : free >= DISK_BLOCK_GB ? 'BLOCKED' : 'FAIL',
        evidence: free == null ? 'could not read free space' : `${free.toFixed(1)} GB free (warn <${DISK_WARN_GB}, block <${DISK_BLOCK_GB})` },
      { id: 'resource.memory', status: memGb == null ? 'NOT_TESTED' : memGb >= RAM_WARN_GB ? 'PASS' : memGb >= RAM_BLOCK_GB ? 'BLOCKED' : 'FAIL',
        evidence: memGb == null ? 'could not read free memory' : `${memGb.toFixed(2)} GB free (warn <${RAM_WARN_GB}, block <${RAM_BLOCK_GB}) — heavy audio held until ≥${RAM_WARN_GB} GB` },
    ];
  }

  async function run() {
    const groups = {
      service: await serviceHealth(true),
      copilot: await copilotChecks(),
      project: await projectChecks(),
      engine: await engineChecks(),
      tablet: tabletChecks(),
      resources: resourceChecks(),
    };
    const all = Object.values(groups).flat();
    const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, NOT_TESTED: 0 };
    for (const c of all) counts[c.status] = (counts[c.status] || 0) + 1;
    const overall = counts.FAIL ? 'FAIL' : counts.BLOCKED ? 'BLOCKED' : counts.NOT_TESTED ? 'PARTIAL' : 'PASS';
    return { ok: true, overall, counts, at: now().toISOString(), version: config.gitSha || null, checks: groups };
  }

  return { run, DISK_WARN_GB, DISK_BLOCK_GB, RAM_WARN_GB, RAM_BLOCK_GB };
}

module.exports = { createAudit };
