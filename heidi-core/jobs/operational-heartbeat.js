'use strict';

/**
 * Periodic operational snapshot into heidi_state_snapshots (Phase 1).
 * Fails soft: insert errors are logged, process keeps running.
 */

const { execFile } = require('child_process');
const net = require('net');
const path = require('path');

const SOURCE = 'operational-heartbeat';
const DEFAULT_MODEL = 'qwen2.5:3b-instruct-q4_K_M';
const PROBE_PORTS = [3000, 3005, 3006, 3459, 11434];
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

function pm2JlistCommand(platform) {
  return platform === 'win32'
    ? { file: 'cmd.exe', args: ['/c', 'pm2', 'jlist'] }
    : { file: 'pm2', args: ['jlist'] };
}

function execText(execImpl, file, args, opts) {
  return new Promise((resolve) => {
    execImpl(file, args, opts, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout || '') });
    });
  });
}

async function readPm2Services(deps) {
  const cmd = pm2JlistCommand(deps.platform);
  const out = await execText(deps.execFile, cmd.file, cmd.args, {
    cwd: deps.repoRoot,
    timeout: 20_000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!out.ok) return [];
  try {
    const start = out.stdout.indexOf('[');
    const list = start >= 0 ? JSON.parse(out.stdout.slice(start)) : [];
    if (!Array.isArray(list)) return [];
    return list.map((p) => ({
      name: p.name || 'unknown',
      status: (p.pm2_env && p.pm2_env.status) || 'unknown',
    }));
  } catch {
    return [];
  }
}

function tcpProbe(port, deps) {
  return new Promise((resolve) => {
    const connect = deps.tcpConnect || net.connect;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const socket = connect({ port, host: '127.0.0.1' });
    const timer = setTimeout(() => {
      socket.destroy();
      finish(false);
    }, 2000);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      finish(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

async function probePorts(deps) {
  const up = [];
  for (const port of PROBE_PORTS) {
    if (await tcpProbe(port, deps)) up.push(port);
  }
  return up;
}

async function ollamaReachable(fetchFn = global.fetch) {
  if (typeof fetchFn !== 'function') return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetchFn(`${OLLAMA_URL.replace(/\/$/, '')}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

async function buildOperationalPayload(deps = {}) {
  const now = deps.now ? deps.now() : Date.now();
  const merged = {
    platform: process.platform,
    execFile: execFile,
    repoRoot: path.resolve(__dirname, '..', '..'),
    ...deps,
  };
  const [pm2_services, ports_list] = await Promise.all([
    readPm2Services(merged),
    probePorts(merged),
  ]);
  const ollama_reachable = await ollamaReachable(merged.fetch);
  return {
    ts: new Date(now).toISOString(),
    pm2_services,
    ports_up: ports_list,
    ollama_reachable,
    model: deps.model || process.env.HEIDI_HEARTBEAT_MODEL || DEFAULT_MODEL,
  };
}

async function insertOperationalSnapshot(store, payload, log = console) {
  if (!store || !store.isAvailable || !store.isAvailable()) {
    log.warn('[heartbeat] store unavailable — snapshot skipped');
    return { ok: false, reason: 'no-store' };
  }
  try {
    const { error } = await store.from('heidi_state_snapshots').insert({
      source: SOURCE,
      cycle_id: `heartbeat-${payload.ts}`,
      captured_at: payload.ts,
      payload,
    });
    if (error) {
      log.warn(`[heartbeat] insert failed: ${error.message}`);
      return { ok: false, reason: error.message };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn(`[heartbeat] insert error: ${msg}`);
    return { ok: false, reason: msg };
  }
}

async function runOperationalHeartbeat(deps = {}) {
  const store = deps.store;
  const log = deps.log || console;
  const payload = await buildOperationalPayload(deps);
  return insertOperationalSnapshot(store, payload, log);
}

function startOperationalHeartbeat({ store, log = console, intervalMin } = {}) {
  const min = Number(intervalMin || process.env.HEIDI_HEARTBEAT_MIN || 15);
  const ms = Math.max(1, min) * 60 * 1000;
  const deps = { store, log };
  let timer = null;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    void runOperationalHeartbeat(deps).catch((e) => {
      log.warn(`[heartbeat] tick failed: ${e instanceof Error ? e.message : e}`);
    });
    timer = setTimeout(tick, ms);
    if (timer.unref) timer.unref();
  };

  void runOperationalHeartbeat(deps);
  timer = setTimeout(tick, ms);
  if (timer.unref) timer.unref();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

module.exports = {
  SOURCE,
  DEFAULT_MODEL,
  PROBE_PORTS,
  buildOperationalPayload,
  insertOperationalSnapshot,
  runOperationalHeartbeat,
  startOperationalHeartbeat,
};