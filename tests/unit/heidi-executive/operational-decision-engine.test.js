/**
 * HEIDI Operational Decision Engine unit tests
 */

const { OperationalState } = require('../../../src/heidi-executive/OperationalState');
const { IncidentCorrelator } = require('../../../src/heidi-executive/IncidentCorrelator');
const { ImpactAssessor, IMPACT_LEVELS } = require('../../../src/heidi-executive/ImpactAssessor');
const { ActionSelector } = require('../../../src/heidi-executive/ActionSelector');
const { AutonomyPolicy } = require('../../../src/heidi-executive/AutonomyPolicy');
const { MissionEngine } = require('../../../src/heidi-executive/MissionEngine');
const { PredictiveIntelligence } = require('../../../src/heidi-executive/PredictiveIntelligence');
const { MaintenanceMode } = require('../../../src/heidi-executive/MaintenanceMode');
const { HeidiDecisionEngine } = require('../../../src/heidi-executive/HeidiDecisionEngine');

describe('OperationalState', () => {
  test('starts in a valid state', () => {
    const s = new OperationalState('STABLE');
    expect(s.current().state).toBe('STABLE');
  });

  test('rejects invalid states', () => {
    expect(() => new OperationalState('BROKEN')).toThrow('Invalid operational state');
  });

  test('records every transition with metadata', () => {
    const s = new OperationalState('STABLE');
    s.transition('DEGRADED', { source: 'test', reason: 'probe failed', confidence: 0.9 });
    const history = s.getHistory();
    expect(history[history.length - 1].to).toBe('DEGRADED');
    expect(history[history.length - 1].confidence).toBe(0.9);
  });

  test('disallows invalid transitions', () => {
    const s = new OperationalState('STABLE');
    expect(() => s.transition('RECOVERING')).toThrow('Disallowed transition');
  });
});

describe('IncidentCorrelator', () => {
  const graph = {
    'docker-stack': ['docker-daemon'],
    'next-app': ['docker-stack'],
    'heidi-bridge': ['docker-stack'],
    'heidi-mobile': [],
    'forge-loop': ['heidi-bridge'],
  };

  test('groups Docker root cause with downstream symptoms', () => {
    const c = new IncidentCorrelator({ dependencyGraph: graph });
    const obs = {
      'docker-daemon': { status: 'UNAVAILABLE', detail: 'docker daemon not reachable' },
      'postgres-compose': { status: 'UNAVAILABLE', detail: 'down' },
      'redis-compose': { status: 'UNAVAILABLE', detail: 'down' },
      'next-app': { status: 'UNAVAILABLE', detail: 'timeout' },
      'heidi-bridge': { status: 'UNAVAILABLE', detail: 'timeout' },
    };

    const r = c.correlate(obs);
    expect(r.roots.length).toBeGreaterThanOrEqual(1);
    const root = r.roots.find(x => x.component === 'docker-daemon');
    expect(root).toBeDefined();
    expect(root.failure_class).toBe('DOCKER_RUNTIME_FAILURE');
    expect(root.affected.some(a => a.component === 'next-app')).toBe(true);
    expect(r.symptoms['next-app']).toBe('docker-daemon');
  });

  test('creates separate root incidents for unrelated failures', () => {
    const c = new IncidentCorrelator({ dependencyGraph: graph });
    const obs = {
      'heidi-mobile': { status: 'UNAVAILABLE', detail: 'crashed' },
      'memory-engine': { status: 'UNAVAILABLE', detail: 'port in use' },
    };
    const r = c.correlate(obs);
    expect(r.roots.length).toBe(2);
    expect(r.roots.some(x => x.component === 'heidi-mobile')).toBe(true);
    expect(r.roots.some(x => x.component === 'memory-engine')).toBe(true);
  });
});

describe('ImpactAssessor', () => {
  const graph = { 'heidi-bridge': ['docker-stack'], 'next-app': ['docker-stack'] };

  test('ranks Postgres unavailable as high due to data integrity', () => {
    const a = new ImpactAssessor({ dependencyGraph: graph });
    const impact = a.assess('postgres-compose', { status: 'UNAVAILABLE', detail: 'down' });
    expect(IMPACT_LEVELS.includes(impact.impact)).toBe(true);
    expect(impact.factors).toContain('data integrity risk');
  });

  test('optional degraded service is lower impact', () => {
    const a = new ImpactAssessor({ dependencyGraph: graph });
    const impact = a.assess('heidi-mobile', { status: 'DEGRADED', detail: 'slow' });
    expect(['LOW', 'MEDIUM', 'HIGH']).toContain(impact.impact);
  });
});

describe('ActionSelector', () => {
  test('prefers low-risk, reversible actions with good history', () => {
    const selector = new ActionSelector({
      history: [
        { action: 'restart-protohub', success: true, timestamp: Date.now() },
        { action: 'restart-protohub', success: true, timestamp: Date.now() },
        { action: 'restart-protohub', success: false, timestamp: Date.now() },
      ],
    });
    const candidates = [
      { id: 'restart-protohub', capabilityId: 'docker.local', blastRadius: 1 },
      { id: 'rebuild-protohub', capabilityId: 'build.run', blastRadius: 3 },
    ];
    const registry = {
      get: (id) => ({ riskLevel: id === 'docker.local' ? 'MEDIUM' : 'LOW', reversible: true }),
    };
    const result = selector.select(candidates, { registry, dependencies: { 'docker-daemon': 'HEALTHY' } });
    expect(result.selected.action).toBe('restart-protohub');
  });

  test('rejects actions under maintenance', () => {
    const selector = new ActionSelector();
    const result = selector.score(
      { id: 'restart-next', capabilityId: 'docker.local' },
      { maintenance: true }
    );
    expect(result.score).toBeLessThan(0);
  });
});

describe('AutonomyPolicy', () => {
  test('read health is L0', () => {
    const p = new AutonomyPolicy();
    expect(p.levelFor('health.read')).toBe('L0_OBSERVE');
  });

  test('destructive database is forbidden', () => {
    const p = new AutonomyPolicy();
    expect(p.canExecute('database.destructive').ok).toBe(false);
    expect(p.levelFor('database.destructive')).toBe('FORBIDDEN');
  });

  test('database operations require approval', () => {
    const p = new AutonomyPolicy();
    expect(p.canExecute('database.local').ok).toBe(false);
    expect(p.canExecute('database.local', true).ok).toBe(true);
  });
});

describe('MissionEngine', () => {
  test('executes a bounded mission and records evidence', async () => {
    const engine = new MissionEngine({ missionTimeoutMs: 10000, cooldownMs: 0 });
    const mission = {
      id: 'm1',
      objective: 'restart protohub',
      steps: [
        { capabilityId: 'docker.local', parameters: { operation: 'restart', resource: 'protohub' } },
      ],
    };
    const executor = jest.fn(async () => ({ ok: true }));
    const verifier = jest.fn(async () => true);
    const result = await engine.execute(mission, executor, verifier);
    expect(result.status).toBe('SUCCESS');
    expect(executor).toHaveBeenCalledTimes(1);
    expect(verifier).toHaveBeenCalledTimes(1);
  });

  test('stops after unauthorized step', async () => {
    const engine = new MissionEngine({ cooldownMs: 0 });
    const mission = {
      id: 'm2',
      objective: 'restart database',
      steps: [
        { capabilityId: 'database.destructive' },
      ],
    };
    const result = await engine.execute(mission, async () => ({}), async () => true);
    expect(result.status).toBe('UNAUTHORIZED');
  });

  test('respects max actions', async () => {
    const engine = new MissionEngine({ maxActions: 1, cooldownMs: 0 });
    const mission = {
      id: 'm3',
      objective: 'multi-step',
      steps: [
        { capabilityId: 'health.read' },
        { capabilityId: 'health.read' },
      ],
    };
    const result = await engine.execute(mission, async () => ({}), async () => true);
    expect(result.status).toBe('MAX_ACTIONS');
  });
});

describe('PredictiveIntelligence', () => {
  test('warns on restart spike', () => {
    const p = new PredictiveIntelligence({ restartThreshold: 3 });
    const now = Date.now();
    const history = Array.from({ length: 5 }, (_, i) => ({
      timestamp: now - i * 60000,
      event: 'restart',
    }));
    const r = p.analyze('supabase_vector', history);
    expect(r.warnings.some(w => w.type === 'RESTART_SPIKE')).toBe(true);
  });

  test('warns on latency regression', () => {
    const now = Date.now();
    const p = new PredictiveIntelligence({ latencyThreshold: 1.5, timeWindowMs: 10000 });
    const history = [
      { timestamp: now - 25000, event: 'recovery', latencyMs: 1000 },
      { timestamp: now - 20000, event: 'recovery', latencyMs: 1000 },
      { timestamp: now - 5000, event: 'recovery', latencyMs: 2000 },
      { timestamp: now, event: 'recovery', latencyMs: 3000 },
    ];
    const r = p.analyze('next-app', history);
    expect(r.warnings.some(w => w.type === 'LATENCY_REGRESSION')).toBe(true);
  });
});

describe('MaintenanceMode', () => {
  test('suppresses expected incident', () => {
    const m = new MaintenanceMode();
    m.start({ id: 'mnt1', scope: ['next-app'], expectedDurationMs: 3600000, reason: 'deploy' });
    expect(m.isUnderMaintenance('next-app').active).toBe(true);
    expect(m.isUnderMaintenance('memory-engine').active).toBe(false);
  });

  test('expires after duration', () => {
    const m = new MaintenanceMode();
    m.start({ id: 'mnt2', scope: ['*'], startTime: new Date(Date.now() - 4000000).toISOString(), expectedDurationMs: 3600000 });
    expect(m.list().length).toBe(0);
  });
});

describe('HeidiDecisionEngine', () => {
  test('produces decision record with correlated root cause', async () => {
    const engine = new HeidiDecisionEngine({
      dependencyGraph: {
        'next-app': ['docker-stack'],
        'heidi-bridge': ['docker-stack'],
      },
      dataDir: null,
    });
    const observations = {
      'docker-daemon': { status: 'UNAVAILABLE', detail: 'cannot connect' },
      'next-app': { status: 'UNAVAILABLE', detail: 'timeout' },
      'heidi-bridge': { status: 'UNAVAILABLE', detail: 'timeout' },
    };
    const candidates = [
      { id: 'restart-docker', capabilityId: 'docker.local', allowedComponents: ['docker-daemon'], blastRadius: 4 },
      { id: 'restart-next', capabilityId: 'health.recover', allowedComponents: ['next-app'], blastRadius: 1 },
    ];
    const result = await engine.decide(observations, candidates, { execute: false });
    expect(result.correlated.roots.some(r => r.component === 'docker-daemon')).toBe(true);
    expect(result.decisions.length).toBeGreaterThan(0);
    expect(result.decisions[0].selected_action).not.toBeNull();
  });

  test('escalates forbidden action', async () => {
    const engine = new HeidiDecisionEngine({ dataDir: null });
    const observations = { 'supabase-db-container': { status: 'UNAVAILABLE', detail: 'down' } };
    const candidates = [
      { id: 'reset-database', capabilityId: 'database.destructive', allowedComponents: ['supabase-db-container'] },
    ];
    const result = await engine.decide(observations, candidates, { execute: false });
    expect(result.escalation).toBeTruthy();
  });
});

describe('Security boundaries', () => {
  test('LLM recommendation cannot bypass policy', async () => {
    const engine = new HeidiDecisionEngine({ dataDir: null });
    const obs = { 'postgres': { status: 'UNAVAILABLE', detail: 'disk full' } };
    const candidates = [
      { id: 'rm-rf', capabilityId: 'volume.delete', allowedComponents: ['*'] },
    ];
    const result = await engine.decide(obs, candidates, { execute: false });
    expect(result.decisions[0].selected_action).toBeNull();
    expect(result.escalation).toBeTruthy();
    expect(result.escalation.reason).toMatch(/forbidden|approval/);
  });

  test('arbitrary shell capability is forbidden by default', () => {
    const p = new AutonomyPolicy();
    expect(p.canExecute('shell.arbitrary').ok).toBe(false);
  });
});
