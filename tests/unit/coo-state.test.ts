/**
 * CooState tests — hermetic; reconcile + pool injected.
 *
 * The selector must be deterministic and explainable: deployment truth
 * first, then pending human gates, then fresh incidents, then nothing.
 * It must never manufacture work.
 */

import { collectCooState, selectNextAction, type CooState } from '../../lib/heidi/CooState';
import type { ReconciliationReport } from '../../lib/heidi/DeploymentReconciliation';

function recon(verdict: ReconciliationReport['verdict'], health = 'HEALTHY'): ReconciliationReport {
  return {
    verdict,
    deploymentIdentity: verdict === 'QUALIFIED' ? 'VALID' : verdict === 'DEPLOYMENT_DRIFT' ? 'INVALID' : 'UNPROVEN',
    applicationHealth: health as ReconciliationReport['applicationHealth'],
    predicates: {},
    failures: verdict === 'DEPLOYMENT_DRIFT' ? ['PID_MATCHES'] : [],
    expected: { commit: 'abc1234', pm2Pid: 100, pm2Status: 'online', pm2Cwd: 'C:\\repo', pm2Restarts: 1 },
    actual: {
      lockPid: 200, lockCommit: 'abc1234', lockCwd: 'C:\\repo', lockStartedAt: 't', lockAlive: true,
      cyclePid: 200, cycleCommit: 'abc1234', cycleAt: 'now',
    },
  };
}

interface Counts {
  goalsOpen?: number; goalsInProgress?: number;
  escalationsOpen?: number; escalationsNew24h?: number;
  interventionsPending?: number; authEscalations24h?: number;
  interventionRows?: Record<string, unknown>[];
  authzRows?: Record<string, unknown>[];
  freshEscalationRows?: Record<string, unknown>[];
  backlogRows?: Record<string, unknown>[];
  protoRun?: { run_at: Date; status: string } | null;
  protoOpps?: { pending: number; approved: number; total: number };
  revenueOpps?: number;
  events?: Array<{ event_type: string; n: string }>;
}

function makePool(c: Counts) {
  const calls: string[] = [];
  return {
    calls,
    query: async (sql: string) => {
      calls.push(sql.slice(0, 80));
      // Human-action queue queries (run before the scalar counts)
      if (/FROM human_intervention_requests/.test(sql) && /request_id/.test(sql))
        return { rows: c.interventionRows ?? [] };
      if (/authorization_escalation/.test(sql) && /GROUP BY 1, 2, 3/.test(sql))
        return { rows: c.authzRows ?? [] };
      if (/FROM operator_escalations/.test(sql) && /action_required/.test(sql))
        return { rows: c.freshEscalationRows ?? [] };
      if (/FROM operator_escalations/.test(sql) && /GROUP BY category/.test(sql))
        return { rows: c.backlogRows ?? [] };
      if (/heidi_goals/.test(sql) && /in_progress/.test(sql)) return { rows: [{ n: c.goalsInProgress ?? 0 }] };
      if (/heidi_goals/.test(sql)) return { rows: [{ n: c.goalsOpen ?? 0 }] };
      if (/operator_escalations/.test(sql) && /24 hours/.test(sql)) return { rows: [{ n: c.escalationsNew24h ?? 0 }] };
      if (/operator_escalations/.test(sql)) return { rows: [{ n: c.escalationsOpen ?? 0 }] };
      if (/human_intervention_requests/.test(sql)) return { rows: [{ n: c.interventionsPending ?? 0 }] };
      if (/authorization_escalation/.test(sql)) return { rows: [{ n: c.authEscalations24h ?? 0 }] };
      if (/protoforge_mission_runs/.test(sql)) return { rows: c.protoRun ? [c.protoRun] : [] };
      if (/protoforge_opportunities/.test(sql)) return { rows: [c.protoOpps ?? { pending: 0, approved: 0, total: 0 }] };
      if (/revenue_opportunities/.test(sql)) return { rows: [{ n: c.revenueOpps ?? 0 }] };
      if (/GROUP BY event_type/.test(sql)) return { rows: c.events ?? [] };
      return { rows: [] };
    },
  };
}

function collect(counts: Counts, report = recon('QUALIFIED')) {
  return collectCooState({
    pool: makePool(counts) as any,
    repoDir: 'C:\\repo',
    reconcile: async () => report,
  });
}

describe('ops.coo_state collection + selection', () => {
  test('healthy system → NO_ACTION_REQUIRED with explainable reason', async () => {
    const s = await collect({});
    expect(s.deployment.identity).toBe('VALID');
    expect(s.nextAction.kind).toBe('none');
    expect(s.nextAction.reason).toMatch(/no authorized work/i);
    expect(s.briefing).toContain('HYDI COO BRIEF');
    expect(s.briefing).toContain('Deployment:');
  });

  test('deployment drift → selects ops.recover_daemon_r0 (capability)', async () => {
    const s = await collect({}, recon('DEPLOYMENT_DRIFT'));
    expect(s.nextAction.kind).toBe('capability');
    expect(s.nextAction.capabilityId).toBe('ops.recover_daemon_r0');
    expect(s.nextAction.reason).toContain('PID_MATCHES');
  });

  test('deployment UNKNOWN → selects ops.reconcile_deployment', async () => {
    const s = await collect({}, recon('UNKNOWN'));
    expect(s.nextAction.kind).toBe('capability');
    expect(s.nextAction.capabilityId).toBe('ops.reconcile_deployment');
  });

  test('pending interventions → human action, not autonomous work', async () => {
    const s = await collect({
      interventionRows: [
        { id: 'i1', request_id: 'req-1', objective: 'do X', blocker: 'missing cred', required_action: 'provision key', intervention_type: 'credential', status: 'pending', created_at: new Date(), updated_at: new Date() },
        { id: 'i2', request_id: 'req-2', objective: 'do Y', blocker: 'needs ok', required_action: 'approve', intervention_type: 'approval', status: 'pending', created_at: new Date(), updated_at: new Date() },
      ],
    });
    expect(s.nextAction.kind).toBe('human');
    expect(s.nextAction.reason).toMatch(/2 pending human action/);
    expect(s.humanActions.open).toBe(2);
  });

  test('fresh escalations → human; historical backlog alone does not select work', async () => {
    const stale = await collect({
      backlogRows: [{ category: 'stuck_job', n: '6721', oldest: new Date('2026-08-01'), newest: new Date('2026-09-21') }],
    });
    expect(stale.nextAction.kind).toBe('none'); // backlog reported, never selected
    expect(stale.humanActions.backlogRowCount).toBe(6721);
    const fresh = await collect({
      freshEscalationRows: [
        { id: 'e1', category: 'stuck_job', severity: 'high', title: 'job stuck 5h', action_required: 'inspect', created_at: new Date() },
      ],
    });
    expect(fresh.nextAction.kind).toBe('human');
  });

  test('authorization escalations aggregate into pending capability decisions', async () => {
    const s = await collect({
      authzRows: [{ cap: 'revenue.start_onboarding', reason: 'requires autonomy 3', risk: 'R2', n: '421', earliest: new Date('2026-09-20'), latest: new Date('2026-09-21') }],
    });
    expect(s.humanActions.open).toBe(1);
    expect(s.humanActions.items[0].id).toContain('authz:revenue.start_onboarding');
    expect(s.humanActions.items[0].evidence.occurrences).toBe(421);
    expect(s.nextAction.kind).toBe('human');
  });

  test('drift outranks interventions (runtime truth first)', async () => {
    const s = await collect({
      interventionRows: [{ id: 'i1', request_id: 'req-1', blocker: 'x', required_action: 'y', intervention_type: 't', status: 'pending', created_at: new Date(), updated_at: new Date() }],
    }, recon('DEPLOYMENT_DRIFT'));
    expect(s.nextAction.kind).toBe('capability');
  });

  test('protoforge + revenue surfaces populate from real rows', async () => {
    const s = await collect({
      protoRun: { run_at: new Date('2026-09-22T14:00:00Z'), status: 'success' },
      protoOpps: { pending: 30, approved: 2, total: 81 },
      revenueOpps: 2,
    });
    expect(s.protoforge.opportunitiesTotal).toBe(81);
    expect(s.protoforge.pendingReview).toBe(30);
    expect(s.revenue.opportunitiesOpen).toBe(2);
    expect(s.briefing).toContain('pending review');
  });

  test('selectNextAction is pure and deterministic', () => {
    const base = {
      generatedAt: 't',
      deployment: { verdict: 'QUALIFIED', identity: 'VALID', expectedCommit: 'a', actualCommit: 'a', pm2Pid: 1, daemonPid: 2, failures: [] },
      applicationHealth: 'HEALTHY',
      work: { goalsOpen: 0, goalsInProgress: 0, escalationsOpen: 0, escalationsNew24h: 0, interventionsPending: 0, authEscalations24h: 0 },
      humanActions: { open: 0, backlogRowCount: 0, items: [] },
      agents: { active: 0, stale: 0, missionsByStatus: {}, recent: [] },
      protoforge: { lastRunAt: null, lastRunStatus: null, opportunitiesTotal: 0, pendingReview: 0, approved: 0 },
      revenue: { opportunitiesOpen: 0 },
      events24h: {},
    } as Omit<CooState, 'nextAction' | 'briefing'>;
    expect(selectNextAction(base)).toEqual(selectNextAction(base));
  });
});
