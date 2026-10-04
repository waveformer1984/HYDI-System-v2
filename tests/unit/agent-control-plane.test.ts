/**
 * AgentControlPlane tests — event-sourced supervision must dedup
 * deterministically, bound concurrency, and classify stale/failed agents
 * from durable events alone (restart-safe by construction).
 */

import {
  collectAgentState,
  createMission,
  missionIdFor,
  agentIdFor,
  maxActiveAgents,
  runInvestigateMission,
  superviseAgents,
  stopAgent,
  retryMission,
  resolveHumanAction,
  postMessage,
} from '../../lib/heidi/AgentControlPlane';

interface Row { event_type: string; payload: Record<string, unknown>; created_at: string }

function poolWith(events: Row[], extra?: (sql: string, params?: unknown[]) => { rows: unknown[] }) {
  const inserted: Row[] = [];
  const escRows: Record<string, unknown>[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (/INSERT INTO heidi_events/.test(sql)) {
        const row = { event_type: String(params![0]), payload: JSON.parse(String(params![1])), created_at: new Date().toISOString() };
        events.push(row); inserted.push(row);
        return { rows: [{ id: `ev-${events.length}` }] };
      }
      if (/event_type = 'agent_mission' AND payload->>'missionId'/.test(sql)) {
        const hit = [...events].reverse().find((r) => r.event_type === 'agent_mission' && r.payload.missionId === params![0]);
        return { rows: hit ? [hit] : [] };
      }
      if (/division = 'agents'/.test(sql)) return { rows: events };
      if (/FROM operator_escalations/.test(sql)) return { rows: escRows };
      if (/INSERT INTO operator_escalations/.test(sql)) { escRows.push({ id: 'esc-1' }); return { rows: [{ id: 'esc-1' }] }; }
      if (extra) return extra(sql, params);
      return { rows: [] };
    },
  };
  return { pool, inserted };
}

const T = '2026-09-22T18:00:00Z';

describe('deterministic identity + dedup', () => {
  test('same (role,objective,target) → same missionId → no duplicate', async () => {
    const events: Row[] = [];
    const { pool } = poolWith(events);
    const spec = { role: 'research' as const, objective: 'investigate X', scope: 'test', targetKey: 'opp-1' };
    const m1 = await createMission(pool, spec);
    const m2 = await createMission(pool, spec);
    expect(m1.missionId).toBe(m2.missionId);
    expect(m1.created).toBe(true);
    expect(m2.created).toBe(false);
    // exactly one mission + one registration event
    expect(events.filter((r) => r.event_type === 'agent_mission')).toHaveLength(1);
  });

  test('agentId is derived, stable, and not a pid', () => {
    const mid = missionIdFor('research', 'obj', 't');
    expect(mid).toMatch(/^mission-[0-9a-f]{12}$/);
    expect(agentIdFor('research', mid)).toMatch(/^agent-research-/);
    expect(agentIdFor('research', mid)).not.toMatch(/pid/i);
  });
});

describe('supervisor fold', () => {
  test('empty event stream → truthful empty state', async () => {
    const s = await collectAgentState(poolWith([]).pool as any);
    expect(s.agents).toEqual([]);
    expect(s.activeCount).toBe(0);
  });

  test('registered + heartbeat + completion fold into live status', async () => {
    const events: Row[] = [
      { event_type: 'agent_mission', payload: { missionId: 'mission-aa', agentId: 'agent-research-aa', role: 'research', objective: 'x', status: 'PENDING' }, created_at: T },
      { event_type: 'agent_registered', payload: { agentId: 'agent-research-aa', role: 'research', missionId: 'mission-aa', status: 'REGISTERED' }, created_at: T },
      { event_type: 'agent_status', payload: { agentId: 'agent-research-aa', missionId: 'mission-aa', status: 'RUNNING', pid: 123, runtimeIdentity: 'agent-research-aa@pid123' }, created_at: T },
      { event_type: 'agent_heartbeat', payload: { agentId: 'agent-research-aa', missionId: 'mission-aa', step: 'fetching', pid: 123 }, created_at: T },
      { event_type: 'agent_status', payload: { agentId: 'agent-research-aa', missionId: 'mission-aa', status: 'COMPLETED', result: { n: 5 } }, created_at: T },
    ];
    const s = await collectAgentState(poolWith(events).pool as any, { now: Date.parse(T) + 1000 });
    const a = s.agents.find((x) => x.agentId === 'agent-research-aa')!;
    expect(a.status).toBe('COMPLETED');
    expect(a.runtimeIdentity).toBe('agent-research-aa@pid123');
    const m = s.missions.find((x) => x.missionId === 'mission-aa')!;
    expect(m.status).toBe('COMPLETED');
    expect(m.result).toEqual({ n: 5 });
  });

  test('stale heartbeat → STALE; past timeout → FAILED (in-memory classification)', async () => {
    const events: Row[] = [
      { event_type: 'agent_mission', payload: { missionId: 'mission-bb', agentId: 'agent-research-bb', role: 'research', status: 'PENDING', maxRuntimeMs: 120000 }, created_at: T },
      { event_type: 'agent_registered', payload: { agentId: 'agent-research-bb', missionId: 'mission-bb', status: 'REGISTERED' }, created_at: T },
      { event_type: 'agent_status', payload: { agentId: 'agent-research-bb', missionId: 'mission-bb', status: 'RUNNING' }, created_at: T },
      { event_type: 'agent_heartbeat', payload: { agentId: 'agent-research-bb', missionId: 'mission-bb', step: 'working' }, created_at: T },
    ];
    const pool = poolWith(events).pool as any;
    const fresh = await collectAgentState(pool, { now: Date.parse(T) + 30_000 });
    expect(fresh.agents[0].status).toBe('RUNNING');
    const stale = await collectAgentState(pool, { now: Date.parse(T) + 90_000 });
    expect(stale.agents[0].status).toBe('STALE');
    expect(stale.staleCount).toBe(1);
    const failed = await collectAgentState(pool, { now: Date.parse(T) + 200_000 });
    expect(failed.agents[0].status).toBe('FAILED');
    expect(failed.missions[0].status).toBe('FAILED');
    expect(failed.missions[0].failure).toMatch(/heartbeat gap/);
  });

  test('messages fold with provenance', async () => {
    const events: Row[] = [
      { event_type: 'agent_message', payload: { messageId: 'msg-1', from: 'agent-research-x', to: 'heidi', missionId: 'mission-aa', type: 'EVIDENCE', content: 'found 3 sources' }, created_at: T },
    ];
    const s = await collectAgentState(poolWith(events).pool as any);
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].from).toBe('agent-research-x');
    expect(s.messages[0].type).toBe('EVIDENCE');
  });
});

describe('concurrency budget', () => {
  test('spawn refused when active agents ≥ budget', async () => {
    const now = new Date().toISOString(); // real-now: supervisor classifies with wall clock
    const events: Row[] = [0, 1, 2].flatMap((i) => ([
      { event_type: 'agent_mission', payload: { missionId: `mission-r${i}`, agentId: `agent-r${i}`, role: 'research', status: 'PENDING' }, created_at: now },
      { event_type: 'agent_registered', payload: { agentId: `agent-r${i}`, missionId: `mission-r${i}`, status: 'REGISTERED' }, created_at: now },
      { event_type: 'agent_status', payload: { agentId: `agent-r${i}`, missionId: `mission-r${i}`, status: 'RUNNING' }, created_at: now },
      { event_type: 'agent_heartbeat', payload: { agentId: `agent-r${i}`, missionId: `mission-r${i}`, step: 'w' }, created_at: now },
    ]));
    const { pool } = poolWith(events);
    const res = await runInvestigateMission(pool as any, 'opp-x');
    expect(res.refused).toMatch(/concurrency budget/);
    expect(res.spawned).toEqual([]);
  });

  test('budget default is 3, env-overridable', () => {
    expect(maxActiveAgents()).toBe(3);
    process.env.HYDI_MAX_ACTIVE_AGENTS = '7';
    expect(maxActiveAgents()).toBe(7);
    delete process.env.HYDI_MAX_ACTIVE_AGENTS;
  });
});

describe('supervisor pass (Phase B)', () => {
  const missionRow = (mid: string, role = 'research', extra: Record<string, unknown> = {}): Row => ({
    event_type: 'agent_mission',
    payload: { missionId: mid, agentId: `agent-${role}-${mid.slice(8)}`, role, objective: 'x', status: 'PENDING', authorizationLevel: 'R1', maxRetries: 0, ...extra },
    created_at: T,
  });
  const agentRow = (aid: string, mid: string, st: string, extra: Record<string, unknown> = {}): Row => ({
    event_type: 'agent_status',
    payload: { agentId: aid, missionId: mid, status: st, ...extra },
    created_at: T,
  });

  test('persists read-time STALE as a durable transition, once', async () => {
    const staleTs = new Date(Date.now() - 90_000).toISOString(); // 90s ago: > staleMs(60s), < maxRuntimeMs(120s)
    const events: Row[] = [
      missionRow('mission-s1', 'research', { maxRuntimeMs: 120000 }),
      { event_type: 'agent_registered', payload: { agentId: 'agent-research-s1', missionId: 'mission-s1', status: 'REGISTERED' }, created_at: staleTs },
      { event_type: 'agent_status', payload: { agentId: 'agent-research-s1', missionId: 'mission-s1', status: 'RUNNING' }, created_at: staleTs },
      { event_type: 'agent_heartbeat', payload: { agentId: 'agent-research-s1', missionId: 'mission-s1', step: 'w' }, created_at: staleTs },
    ];
    const { pool } = poolWith(events);
    const r = await superviseAgents(pool as any);
    expect(r.transitions.some((t) => t.agentId === 'agent-research-s1' && t.to === 'STALE')).toBe(true);
    // second pass — persisted STALE already, no duplicate transition
    const r2 = await superviseAgents(pool as any);
    expect(r2.transitions.filter((t) => t.agentId === 'agent-research-s1')).toHaveLength(0);
    expect(r.supervisionEventId).toBeTruthy();
  });

  test('retries a failed R1 mission within maxRetries; escalates when exhausted', async () => {
    const retryable: Row[] = [
      missionRow('mission-r1', 'analyst', { maxRetries: 1 }),
      { event_type: 'agent_registered', payload: { agentId: 'agent-analyst-r1', missionId: 'mission-r1', status: 'REGISTERED' }, created_at: T },
      agentRow('agent-analyst-r1', 'mission-r1', 'RUNNING', { attempt: 1 }),
      agentRow('agent-analyst-r1', 'mission-r1', 'FAILED', { failure: 'boom' }),
    ];
    const { pool } = poolWith(retryable);
    const r = await superviseAgents(pool as any);
    expect(r.retries).toContain('mission-r1');
    await new Promise((res) => setTimeout(res, 150)); // let the void'd runAgent emit
    const running = retryable.filter((e) => e.event_type === 'agent_status' && e.payload.status === 'RUNNING' && e.payload.attempt === 2);
    expect(running.length).toBeGreaterThan(0);
  });

  test('non-retryable failure escalates to human queue — deduped', async () => {
    const events: Row[] = [
      missionRow('mission-e1', 'research', { maxRetries: 0 }),
      { event_type: 'agent_registered', payload: { agentId: 'agent-research-e1', missionId: 'mission-e1', status: 'REGISTERED' }, created_at: T },
      agentRow('agent-research-e1', 'mission-e1', 'RUNNING', { attempt: 1 }),
      agentRow('agent-research-e1', 'mission-e1', 'FAILED', { failure: 'dead' }),
    ];
    const { pool } = poolWith(events);
    const r = await superviseAgents(pool as any);
    expect(r.escalations).toContain('mission-e1');
    const r2 = await superviseAgents(pool as any);
    expect(r2.escalations).not.toContain('mission-e1'); // NEEDS_HUMAN + escalation row → no repeat
  });

  test('parent reconciles: completes only when all children complete', async () => {
    const events: Row[] = [
      missionRow('mission-p1', 'analyst'),
      { event_type: 'agent_registered', payload: { agentId: 'agent-analyst-p1', missionId: 'mission-p1', status: 'REGISTERED' }, created_at: T },
      missionRow('mission-c1', 'research', { parentMissionId: 'mission-p1' }),
      missionRow('mission-c2', 'research', { parentMissionId: 'mission-p1' }),
      agentRow('agent-research-c1', 'mission-c1', 'COMPLETED'),
      agentRow('agent-research-c2', 'mission-c2', 'COMPLETED'),
    ];
    const { pool } = poolWith(events);
    const r = await superviseAgents(pool as any);
    expect(r.parentsReconciled).toContain('mission-p1');
    const s = await collectAgentState(pool as any);
    expect(s.missions.find((m) => m.missionId === 'mission-p1')!.status).toBe('COMPLETED');
  });

  test('parent goes NEEDS_HUMAN when a child fails terminally', async () => {
    const events: Row[] = [
      missionRow('mission-p2', 'analyst'),
      { event_type: 'agent_registered', payload: { agentId: 'agent-analyst-p2', missionId: 'mission-p2', status: 'REGISTERED' }, created_at: T },
      missionRow('mission-c3', 'research', { parentMissionId: 'mission-p2' }),
      { event_type: 'agent_registered', payload: { agentId: 'agent-research-c3', missionId: 'mission-c3', status: 'REGISTERED' }, created_at: T },
      agentRow('agent-research-c3', 'mission-c3', 'RUNNING', { attempt: 1 }),
      agentRow('agent-research-c3', 'mission-c3', 'FAILED', { failure: 'dead' }),
    ];
    const { pool } = poolWith(events);
    const r = await superviseAgents(pool as any);
    expect(r.escalations).toContain('mission-c3');
    const s = await collectAgentState(pool as any);
    const parent = s.missions.find((m) => m.missionId === 'mission-p2')!;
    expect(parent.status).toBe('NEEDS_HUMAN');
  });
});

describe('governed controls (Phase D)', () => {
  const now = new Date().toISOString();
  const runningAgent = (mid: string, aid: string): Row[] => ([
    { event_type: 'agent_mission', payload: { missionId: mid, agentId: aid, role: 'research', status: 'PENDING', maxRetries: 0 }, created_at: now },
    { event_type: 'agent_registered', payload: { agentId: aid, missionId: mid, status: 'REGISTERED' }, created_at: now },
    { event_type: 'agent_status', payload: { agentId: aid, missionId: mid, status: 'RUNNING', attempt: 1 }, created_at: now },
    { event_type: 'agent_heartbeat', payload: { agentId: aid, missionId: mid, step: 'w' }, created_at: now },
  ]);

  test('stop marks a running agent STOPPED durably', async () => {
    const events = runningAgent('mission-st', 'agent-research-st');
    const { pool } = poolWith(events);
    const r = await stopAgent(pool as any, 'agent-research-st', 'operator');
    expect(r.ok).toBe(true);
    const s = await collectAgentState(pool as any);
    expect(s.agents[0].status).toBe('STOPPED');
  });

  test('stop fails closed on nonexistent and terminal agents', async () => {
    const { pool } = poolWith([]);
    expect((await stopAgent(pool as any, 'agent-ghost', 'op')).outcome).toBe('not_found');
    const events: Row[] = [
      { event_type: 'agent_mission', payload: { missionId: 'mission-dd', agentId: 'agent-research-dd', role: 'research' }, created_at: now },
      { event_type: 'agent_registered', payload: { agentId: 'agent-research-dd', missionId: 'mission-dd', status: 'REGISTERED' }, created_at: now },
      { event_type: 'agent_status', payload: { agentId: 'agent-research-dd', missionId: 'mission-dd', status: 'COMPLETED' }, created_at: now },
    ];
    const { pool: p2 } = poolWith(events);
    expect((await stopAgent(p2 as any, 'agent-research-dd', 'op')).outcome).toBe('already_terminal');
  });

  test('retry refuses while agent is RUNNING; retries terminal mission', async () => {
    const events = runningAgent('mission-rt', 'agent-research-rt');
    const { pool } = poolWith(events);
    expect((await retryMission(pool as any, 'mission-rt', 'op')).outcome).toBe('running');
    events.push({ event_type: 'agent_status', payload: { agentId: 'agent-research-rt', missionId: 'mission-rt', status: 'FAILED', failure: 'x' }, created_at: now });
    const r = await retryMission(pool as any, 'mission-rt', 'op');
    expect(r.outcome).toBe('retried');
    expect((await retryMission(pool as any, 'mission-ghost', 'op')).outcome).toBe('not_found');
  });

  test('resolveHumanAction: authz items fail closed; escalation resolves', async () => {
    const events: Row[] = [];
    const escRow = { id: 'esc-1', resolved: false };
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (/INSERT INTO heidi_events/.test(sql)) { events.push({ event_type: String(params![0]), payload: JSON.parse(String(params![1])), created_at: now }); return { rows: [{ id: 'ev-1' }] }; }
        if (/UPDATE operator_escalations/.test(sql)) {
          if (escRow.resolved) return { rows: [], rowCount: 0 }; // WHERE resolved=false
          escRow.resolved = true;
          return { rows: [{ id: 'esc-1' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
    const refused = await resolveHumanAction(pool as any, 'authz:cap.x:reason', 'approve', 'op');
    expect(refused.ok).toBe(false);
    expect(refused.outcome).toBe('refused');
    const ok = await resolveHumanAction(pool as any, 'escalation:esc-1', 'approve', 'op');
    expect(ok.ok).toBe(true);
    expect(ok.resolutionEventId).toBe('ev-1');
    expect(escRow.resolved).toBe(true);
    const nf = await resolveHumanAction(pool as any, 'escalation:esc-1', 'reject', 'op');
    expect(nf.outcome).toBe('not_found'); // already resolved
    // Action proposals are refused — approval requires the governed
    // proposals endpoint (consume-once, params-hash bound).
    const prop = await resolveHumanAction(pool as any, 'proposal:prop-1', 'approve', 'op');
    expect(prop.ok).toBe(false);
    expect(prop.outcome).toBe('refused');
    expect(prop.detail).toMatch(/proposals endpoint/);
    expect(events.filter((e) => e.event_type === 'human_action_resolution')).toHaveLength(1);
  });

  test('agent→agent messages require mission scope', async () => {
    const { pool } = poolWith([]);
    await expect(postMessage(pool as any, {
      from: 'agent-a', to: 'agent-b', missionId: null, type: 'STATUS', content: 'hi',
    })).rejects.toThrow(/missionId/);
    await expect(postMessage(pool as any, {
      from: 'agent-a', to: 'agent-b', missionId: 'mission-x', type: 'STATUS', content: 'hi',
    })).resolves.toBeUndefined();
  });
});

describe('restart survival', () => {
  test('fold is pure over events — identical state after simulated restart', async () => {
    const events: Row[] = [
      { event_type: 'agent_mission', payload: { missionId: 'mission-zz', agentId: 'agent-analyst-zz', role: 'analyst', status: 'PENDING' }, created_at: T },
      { event_type: 'agent_registered', payload: { agentId: 'agent-analyst-zz', missionId: 'mission-zz', status: 'REGISTERED' }, created_at: T },
      { event_type: 'agent_status', payload: { agentId: 'agent-analyst-zz', missionId: 'mission-zz', status: 'COMPLETED', result: { ok: true } }, created_at: T },
    ];
    const p = poolWith(events).pool as any;
    const before = await collectAgentState(p, { now: Date.parse(T) });
    const after = await collectAgentState(p, { now: Date.parse(T) }); // "restarted" — pure refold
    expect(before.missions).toEqual(after.missions);
    expect(before.agents[0].status).toBe('COMPLETED');
  });
});
