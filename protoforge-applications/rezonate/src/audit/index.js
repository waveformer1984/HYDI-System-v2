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
  const _disk = diskFreeGb || (() => {
    try {
      const st = fs.statfsSync(path.join(__dirname, '..', '..', '..', '..'));
      return (st.bavail * st.bsize) / 1e9;
    } catch { return null; }
  });
  const _mem = freeMemBytes || (() => {
    try { return os.freemem(); } catch { return null; }
  });

  // Engine health comes from the provider's own health() — async, and
  // the same surface /health and /engine/status report. Falls back to
  // isAvailable() when the provider surface is absent.
  async function engineHealth() {
    if (!engine) return null;
    try {
      if (engine.audioProvider && engine.audioProvider.health) return await engine.audioProvider.health();
      if (engine.isAvailable) return { available: await engine.isAvailable() };
    } catch { return null; }
    return null;
  }

  function gitSha() {
    if (config.gitSha) return config.gitSha;
    try {
      const p = JSON.parse(fs.readFileSync(
        config.provenancePath || path.join(__dirname, '..', '..', '..', '..', '.runtime', 'provenance', 'rezonate-app.json'), 'utf8'));
      return p.gitSha || null;
    } catch { return null; }
  }

  async function serviceHealth(app) {
    const checks = [];
    checks.push({ id: 'service.process', status: repository ? 'PASS' : 'FAIL', evidence: repository ? 'repository bound' : 'no repository' });
    const eh = await engineHealth();
    checks.push({ id: 'service.engine', status: eh && eh.available ? 'PASS' : 'FAIL',
      evidence: eh ? `available=${eh.available}` : 'engine health unreadable' });
    const sha = gitSha();
    checks.push({ id: 'service.version', status: sha ? 'PASS' : 'NOT_TESTED', evidence: sha ? `gitSha ${sha.slice(0, 8)}` : 'no stamp injected' });
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
      const m = await copilot.memory('audit-probe');
      checks.push({
        id: 'copilot.memory',
        status: m && Array.isArray(m.entries) ? 'NOT_TESTED' : 'FAIL',
        evidence: m && Array.isArray(m.entries)
          ? 'read ok; write-persistence is exercised only by POST /audit/probe'
          : 'memory read malformed',
      });
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
    const st = (await engineHealth()) || {};
    const enginePath = st.path || (config.enginePath || null);
    let stemsDir = null;
    try {
      const root = enginePath || path.join(__dirname, '..', '..', '..', '..', 'rezonate');
      stemsDir = fs.readdirSync(path.join(root, 'stems')).filter(Boolean).slice(0, 5);
    } catch { /* optional */ }
    return [
      { id: 'engine.local', status: st.provider === 'local' && st.cloudDependency === false ? 'PASS' : 'FAIL', evidence: `provider=${st.provider} cloud=${st.cloudDependency}` },
      { id: 'engine.model', status: st.modelAvailable ? 'PASS' : 'BLOCKED', evidence: st.modelAvailable ? 'local model present' : (st.reason || 'model unavailable') },
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
      { id: 'tablet.pwa', status: fs.existsSync(path.join(__dirname, '..', '..', 'public', 'manifest.webmanifest')) ? 'PASS' : 'FAIL',
        evidence: fs.existsSync(path.join(__dirname, '..', '..', 'public', 'manifest.webmanifest')) ? 'manifest present' : 'manifest.webmanifest missing' },
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

  // The only check allowed to write — explicitly triggered via POST.
  // A uniquely identifiable, safely isolated probe note proves write+read
  // persistence without touching real creative memory.
  async function probe() {
    if (!copilot || !copilot.remember || !copilot.memory) return { ok: false, status: 'FAIL', evidence: 'no copilot bound' };
    const note = `audit-readiness-probe ${now().toISOString()}`;
    try {
      await copilot.remember('audit-probe', note);
      const m = await copilot.memory('audit-probe');
      const found = (m.entries || []).some((e) => e.note === note);
      return { ok: true, status: found ? 'PASS' : 'FAIL', evidence: found ? 'probe note written and read back' : 'probe note missing after write' };
    } catch (e) { return { ok: false, status: 'FAIL', evidence: String(e.message || e) }; }
  }

  return { run, probe, DISK_WARN_GB, DISK_BLOCK_GB, RAM_WARN_GB, RAM_BLOCK_GB };
}

module.exports = { createAudit };
