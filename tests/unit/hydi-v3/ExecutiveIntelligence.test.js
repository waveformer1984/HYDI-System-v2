const GoalManager = require('../../../src/hydi-v3/GoalManager');
const DependencyPlanner = require('../../../src/hydi-v3/DependencyPlanner');
const ResourceAllocator = require('../../../src/hydi-v3/ResourceAllocator');
const ForecastEngine = require('../../../src/hydi-v3/ForecastEngine');
const RiskAnalyzer = require('../../../src/hydi-v3/RiskAnalyzer');
const MissionPlanner = require('../../../src/hydi-v3/MissionPlanner');
const ExecutionRoadmap = require('../../../src/hydi-v3/ExecutionRoadmap');
const StrategicPlanner = require('../../../src/hydi-v3/StrategicPlanner');
const ProgressTracker = require('../../../src/hydi-v3/ProgressTracker');
const DecisionJournal = require('../../../src/hydi-v3/DecisionJournal');
const StrategicMemory = require('../../../src/hydi-v3/StrategicMemory');
const ExecutiveDashboard = require('../../../src/hydi-v3/ExecutiveDashboard');

function makeGoals() {
  const gm = new GoalManager();
  const g1 = gm.createGoal({ id: 'g1', title: 'Dominate audio', priority: 5, strategicValue: 10, estimatedEffort: 20, kind: 'objective' });
  const g2 = gm.createGoal({ id: 'g2', title: 'Build mixer', priority: 4, strategicValue: 8, estimatedEffort: 10, kind: 'project', dependencies: ['g1'] });
  const g3 = gm.createGoal({ id: 'g3', title: 'Train model', priority: 3, strategicValue: 6, estimatedEffort: 15, kind: 'project' });
  return { gm, g1: g1.goal, g2: g2.goal, g3: g3.goal };
}

describe('Goal management', () => {
  test('creates a goal hierarchy', () => {
    const { gm, g1, g2 } = makeGoals();
    gm.addChild(g1.id, g2.id);
    expect(gm.get(g2.id).parent).toBe(g1.id);
    expect(gm.list({ state: 'proposed' }).length).toBe(3);
  });

  test('validates state transitions', () => {
    const { gm, g1 } = makeGoals();
    const ok = gm.setState(g1.id, 'active');
    expect(ok.success).toBe(true);
    expect(gm.get(g1.id).state).toBe('active');
    const bad = gm.setState(g1.id, 'exploded');
    expect(bad.success).toBe(false);
  });
});

describe('Dependency planning', () => {
  test('orders goals by dependencies', () => {
    const { gm, g1, g2, g3 } = makeGoals();
    const dp = new DependencyPlanner();
    const order = dp.order([g1, g2, g3]);
    expect(order.success).toBe(true);
    expect(order.ordered[0].id).toBe('g1');
    expect(order.ordered.some((g) => g.id === 'g2')).toBe(true);
  });

  test('detects circular dependencies', () => {
    const gA = { id: 'a', dependencies: ['b'] };
    const gB = { id: 'b', dependencies: ['a'] };
    const dp = new DependencyPlanner();
    const order = dp.order([gA, gB]);
    expect(order.success).toBe(false);
    expect(order.error).toBe('cycle_detected');
  });
});

describe('Resource allocation', () => {
  test('tracks and allocates resources', () => {
    const ra = new ResourceAllocator();
    ra.addResource('node-a', { cpu: 4, ram: 8, gpu: true, capabilities: ['audio'] });
    const available = ra.available();
    expect(available.cpu).toBe(4);
    const result = ra.request({ id: 't1', cpu: 2, ram: 4, gpu: true });
    expect(result.success).toBe(true);
    const over = ra.request({ id: 't2', cpu: 10 });
    expect(over.success).toBe(false);
    expect(over.error).toBe('resource_exhausted');
  });

  test('checks capability availability', () => {
    const broker = { findProviders: (id) => id === 'audio' ? [{ nodeId: 'node-a' }] : [] };
    const ra = new ResourceAllocator({ capabilityBroker: broker });
    const ok = ra.request({ id: 't1', capability: 'audio' });
    expect(ok.success).toBe(true);
    const missing = ra.request({ id: 't2', capability: 'video' });
    expect(missing.success).toBe(false);
    expect(missing.reasons).toContain('capability_unavailable');
  });
});

describe('Forecast engine', () => {
  test('produces a conservative forecast with assumptions', () => {
    const fe = new ForecastEngine({ baseRate: 2 });
    const task = { id: 't1', estimatedEffort: 10, cpu: 1, ram: 2 };
    const result = fe.forecast(task, { cpu: 4, ram: 8, nodes: 1 });
    expect(result.success).toBe(true);
    expect(result.forecast.duration).toBeGreaterThan(0);
    expect(result.forecast.assumptions.length).toBeGreaterThan(0);
    expect(result.forecast.completionProbability).toBeGreaterThanOrEqual(0);
  });

  test('identifies bottlenecks', () => {
    const fe = new ForecastEngine();
    const task = { id: 't2', estimatedEffort: 5, gpu: true };
    const result = fe.forecast(task, { cpu: 1, ram: 1, gpu: false });
    expect(result.forecast.bottlenecks).toContain('gpu_required_not_available');
  });
});

describe('Risk analysis', () => {
  test('analyzes a task and returns a score', () => {
    const ra = new RiskAnalyzer();
    const task = { id: 't3', estimatedEffort: 50, dependencies: ['a', 'b', 'c'] };
    const result = ra.analyze({ task, riskThreshold: 0.7 });
    expect(result.success).toBe(true);
    expect(result.assessment.overall).toBeGreaterThanOrEqual(0);
    expect(result.assessment.breakdown).toHaveProperty('execution');
    expect(result.assessment.rationale).toBeTruthy();
  });

  test('rejects high-risk plans over threshold', () => {
    const policy = { validateAction: () => ({ allowed: false, reason: 'policy_denied' }) };
    const ra = new RiskAnalyzer({ policy });
    const task = { id: 't4', estimatedEffort: 10, approvals: true };
    const result = ra.analyze({ task, riskThreshold: 0.1 });
    expect(result.assessment.acceptable).toBe(false);
  });
});

describe('Mission planning', () => {
  test('breaks a goal into ordered milestones', () => {
    const dp = new DependencyPlanner();
    const mp = new MissionPlanner({ dependencyPlanner: dp });
    const { g1 } = makeGoals();
    const mission = mp.defineMission(g1.id);
    expect(mission.success).toBe(true);
    mp.addPhase(mission.mission.id, { id: 'p1', title: 'Design', dependencies: [] });
    mp.addPhase(mission.mission.id, { id: 'p2', title: 'Build', dependencies: ['p1'] });
    const milestones = mp.generateMilestones(mission.mission.id);
    expect(milestones.success).toBe(true);
    expect(mp.getMilestones(mission.mission.id).length).toBe(2);
    expect(mp.getMilestones(mission.mission.id)[0].title).toBe('Design');
  });

  test('fails to order cyclic mission phases', () => {
    const dp = new DependencyPlanner();
    const mp = new MissionPlanner({ dependencyPlanner: dp });
    const { g1 } = makeGoals();
    const mission = mp.defineMission(g1.id);
    mp.addPhase(mission.mission.id, { id: 'a', title: 'A', dependencies: ['b'] });
    mp.addPhase(mission.mission.id, { id: 'b', title: 'B', dependencies: ['a'] });
    const ms = mp.generateMilestones(mission.mission.id);
    expect(ms.success).toBe(false);
  });
});

describe('Strategic planning', () => {
  test('produces an explainable plan', () => {
    const { gm } = makeGoals();
    const dp = new DependencyPlanner();
    const journal = new DecisionJournal();
    const planner = new StrategicPlanner({ goalManager: gm, dependencyPlanner: dp, decisionJournal: journal });
    const result = planner.plan();
    expect(result.success).toBe(true);
    expect(result.plan.goals.length).toBe(3);
    expect(planner.explain(result.plan.id)).toContain('prioritized');
  });

  test('replanning records a new decision', () => {
    const { gm } = makeGoals();
    const dp = new DependencyPlanner();
    const journal = new DecisionJournal();
    const planner = new StrategicPlanner({ goalManager: gm, dependencyPlanner: dp, decisionJournal: journal });
    const first = planner.plan();
    const second = planner.replan(first.plan.id, 'risk spike');
    expect(second.success).toBe(true);
    expect(journal.list().length).toBeGreaterThan(0);
  });
});

describe('Progress tracking', () => {
  test('tracks milestone completion and blocked work', () => {
    const pt = new ProgressTracker();
    pt.recordMilestone('m1', 'completed');
    pt.recordMilestone('m2', 'blocked');
    const summary = pt.summary();
    expect(summary.completed).toBe(1);
    expect(summary.blocked).toBe(1);
    expect(pt.getBlocked().length).toBe(1);
    expect(pt.getTrends().length).toBe(2);
  });
});

describe('Executive dashboard', () => {
  test('renders executive snapshot', () => {
    const { gm, g1 } = makeGoals();
    gm.setState(g1.id, 'active');
    const pt = new ProgressTracker();
    pt.recordProgress(g1.id, 'active');
    const fed = { render: () => ({ peers: 3, healthy: 3, completedTasks: 5 }) };
    const dashboard = new ExecutiveDashboard({ goalManager: gm, progressTracker: pt, federationDashboard: fed });
    const render = dashboard.render();
    expect(render.activeGoals).toBeGreaterThan(0);
    expect(render.topGoals.length).toBeGreaterThan(0);
    expect(render.federation.peers).toBe(3);
  });
});

describe('Strategic memory', () => {
  test('remembers and recalls lessons', () => {
    const sm = new StrategicMemory();
    sm.remember('lesson', { topic: 'audio_pipeline', tags: ['audio', 'gpu'] });
    const recalled = sm.recall('lesson');
    expect(recalled.length).toBe(1);
    const similar = sm.findSimilar(['audio']);
    expect(similar.length).toBe(1);
  });
});
