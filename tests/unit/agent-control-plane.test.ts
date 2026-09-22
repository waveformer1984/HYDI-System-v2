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
} from '../../lib/heidi/AgentControlPlane';

interface Row { event_type: string; payload: Record<string, unknown>; created_at: string }

function poolWith(events: Row[], extra?: (sql: string, params?: unknown[]) => { rows: unknown[] }) {
  const inserted: Row[] = [];
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
    const events: Row[] = [0, 1, 2].flatMap((i) => ([
      { event_type: 'agent_mission', payload: { missionId: `mission-r${i}`, agentId: `agent-r${i}`, role: 'research', status: 'PENDING' }, created_at: T },
      { event_type: 'agent_registered', payload: { agentId: `agent-r${i}`, missionId: `mission-r${i}`, status: 'REGISTERED' }, created_at: T },
      { event_type: 'agent_status', payload: { agentId: `agent-r${i}`, missionId: `mission-r${i}`, status: 'RUNNING' }, created_at: T },
      { event_type: 'agent_heartbeat', payload: { agentId: `agent-r${i}`, missionId: `mission-r${i}`, step: 'w' }, created_at: T },
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
