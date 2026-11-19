'use strict';

/**
 * Phase 2 — persistent heidi-agent loop helpers (snapshot lease, health, triple gate).
 */

const http = require('http');
const { randomUUID } = require('crypto');
const { CONFIDENCE_FLOOR } = require('../governance/action-advisor');

const SNAPSHOT_SOURCE = 'heidi-agent-phase2';
const DEFAULT_AGENT_PORT = 3462;
const DEFAULT_CYCLE_MS = 30000;
const DEFAULT_REFLECT_EVERY = 10;
const DEFAULT_ADVISOR_MODEL = 'qwen2.5:3b-instruct-q4_K_M';

function advisorModelName() {
  return process.env.HEIDI_ADVISOR_MODEL || DEFAULT_ADVISOR_MODEL;
}

/** Reject 1B-class models (spec: qwen2.5:3b-instruct-q4_K_M only). */
function assertAllowedAdvisorModel(model) {
  const m = String(model || '').toLowerCase();
  if (/1b|:1b|1\.8b|0\.5b/.test(m)) {
    throw new Error(`advisor model '${model}' is not allowed (use ${DEFAULT_ADVISOR_MODEL})`);
  }
}

/**
 * Triple gate for execution — all three must pass before any exec path.
 * @returns {{ mayExecute: boolean, failedGates: string[] }}
 */
function evaluateExecTripleGate({ allowExec, advisorAutoApprove, withinBounds }) {
  const failedGates = [];
  if (!allowExec) failedGates.push('HEIDI_ALLOW_EXEC');
  if (!advisorAutoApprove) failedGates.push('advisor_auto_approve');
  if (!withinBounds) failedGates.push('heidi_decision_bounds');
  return {
    mayExecute: failedGates.length === 0,
    failedGates,
  };
}

function advisorAutoApprove(verdict, confidence) {
  return (
    verdict === 'AUTO-APPROVE' &&
    typeof confidence === 'number' &&
    confidence >= CONFIDENCE_FLOOR
  );
}

function cycleIntervalMs() {
  const n = parseInt(process.env.HEIDI_AGENT_CYCLE_MS || String(DEFAULT_CYCLE_MS), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CYCLE_MS;
}

function reflectEveryNCycles() {
  const n = parseInt(process.env.HEIDI_AGENT_REFLECT_EVERY_N || String(DEFAULT_REFLECT_EVERY), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REFLECT_EVERY;
}

function agentHealthPort() {
  const n = parseInt(process.env.HEIDI_AGENT_PORT || String(DEFAULT_AGENT_PORT), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AGENT_PORT;
}

function parseHeartbeat(row) {
  if (!row || typeof row !== 'object') return null;
  const p = row.payload || {};
  if (p.lease_holder == null && !p.instance_id) return null;
  return {
    lease_holder: p.lease_holder,
    instance_id: p.instance_id,
    heartbeat_at: row.captured_at || p.heartbeat_at,
    cycle: p.cycle,
    released: p.lease_released === true,
  };
}

/**
 * Another instance holds a live lease if heartbeat is newer than 2× interval
 * and instance_id differs (or holder differs and not released).
 */
function shouldYieldLease({ latestRow, holder, instanceId, intervalMs }) {
  const hb = parseHeartbeat(latestRow);
  if (!hb || hb.released) return false;
  if (!hb.heartbeat_at) return false;
  const ageMs = Date.now() - new Date(hb.heartbeat_at).getTime();
  if (ageMs > 2 * intervalMs) return false;
  if (hb.instance_id && hb.instance_id === instanceId) return false;
  if (hb.lease_holder === holder && hb.instance_id === instanceId) return false;
  return hb.lease_holder !== holder || (hb.instance_id && hb.instance_id !== instanceId);
}

function boundsRowUsable(bounds) {
  return !!(bounds && typeof bounds === 'object' && typeof bounds.auto_approve_threshold === 'number');
}

function buildHeartbeatPayload({ holder, instanceId, cycle, leaseHeld, divisionStatus, extra }) {
  return {
    lease_holder: holder,
    instance_id: instanceId,
    heartbeat_at: new Date().toISOString(),
    cycle,
    lease_held: leaseHeld,
    division_status: divisionStatus || {},
    ...extra,
  };
}

async function fetchLatestAgentSnapshot(supabase) {
  const { data, error } = await supabase
    .from('heidi_state_snapshots')
    .select('id, captured_at, payload, cycle_id')
    .eq('source', SNAPSHOT_SOURCE)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function insertAgentSnapshot(supabase, payload, cycleId) {
  const { error } = await supabase.from('heidi_state_snapshots').insert({
    source: SNAPSHOT_SOURCE,
    cycle_id: cycleId || payload.instance_id || randomUUID(),
    captured_at: new Date().toISOString(),
    payload,
  });
  if (error) throw new Error(error.message);
}

/**
 * After the first heartbeat write, re-read latest. A live peer wins the race.
 */
async function confirmSnapshotLeaseAfterClaim(supabase, holder, instanceId, intervalMs) {
  const latest = await fetchLatestAgentSnapshot(supabase);
  if (
    shouldYieldLease({
      latestRow: latest,
      holder,
      instanceId,
      intervalMs,
    })
  ) {
    return { ok: false, reason: 'live_peer_heartbeat' };
  }
  return { ok: true, latest };
}

function envAllowExec(env = process.env) {
  return env.HEIDI_ALLOW_EXEC === 'true' || env.HEIDI_ALLOW_EXEC === '1';
}

function createAgentHealthServer(getStatus, env = process.env) {
  const host = env.HEIDI_BIND_HOST || '127.0.0.1';
  const port = agentHealthPort();

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/health/')) {
      const body = getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(
        JSON.stringify({
          lease_held: body.lease_held,
          last_cycle_at: body.last_cycle_at,
          cycles: body.cycles,
          allow_exec: body.allow_exec,
        })
      );
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, host, () => resolve({ host, port }));
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
    port,
    host,
  };
}

module.exports = {
  SNAPSHOT_SOURCE,
  DEFAULT_AGENT_PORT,
  DEFAULT_ADVISOR_MODEL,
  advisorModelName,
  assertAllowedAdvisorModel,
  evaluateExecTripleGate,
  advisorAutoApprove,
  cycleIntervalMs,
  reflectEveryNCycles,
  agentHealthPort,
  parseHeartbeat,
  shouldYieldLease,
  boundsRowUsable,
  buildHeartbeatPayload,
  fetchLatestAgentSnapshot,
  insertAgentSnapshot,
  createAgentHealthServer,
  confirmSnapshotLeaseAfterClaim,
  envAllowExec,
};