'use strict';
// Deterministic ops-agent tests — a fake memory store (same interface as
// HeidiMemory's run/get/all/createMission/getMission/getMissions), fake
// probe results, and a temp sqlite-free path. No real spawns, no network.

const OpsAgent = require('../../heidi-core/ops/ops-agent');
const OpsStore = require('../../heidi-core/ops/ops-store');
const { runOpsCommand, isOpsQuery, parseOpsCommand } = require('../../heidi-core/ops/ops-commands');

function fakeMemory() {
  const tables = { ops_incidents: [], ops_events: [], ops_leases: [], ops_control: [], missions: [], mission_events: [] };
  let mid = 0;
  return {
    _t: tables,
    async run(sql, params = []) {
      if (/CREATE TABLE/.test(sql)) return {};
      if (/INSERT INTO ops_incidents/.test(sql)) tables.ops_incidents.push({ id: params[0], signature: params[1], component: params[2], kind: params[3], state: 'open', mode: params[4], observation: params[5], confirmed: 0, opened_at: params[6], updated_at: params[7] });
      else if (/INSERT INTO ops_events/.test(sql)) tables.ops_events.push({ id: tables.ops_events.length + 1, incident_id: params[0], kind: params[1], actor: params[2], reason: params[3], data: params[4], at: params[5] });
      else if (/INSERT INTO ops_leases|ON CONFLICT\(resource\)/.test(sql)) {
        const i = tables.ops_leases.findIndex((l) => l.resource === params[0]);
        const row = { resource: params[0], owner: params[1], generation: params[2], expires_at: params[3], updated_at: params[4] };
        if (i >= 0) tables.ops_leases[i] = row; else tables.ops_leases.push(row);
      } else if (/UPDATE ops_leases/.test(sql)) {
        const l = tables.ops_leases.find((x) => x.resource === params[2] && x.owner === params[3] && x.generation === params[4]);
        if (l) { l.expires_at = params[0]; l.updated_at = params[1]; }
      } else if (/DELETE FROM ops_leases/.test(sql)) {
        const i = tables.ops_leases.findIndex((l) => l.resource === params[0] && l.owner === params[1] && l.generation === params[2]);
        if (i >= 0) tables.ops_leases.splice(i, 1);
      } else if (/INSERT INTO ops_control|ON CONFLICT\(key\)/.test(sql)) {
        const i = tables.ops_control.findIndex((c) => c.key === params[0]);
        const row = { key: params[0], value: params[1], updated_at: params[2] };
        if (i >= 0) tables.ops_control[i] = row; else tables.ops_control.push(row);
      } else if (/UPDATE ops_incidents/.test(sql)) {
        const inc = tables.ops_incidents.find((x) => x.id === params[15]);
        if (inc) Object.assign(inc, { state: params[0], observation: params[1], diagnosis: params[2], confirmed: params[3], hypothesis: params[4], owner: params[5], runbook: params[6], mission_id: params[7], authorization: params[8], attempts: params[9], updated_at: params[10], deadline_at: params[11], resolved_at: params[12], result: params[13], mode: params[14] });
      }
      return {};
    },
    async get(sql, params = []) {
      if (/FROM ops_incidents WHERE id/.test(sql)) return tables.ops_incidents.find((x) => x.id === params[0]) || null;
      if (/FROM ops_incidents WHERE signature/.test(sql)) return [...tables.ops_incidents].reverse().find((x) => x.signature === params[0] && !['resolved', 'closed', 'expired'].includes(x.state)) || null;
      if (/FROM ops_leases WHERE resource/.test(sql)) return tables.ops_leases.find((x) => x.resource === params[0]) || null;
      if (/FROM ops_control WHERE key/.test(sql)) return tables.ops_control.find((x) => x.key === params[0]) || null;
      return null;
    },
    async all(sql, params = []) {
      if (/FROM ops_incidents WHERE state IN/.test(sql)) return tables.ops_incidents.filter((x) => params.slice(0, -1).includes(x.state));
      if (/FROM ops_incidents WHERE state = \?/.test(sql)) return tables.ops_incidents.filter((x) => x.state === params[0]);
      if (/FROM ops_events WHERE incident_id/.test(sql)) return tables.ops_events.filter((e) => e.incident_id === params[0]);
      if (/FROM ops_events/.test(sql)) return tables.ops_events.slice(-params[0]);
      return [];
    },
    async createMission(goal, priority, context, agent, opts) {
      const id = ++mid;
      tables.missions.push({ id, goal, status: 'awaiting_approval', priority, context: JSON.stringify(context), assigned_agent: agent, created_at: new Date().toISOString() });
      return id;
    },
    async getMission(id) { return tables.missions.find((m) => m.id === id) || null; },
    async getMissions(status) { const s = Array.isArray(status) ? status : [status]; return tables.missions.filter((m) => s.includes(m.status)); },
  };
}

function agentWith(memory, opts = {}) {
  const cfg = require('path').join(require('os').tmpdir(), `ops-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  require('fs').writeFileSync(cfg, JSON.stringify({ modules: [] }));
  return new OpsAgent(memory, {}, Object.assign({
    configPath: cfg, extraModules: [{ id: 'fixture-svc', healthUrl: 'http://127.0.0.1:34455/health' }],
    intervalMs: 999999, debounceFailures: 2, log: () => {},
  }, opts));
}

const probeDown = () => async () => 'down';
const probeUp = () => async () => 'up';

describe('ops agent — observation and incidents', () => {
  it('creates an incident only after debounce, and it is not classified on a single failure', async () => {
    const mem = fakeMemory(); const a = agentWith(mem, { probeFn: probeDown(), mode: 'observe' });
    await a.tick();
    expect(mem._t.ops_incidents.length).toBe(0); // one failure is not an incident
    await a.tick();
    expect(mem._t.ops_incidents.length).toBe(1);
    // observe mode diagnoses then escalates (repair identified, not proposed)
    expect(mem._t.ops_incidents[0].state).toBe('escalated');
  });

  it('awaiting_approval missions are never misclassified as failed or stuck', async () => {
    const mem = fakeMemory();
    mem._t.missions.push({ id: 9, status: 'awaiting_approval', context: JSON.stringify({ action: { timeout_ms: 1000 } }), started_at: new Date(Date.now() - 999999).toISOString() });
    const a = agentWith(mem, { probeFn: probeUp(), mode: 'observe' });
    const obs = await a.observe();
    expect(obs.find((o) => o.kind === 'stalled_mission')).toBeUndefined();
  });

  it('healthy recovery resolves an open incident', async () => {
    const mem = fakeMemory(); const a = agentWith(mem, { probeFn: probeDown(), mode: 'observe' });
    await a.tick(); await a.tick();
    expect(mem._t.ops_incidents.length).toBe(1);
    a.probeFn = probeUp();
    await a.tick();
    expect(mem._t.ops_incidents[0].state).toBe('resolved');
  });

  it('duplicate observations never open a second incident for the same signature', async () => {
    const mem = fakeMemory(); const a = agentWith(mem, { probeFn: probeDown(), mode: 'observe' });
    await a.tick(); await a.tick(); await a.tick();
    expect(mem._t.ops_incidents.length).toBe(1);
    expect(mem._t.ops_events.filter((e) => e.kind === 'incident_opened').length).toBe(1);
  });
});

describe('ops agent — leases', () => {
  it('two agents cannot both hold the lease', async () => {
    const mem = fakeMemory(); const s = new OpsStore(mem); await s.ready;
    const l1 = await s.claimLease('r', 'agent-A', 60000);
    const l2 = await s.claimLease('r', 'agent-B', 60000);
    expect(l1).toBeTruthy(); expect(l2).toBeNull(); // B fenced out
    expect(await s.verifyLease('r', 'agent-A', l1.generation)).toBe(true);
  });

  it('expired lease is claimable; stale owner action is refused by fencing', async () => {
    const mem = fakeMemory(); const s = new OpsStore(mem); await s.ready;
    const l1 = await s.claimLease('r', 'agent-A', -1000); // already expired
    const l2 = await s.claimLease('r', 'agent-B', 60000);
    expect(l2).toBeTruthy();
    expect(await s.verifyLease('r', 'agent-A', l1.generation)).toBe(false); // A can't act
    expect(await s.verifyLease('r', 'agent-B', l2.generation)).toBe(true);
  });
});

describe('ops agent — action policy', () => {
  it('observe mode never proposes a repair, only escalates with the runbook named', async () => {
    const mem = fakeMemory(); const a = agentWith(mem, { probeFn: probeDown(), mode: 'observe' });
    await a.tick(); await a.tick();
    const inc = mem._t.ops_incidents[0];
    expect(inc.state).toBe('escalated');
    expect(inc.runbook).toBe('restart_module');
    expect(mem._t.missions.length).toBe(0); // no repair mission in observe mode
  });

  it('approval mode proposes a mission that lands awaiting_approval', async () => {
    const mem = fakeMemory(); const a = agentWith(mem, { probeFn: probeDown(), mode: 'approval_required' });
    await a.tick(); await a.tick();
    const inc = mem._t.ops_incidents[0];
    expect(inc.state).toBe('proposed');
    expect(mem._t.missions.length).toBe(1);
    expect(mem._t.missions[0].status).toBe('awaiting_approval');
    const auth = JSON.parse(inc.authorization);
    expect(auth.basis).toBe('approval_required');
  });

  it('dedupes against a mission another producer already has in-flight', async () => {
    const mem = fakeMemory();
    mem._t.missions.push({ id: 7, status: 'awaiting_approval', context: JSON.stringify({ action: { type: 'run_script', args: ['fixture-svc'] } }) });
    const a = agentWith(mem, { probeFn: probeDown(), mode: 'approval_required' });
    await a.tick(); await a.tick();
    const inc = mem._t.ops_incidents[0];
    expect(inc.state).toBe('repairing'); // tracking existing mission 7
    expect(inc.mission_id).toBe(7);
    expect(mem._t.missions.length).toBe(1); // no duplicate
  });

  it('a completed repair mission + healthy re-probe resolves the incident', async () => {
    const mem = fakeMemory(); const a = agentWith(mem, { probeFn: probeDown(), mode: 'approval_required' });
    await a.tick(); await a.tick();
    const inc = mem._t.ops_incidents[0];
    mem._t.missions.find((m) => m.id === inc.mission_id).status = 'completed';
    a.probeFn = probeUp();
    await a.tick();
    const after = mem._t.ops_incidents[0];
    expect(after.state).toBe('resolved');
    const res = JSON.parse(after.result);
    expect(res.agent_verified).toBe(true);
  });

  it('a failed repair escalates and never blind-retries', async () => {
    const mem = fakeMemory(); const a = agentWith(mem, { probeFn: probeDown(), mode: 'approval_required' });
    await a.tick(); await a.tick();
    const inc = mem._t.ops_incidents[0];
    mem._t.missions.find((m) => m.id === inc.mission_id).status = 'failed';
    await a.tick(); await a.tick();
    expect(mem._t.ops_incidents[0].state).toBe('escalated');
    expect(mem._t.missions.length).toBe(1); // no retry mission
  });

  it('circuit breaker opens after consecutive failed repairs', async () => {
    const mem = fakeMemory(); const a = agentWith(mem, { probeFn: probeDown(), mode: 'approval_required', circuitThreshold: 1 });
    await a.tick(); await a.tick();
    const inc = mem._t.ops_incidents[0];
    mem._t.missions.find((m) => m.id === inc.mission_id).status = 'failed';
    await a.tick(); // -> escalated, streak=1
    mem._t.ops_incidents[0].state = 'diagnosed'; // simulate a new incident needing action
    await a.tick();
    expect(mem._t.ops_events.some((e) => /circuit breaker/.test(e.reason || ''))).toBe(true);
  });

  it('pause blocks new repair proposals but keeps observing', async () => {
    const mem = fakeMemory(); const a = agentWith(mem, { probeFn: probeDown(), mode: 'approval_required' });
    await a.store.setControl('paused', '1', 'operator');
    await a.tick(); await a.tick();
    expect(mem._t.ops_incidents.length).toBe(1); // still observing -> incident exists
    expect(mem._t.missions.length).toBe(0);       // but no repair proposed
    expect(mem._t.ops_incidents[0].state).toBe('diagnosed'); // not escalated either
  });
});

describe('ops agent — crash recovery', () => {
  it('reconciles a verifying incident against real mission state — no blind replay', async () => {
    const mem = fakeMemory();
    const s = new OpsStore(mem); await s.ready;
    mem._t.missions.push({ id: 5, status: 'completed', context: '{}' });
    await s.openIncident({ id: 'i1', signature: 'fixture-svc:module_down', component: 'fixture-svc', kind: 'module_down', mode: 'approval_required', observation: {} });
    await s.updateIncident('i1', { state: 'verifying', mission_id: 5 });
    const a = agentWith(mem, { probeFn: probeUp(), mode: 'observe' });
    await a.recover();
    const inc = mem._t.ops_incidents[0];
    expect(['verifying', 'resolved']).toContain(inc.state); // reconciled against mission truth
    expect(mem._t.missions.length).toBe(1); // nothing re-created
  });

  it('an incident whose repair mission is gone escalates as unknown — never replays', async () => {
    const mem = fakeMemory();
    const s = new OpsStore(mem); await s.ready;
    await s.openIncident({ id: 'i2', signature: 'x:y', component: 'x', kind: 'y', mode: 'approval_required', observation: {} });
    await s.updateIncident('i2', { state: 'repairing', mission_id: 99 });
    const a = agentWith(mem, { probeFn: probeUp(), mode: 'approval_required' });
    await a.recover();
    const inc = mem._t.ops_incidents[0];
    expect(inc.state).toBe('escalated');
    expect(inc.hypothesis).toMatch(/outcome unknown|not replaying/i);
  });
});

describe('ops agent — redaction + commands', () => {
  it('redacts secrets out of stored evidence', async () => {
    const mem = fakeMemory(); const s = new OpsStore(mem); await s.ready;
    await s.openIncident({ id: 'i3', signature: 'a:b', component: 'a', kind: 'b', mode: 'observe', observation: { note: 'sk_live_4eC39HqLyjWDarjtT1zdp7dc' } });
    expect(mem._t.ops_incidents[0].observation).not.toContain('sk_live_');
  });

  it('ops commands answer the operator questions from persisted evidence', async () => {
    const mem = fakeMemory(); const a = agentWith(mem, { probeFn: probeDown(), mode: 'observe' });
    await a.tick(); await a.tick();
    const status = await runOpsCommand(a, parseOpsCommand('ops status'));
    expect(status).toMatch(/open incidents: 1/);
    const list = await runOpsCommand(a, parseOpsCommand('ops incidents'));
    expect(list).toMatch(/fixture-svc/);
    const detail = await runOpsCommand(a, parseOpsCommand(`ops incident ${mem._t.ops_incidents[0].id}`));
    expect(detail).toMatch(/incident_opened/);
    const pause = await runOpsCommand(a, parseOpsCommand('ops pause'));
    expect(pause).toMatch(/PAUSED/);
    expect(isOpsQuery('ops status')).toBe(true);
    expect(isOpsQuery('not ops')).toBe(false);
  });
});
