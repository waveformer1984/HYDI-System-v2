'use strict';

/**
 * One read-only picture of Frank, assembled from the evidence files the
 * running system already writes. Reading files only: no pm2, docker or
 * network calls, so it is cheap enough to serve on every request.
 *
 *   .observatory/current.json        host, GPU, Docker, PM2, Ollama, probes,
 *                                    active findings (scripts/observatory)
 *   .observatory/observer-status.json collector self-health
 *   .runtime/storage/status.json     storage guard (docs/STORAGE_PROGRAM.md)
 *   .heidi-daemon-status.json        hydi-daemon loop evidence (updatedAt)
 *
 * Every source carries its age. A missing or stale source is an issue in
 * its own right: "not observed" never reads as healthy.
 */

const fs = require('fs');
const path = require('path');

const SEVERITY_RANK = Object.freeze({ info: 0, warn: 1, crit: 2 });
const STALE_MS = Object.freeze({
  observatory: 3 * 60 * 1000,
  storage: 45 * 60 * 1000,
  daemon: 3 * 60 * 1000,
});

function readJson(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function ageMs(iso, now) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

function issue(severity, source, id, text) {
  return { severity, source, id, text };
}

function sourceState(name, record, tsField, now) {
  if (!record) return { name, present: false, ageSec: null, stale: true };
  const age = ageMs(record[tsField], now);
  return { name, present: true, ageSec: age === null ? null : Math.round(age / 1000), stale: age === null || age > STALE_MS[name] };
}

function summarizeHost(obs) {
  const h = obs && obs.host;
  if (!h) return null;
  const cDrive = Array.isArray(h.disks) ? h.disks.find((d) => String(d.drive).toUpperCase() === 'C') : null;
  return {
    cpuPct: h.cpu_pct ?? null,
    memFreeGb: Number.isFinite(h.mem_avail_mb) ? Math.round((h.mem_avail_mb / 1024) * 10) / 10 : null,
    memTotalGb: Number.isFinite(h.mem_total_mb) ? Math.round((h.mem_total_mb / 1024) * 10) / 10 : null,
    commitPct: h.commit_pct ?? null,
    uptimeHours: h.uptime_hours ?? null,
    diskC: cDrive ? { freeGb: cDrive.free_gb, totalGb: cDrive.total_gb, health: cDrive.health || null } : null,
    topProcesses: Array.isArray(h.top_procs) ? h.top_procs.slice(0, 5).map((p) => ({ name: p.name, memMb: p.ws_mb })) : [],
  };
}

function summarizeDocker(obs) {
  const d = obs && obs.docker;
  if (!d) return null;
  if (!d.available) return { available: false };
  const containers = Array.isArray(d.containers) ? d.containers : [];
  return {
    available: true,
    running: containers.filter((c) => c.state === 'running').length,
    total: containers.length,
    unhealthy: containers.filter((c) => c.health === 'unhealthy').map((c) => c.name),
    exited: containers.filter((c) => c.state === 'exited').map((c) => c.name),
  };
}

function summarizePm2(obs) {
  const p = obs && obs.pm2;
  if (!p) return null;
  if (!p.available) return { available: false };
  const procs = Array.isArray(p.processes) ? p.processes : [];
  return {
    available: true,
    online: procs.filter((x) => x.status === 'online').length,
    total: procs.length,
    errored: procs.filter((x) => x.status === 'errored').map((x) => x.name),
    mostRestarted: procs.filter((x) => Number(x.restarts) > 0)
      .sort((a, b) => Number(b.restarts) - Number(a.restarts)).slice(0, 3)
      .map((x) => ({ name: x.name, restarts: x.restarts })),
  };
}

function buildFrankSnapshot({ root = path.resolve(__dirname, '..', '..'), now = Date.now(), read = readJson } = {}) {
  const obs = read(path.join(root, '.observatory', 'current.json'));
  const observer = read(path.join(root, '.observatory', 'observer-status.json'));
  const storage = read(path.join(root, '.runtime', 'storage', 'status.json'));
  const daemon = read(path.join(root, '.heidi-daemon-status.json'));

  const sources = {
    observatory: sourceState('observatory', obs, 'ts', now),
    storage: sourceState('storage', storage, 'at', now),
    daemon: sourceState('daemon', daemon, 'updatedAt', now),
  };

  const issues = [];
  if (!sources.observatory.present) {
    issues.push(issue('crit', 'observatory', 'observatory-missing', 'Frank monitor has never written a sample (is frank-observer running?)'));
  } else if (sources.observatory.stale) {
    issues.push(issue('crit', 'observatory', 'observatory-stale', `Frank monitor's last sample is ${Math.round((sources.observatory.ageSec || 0) / 60)} min old`));
  }
  if (observer && Number(observer.consecutive_errors) >= 3) {
    issues.push(issue('warn', 'observatory', 'observatory-errors', `monitor collection errors ${observer.consecutive_errors} runs in a row`));
  }

  for (const f of (obs && Array.isArray(obs.findings_active) ? obs.findings_active : [])) {
    if (!f || !f.id || f.severity === 'info') continue;
    issues.push(issue(f.severity === 'crit' ? 'crit' : 'warn', 'observatory', f.id, String(f.summary || f.id)));
  }

  const pm2 = summarizePm2(obs);
  if (pm2 && pm2.available) {
    for (const name of pm2.errored) issues.push(issue('crit', 'pm2', `pm2-errored-${name}`, `${name} is errored in PM2`));
  }
  const docker = summarizeDocker(obs);
  if (docker && docker.available) {
    for (const name of docker.unhealthy) issues.push(issue('warn', 'docker', `docker-unhealthy-${name}`, `container ${name} is unhealthy`));
  }

  if (storage && !sources.storage.stale) {
    if (storage.level === 'CRITICAL' || storage.level === 'UNKNOWN') {
      issues.push(issue('crit', 'storage', `storage-${storage.level}`, `storage ${storage.level}: ${storage.freeGb ?? '?'} GB free`));
    } else if (storage.level === 'LOW') {
      issues.push(issue('warn', 'storage', 'storage-LOW', `storage LOW: ${storage.freeGb} GB free`));
    }
  } else if (storage) {
    issues.push(issue('warn', 'storage', 'storage-stale', 'storage guard has not reported in 45 min'));
  }

  if (daemon && !sources.daemon.stale) {
    if (daemon.lastCycleOutcome === 'HARD_FAILURE' || Number(daemon.consecutiveFailures) >= 3) {
      issues.push(issue('warn', 'daemon', 'daemon-failing', `hydi-daemon: last cycle ${daemon.lastCycleOutcome || '?'}, ${daemon.consecutiveFailures ?? '?'} failures in a row`));
    }
  } else if (daemon) {
    issues.push(issue('warn', 'daemon', 'daemon-stale', 'hydi-daemon status not updated in 3 min'));
  }

  // One entry per id; the worse severity wins.
  const byId = new Map();
  for (const i of issues) {
    const prev = byId.get(i.id);
    if (!prev || SEVERITY_RANK[i.severity] > SEVERITY_RANK[prev.severity]) byId.set(i.id, i);
  }
  const deduped = [...byId.values()].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.id.localeCompare(b.id));
  const level = deduped.some((i) => i.severity === 'crit') ? 'CRIT' : deduped.length ? 'WARN' : 'OK';

  return {
    device: 'frank',
    at: new Date(now).toISOString(),
    level,
    issues: deduped,
    sources,
    host: summarizeHost(obs),
    gpu: obs && obs.gpu ? { available: Boolean(obs.gpu.available), name: obs.gpu.name || null } : null,
    docker,
    pm2,
    ollama: obs && obs.ollama ? {
      reachable: Boolean(obs.ollama.reachable),
      modelsLoaded: Array.isArray(obs.ollama.models_loaded) ? obs.ollama.models_loaded.map((m) => m.name) : [],
    } : null,
    probes: obs && obs.probes ? obs.probes : null,
    storage: storage ? {
      level: storage.level,
      freeGb: storage.freeGb,
      trendGbPerDay: storage.trendGbPerDay ?? null,
      daysToCritical: storage.daysToCritical ?? null,
      dockerDiskGb: storage.dockerDiskGb ?? null,
    } : null,
    daemon: daemon ? {
      state: daemon.state || null,
      lastCycleOutcome: daemon.lastCycleOutcome || null,
      consecutiveFailures: daemon.consecutiveFailures ?? null,
    } : null,
  };
}

function formatFrankSnapshot(s) {
  const lines = [`Frank: ${s.level}${s.issues.length ? ` (${s.issues.length} issue${s.issues.length === 1 ? '' : 's'})` : ''}`];
  for (const i of s.issues.slice(0, 8)) lines.push(`  ${i.severity === 'crit' ? '!!' : '! '} ${i.text}`);
  const h = s.host;
  if (h) {
    const parts = [];
    if (h.cpuPct !== null) parts.push(`CPU ${h.cpuPct}%`);
    if (h.memFreeGb !== null) parts.push(`RAM ${h.memFreeGb}/${h.memTotalGb} GB free`);
    if (h.diskC) parts.push(`C: ${h.diskC.freeGb}/${h.diskC.totalGb} GB free`);
    if (h.uptimeHours !== null) parts.push(`up ${h.uptimeHours}h`);
    if (parts.length) lines.push(`Host: ${parts.join(', ')}`);
  }
  if (s.pm2) lines.push(s.pm2.available ? `PM2: ${s.pm2.online}/${s.pm2.total} online${s.pm2.errored.length ? `, errored: ${s.pm2.errored.join(', ')}` : ''}` : 'PM2: unreadable');
  if (s.docker) lines.push(s.docker.available ? `Docker: ${s.docker.running}/${s.docker.total} running${s.docker.unhealthy.length ? `, unhealthy: ${s.docker.unhealthy.join(', ')}` : ''}` : 'Docker: down or unreadable');
  if (s.ollama) lines.push(`Ollama: ${s.ollama.reachable ? `up${s.ollama.modelsLoaded.length ? ` (${s.ollama.modelsLoaded.join(', ')})` : ''}` : 'down'}`);
  if (s.storage) lines.push(`Storage: ${s.storage.level}, ${s.storage.freeGb} GB free${s.storage.trendGbPerDay !== null ? `, ${s.storage.trendGbPerDay} GB/day` : ''}`);
  if (s.daemon) lines.push(`Daemon: ${s.daemon.state || '?'}${s.daemon.lastCycleOutcome ? `, last cycle ${s.daemon.lastCycleOutcome}` : ''}`);
  const ages = Object.values(s.sources).filter((x) => x.present).map((x) => `${x.name} ${x.ageSec}s`);
  if (ages.length) lines.push(`Evidence age: ${ages.join(', ')}`);
  return lines.join('\n');
}

module.exports = { STALE_MS, buildFrankSnapshot, formatFrankSnapshot };
