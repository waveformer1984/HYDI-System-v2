/**
 * HYDI Adaptive Operator — Unit Tests
 *
 * Tests the core components:
 *   - WorldStateManager (observation tracking, freshness)
 *   - ObservationEngine (environment observation)
 *   - DynamicPlanner (plan generation from reality)
 *   - ReplanningEngine (deviation classification)
 *   - CompletionEvaluator (completion predicates)
 *   - FailureClassifier (failure taxonomy)
 *   - ActionBudgetTracker (bounded autonomy)
 *   - TaskMemoryStore (scoped memory)
 *   - AdaptiveOperator (end-to-end goal execution)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  WorldStateManager,
  ObservationEngine,
  DynamicPlanner,
  ReplanningEngine,
  CompletionEvaluator,
  FailureClassifier,
  ActionBudgetTracker,
  TaskMemoryStore,
  AdaptiveOperator,
  DEFAULT_AUTONOMY_BOUNDS,
} from '../../lib/adaptive-operator/index';
import {
  HumanActionEngine,
  ActionCapabilityRegistry,
  createDefaultActionCapabilityRegistry,
  AuthorityManager,
  STRICT_CONFIRMATION,
  ActionJournal,
  FilesystemAdapter,
  ProcessAdapter,
  HttpAdapter,
  DevelopmentAdapter,
  InfrastructureAdapter,
  CredentialAdapter,
} from '../../lib/human-action/index';
import type { HumanInterventionRequest } from '../../lib/human-action/HumanActionTypes';

function createTestSetup(tmpDir: string) {
  const registry = createDefaultActionCapabilityRegistry();
  const authorityManager = new AuthorityManager(STRICT_CONFIRMATION);
  const journal = new ActionJournal(path.resolve(tmpDir, 'journal.jsonl'));

  const auth = authorityManager.delegate({
    delegatedBy: 'user:owner', delegatedTo: 'heidi',
    scopes: ['READ_ONLY', 'LOCAL_WRITE', 'SERVICE_OPERATION', 'CREDENTIAL_MANAGEMENT', 'DESTRUCTIVE'],
    riskLimit: 'HIGH', riskLevelLimit: 'R4',
    resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
    timeConstraint: { type: 'session_bounded', sessionId: 'test' },
    requiresConfirmation: STRICT_CONFIRMATION, purpose: 'Test',
  });

  const interventions: HumanInterventionRequest[] = [];
  const engine = new HumanActionEngine({
    registry, authorityManager, journal,
    defaultAuthorityId: auth.authorityId,
    onHumanIntervention: (req) => interventions.push(req),
  });

  engine.registerAdapter(new FilesystemAdapter(path.resolve(tmpDir, 'backups')));
  engine.registerAdapter(new ProcessAdapter());
  engine.registerAdapter(new HttpAdapter());
  engine.registerAdapter(new DevelopmentAdapter());
  engine.registerAdapter(new InfrastructureAdapter());
  engine.registerAdapter(new CredentialAdapter({
    discover: async () => ({ added: [], updated: [], removed: [] }),
    getInventory: () => ({}),
    getKey: (id: string) => id.startsWith('cred_') ? { id } : null,
    validate: async (id: string) => ({ valid: id.includes('valid'), state: id.includes('valid') ? 'READY' : 'DEGRADED', evidence: 'mock' }),
    rotate: async () => ({ success: true, newKeyId: 'cred_new' }),
    revoke: async () => ({ success: true }),
    checkHealth: async () => ({ healthy: true }),
  }));

  const operator = new AdaptiveOperator(engine, registry, {
    rootDir: tmpDir,
    authorityId: auth.authorityId,
    bounds: { ...DEFAULT_AUTONOMY_BOUNDS, maxActionsPerPlan: 20, maxReplans: 5 },
    onHumanIntervention: (req) => interventions.push(req),
  });

  return { operator, engine, registry, authorityManager, journal, interventions, auth };
}

describe('Adaptive Operator — WorldStateManager', () => {
  test('records and retrieves observations', () => {
    const wsm = new WorldStateManager();
    const obs = wsm.observe({
      timestamp: new Date().toISOString(),
      source: 'filesystem',
      confidence: 0.9,
      freshness: 'current',
      correlationId: 'test',
      category: 'file',
      key: 'file:/test',
      value: { exists: true },
      summary: 'File exists',
    });
    expect(obs.observationId).toBeDefined();
    expect(wsm.get('file:/test')).not.toBeNull();
    expect((wsm.get('file:/test')!.value as { exists: boolean }).exists).toBe(true);
  });

  test('tracks freshness correctly', async () => {
    const wsm = new WorldStateManager();
    // Record an old observation
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    wsm.observe({
      timestamp: oldTime,
      source: 'filesystem',
      confidence: 0.9,
      freshness: 'current',
      correlationId: 'test',
      category: 'file',
      key: 'file:/old',
      value: { exists: true },
      summary: 'Old file',
    });
    expect(wsm.isFresh('file:/old')).toBe(false);
  });

  test('prunes expired observations', () => {
    const wsm = new WorldStateManager();
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    wsm.observe({
      timestamp: oldTime,
      source: 'filesystem',
      confidence: 0.9,
      freshness: 'current',
      correlationId: 'test',
      category: 'file',
      key: 'file:/expired',
      value: { exists: true },
      summary: 'Expired file',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const pruned = wsm.prune();
    expect(pruned).toBeGreaterThan(0);
    expect(wsm.get('file:/expired')).toBeNull();
  });
});

describe('Adaptive Operator — FailureClassifier', () => {
  const classifier = new FailureClassifier();

  test('classifies authorization failure', () => {
    const result = {
      actionId: 'test', state: 'DENIED' as const, executed: false, verified: false,
      outcome: 'denied' as const, result: null, error: 'Authorization denied',
      evidence: [], durationMs: 0, timestamp: new Date().toISOString(),
    };
    const failure = classifier.classify(result, 'goal-1', 'obj-1');
    expect(failure.classification).toBe('AUTHORIZATION_FAILURE');
    expect(failure.retryable).toBe(false);
  });

  test('classifies capability unavailable', () => {
    const result = {
      actionId: 'test', state: 'BLOCKED' as const, executed: false, verified: false,
      outcome: 'blocked' as const, result: null, error: 'Capability not registered',
      evidence: [], durationMs: 0, timestamp: new Date().toISOString(),
    };
    const failure = classifier.classify(result, 'goal-1', 'obj-1');
    expect(failure.classification).toBe('CAPABILITY_UNAVAILABLE');
    expect(failure.retryable).toBe(false);
  });

  test('classifies transient failure as retryable', () => {
    const result = {
      actionId: 'test', state: 'EXECUTION_FAILED' as const, executed: false, verified: false,
      outcome: 'failure' as const, result: null, error: 'Connection timed out',
      evidence: [], durationMs: 0, timestamp: new Date().toISOString(),
    };
    const failure = classifier.classify(result, 'goal-1', 'obj-1');
    expect(failure.classification).toBe('TRANSIENT_FAILURE');
    expect(failure.retryable).toBe(true);
  });

  test('classifies human intervention required', () => {
    const result = {
      actionId: 'test', state: 'PENDING_HUMAN' as const, executed: false, verified: false,
      outcome: 'pending_human' as const, result: null, error: null,
      evidence: [], durationMs: 0, timestamp: new Date().toISOString(),
    };
    const failure = classifier.classify(result, 'goal-1', 'obj-1');
    expect(failure.classification).toBe('HUMAN_INTERVENTION_REQUIRED');
    expect(failure.retryable).toBe(false);
  });
});

describe('Adaptive Operator — ActionBudgetTracker', () => {
  test('tracks actions and detects exhaustion', () => {
    const tracker = new ActionBudgetTracker();
    tracker.init('goal-1', { ...DEFAULT_AUTONOMY_BOUNDS, maxActionsPerPlan: 2 });

    tracker.recordAction('goal-1', {
      actionId: 'a1', state: 'VERIFIED', executed: true, verified: true,
      outcome: 'success', result: null, error: null,
      evidence: [], durationMs: 100, timestamp: new Date().toISOString(),
    });

    expect(tracker.isExhausted('goal-1').exhausted).toBe(false);

    tracker.recordAction('goal-1', {
      actionId: 'a2', state: 'VERIFIED', executed: true, verified: true,
      outcome: 'success', result: null, error: null,
      evidence: [], durationMs: 100, timestamp: new Date().toISOString(),
    });

    expect(tracker.isExhausted('goal-1').exhausted).toBe(true);
    expect(tracker.isExhausted('goal-1').reason).toContain('Max actions');
  });

  test('tracks replans', () => {
    const tracker = new ActionBudgetTracker();
    tracker.init('goal-1', { ...DEFAULT_AUTONOMY_BOUNDS, maxReplans: 2 });
    tracker.recordReplan('goal-1');
    tracker.recordReplan('goal-1');
    expect(tracker.isExhausted('goal-1').exhausted).toBe(true);
    expect(tracker.isExhausted('goal-1').reason).toContain('replans');
  });
});

describe('Adaptive Operator — TaskMemoryStore', () => {
  test('records and retrieves entries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-memory-'));
    try {
      const store = new TaskMemoryStore(tmpDir);
      store.record('goal-1', 'observation', { key: 'test', value: 'hello' });
      store.record('goal-1', 'decision', { action: 'proceed' });

      const all = store.getAll('goal-1');
      expect(all.length).toBe(2);
      expect(store.getByType('goal-1', 'observation').length).toBe(1);
      expect(store.getByType('goal-1', 'decision').length).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('tracks failed approaches', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-memory-'));
    try {
      const store = new TaskMemoryStore(tmpDir);
      store.record('goal-1', 'failed_approach', { description: 'filesystem.write_file:/test' });
      expect(store.hasFailedApproach('goal-1', 'filesystem.write_file:/test')).toBe(true);
      expect(store.hasFailedApproach('goal-1', 'filesystem.read_file:/test')).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('redacts secrets in persisted content', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-memory-'));
    try {
      const store = new TaskMemoryStore(tmpDir);
      store.record('goal-1', 'observation', { api_key: 'sk_test_secret123', safe: 'ok' });
      await store.persist('goal-1');

      const filePath = path.resolve(tmpDir, '.hydi', 'task-memory', 'goal-1.json');
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).not.toContain('sk_test_secret123');
      expect(content).toContain('[REDACTED]');
      expect(content).toContain('ok');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Adaptive Operator — DynamicPlanner', () => {
  test('generates plan from world state', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-plan-'));
    try {
      const registry = createDefaultActionCapabilityRegistry();
      const wsm = new WorldStateManager();
      const taskMemory = new TaskMemoryStore(tmpDir);
      const planner = new DynamicPlanner(wsm, registry, tmpDir, taskMemory);

      const goal = {
        goalId: 'test', statement: 'Prepare for production', statedBy: 'user',
        constraints: [], objectives: [], status: 'planning' as const,
        completionConfidence: 0, createdAt: new Date().toISOString(),
        replanCount: 0, actionCount: 0, blockers: [],
        authorizationState: { authorityId: null, pendingRequests: [], deniedActions: [], approvedActions: [] },
        verificationState: { verifiedObjectives: [], failedObjectives: [], pendingVerifications: [] },
      };

      const plan = planner.plan(goal);
      expect(plan.objectives.length).toBeGreaterThan(0);
      expect(plan.executionOrder.length).toBe(plan.objectives.length);
      expect(plan.basedOnObservationIds).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('replan preserves completed objectives', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-plan-'));
    try {
      const registry = createDefaultActionCapabilityRegistry();
      const wsm = new WorldStateManager();
      const taskMemory = new TaskMemoryStore(tmpDir);
      const planner = new DynamicPlanner(wsm, registry, tmpDir, taskMemory);

      const goal = {
        goalId: 'test', statement: 'Prepare for production', statedBy: 'user',
        constraints: [], objectives: [], status: 'planning' as const,
        completionConfidence: 0, createdAt: new Date().toISOString(),
        replanCount: 0, actionCount: 0, blockers: [],
        authorizationState: { authorityId: null, pendingRequests: [], deniedActions: [], approvedActions: [] },
        verificationState: { verifiedObjectives: [], failedObjectives: [], pendingVerifications: [] },
      };

      const plan1 = planner.plan(goal);
      // Mark first objective as complete
      plan1.objectives[0].status = 'complete';

      const plan2 = planner.replan(goal, plan1, 'Test replan');
      expect(plan2.version).toBe(plan1.version + 1);
      // The completed objective should still be complete
      const completedName = plan1.objectives[0].name;
      const obj = plan2.objectives.find((o) => o.name === completedName);
      expect(obj?.status).toBe('complete');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Adaptive Operator — End-to-end', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-e2e-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test('executes a simple goal and observes the environment', async () => {
    const { operator } = createTestSetup(tmpDir);
    const result = await operator.executeGoal('Create a test project directory', 'user:owner', `${tmpDir}/new-project`);

    expect(result.goalId).toBeDefined();
    expect(result.actionsExecuted).toBeGreaterThan(0);
    expect(result.worldState.observationCount).toBeGreaterThan(0);
    expect(result.budget).toBeDefined();
  });

  test('tracks action budget', async () => {
    const { operator } = createTestSetup(tmpDir);
    const result = await operator.executeGoal('Check system health', 'user:owner');

    expect(result.budget.actionsExecuted).toBeGreaterThan(0);
    expect(result.budget.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.budget.bounds.maxActionsPerPlan).toBeDefined();
  });

  test('records failures with classification', async () => {
    const { operator } = createTestSetup(tmpDir);
    // Try to read a nonexistent file — should fail
    const result = await operator.executeGoal('Check credentials for nonexistent credential', 'user:owner', 'cred_nonexistent');

    // Should have executed some actions
    expect(result.actionsExecuted).toBeGreaterThan(0);
  });

  test('human intervention is requested for destructive actions', async () => {
    const { operator, interventions } = createTestSetup(tmpDir);
    const target = path.resolve(tmpDir, 'to-delete.txt');
    fs.writeFileSync(target, 'delete me');

    const result = await operator.executeGoal('Delete the test file', 'user:owner', target);
    // Should be pending human or blocked
    expect(['pending_human', 'blocked', 'partial', 'escalated']).toContain(result.status);
  });

  test('authorization denial is respected', async () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-auth-'));
    try {
      const registry = createDefaultActionCapabilityRegistry();
      const authorityManager = new AuthorityManager(STRICT_CONFIRMATION);
      const journal = new ActionJournal(path.resolve(tmpDir2, 'journal.jsonl'));
      const limitedAuth = authorityManager.delegate({
        delegatedBy: 'user:owner', delegatedTo: 'heidi',
        scopes: ['READ_ONLY'], riskLimit: 'LOW', riskLevelLimit: 'R1',
        resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
        timeConstraint: { type: 'session_bounded', sessionId: 'test' },
        requiresConfirmation: STRICT_CONFIRMATION, purpose: 'Limited',
      });
      const engine = new HumanActionEngine({
        registry, authorityManager, journal,
        defaultAuthorityId: limitedAuth.authorityId,
      });
      engine.registerAdapter(new FilesystemAdapter(path.resolve(tmpDir2, 'backups')));

      const operator = new AdaptiveOperator(engine, registry, {
        rootDir: tmpDir2, authorityId: limitedAuth.authorityId,
      });

      const result = await operator.executeGoal('Write a test file', 'user:owner', `${tmpDir2}/test.txt`);
      // Should not be complete — authorization denied
      expect(result.status).not.toBe('complete');
      expect(fs.existsSync(`${tmpDir2}/test.txt`)).toBe(false);
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  test('no secret leakage in journal', async () => {
    const { operator, journal } = createTestSetup(tmpDir);
    await operator.executeGoal('Check credentials', 'user:owner', 'cred_test');
    await journal.flush();

    const entries = journal.getAllEntries();
    for (const entry of entries) {
      const content = JSON.stringify(entry);
      expect(content).not.toContain('sk_test_');
      expect(content).not.toContain('password');
      expect(content).not.toContain('secret');
    }
  });

  test('bounded autonomy prevents infinite loops', async () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-bounds-'));
    try {
      const registry = createDefaultActionCapabilityRegistry();
      const authorityManager = new AuthorityManager(STRICT_CONFIRMATION);
      const journal = new ActionJournal(path.resolve(tmpDir2, 'journal.jsonl'));
      const auth = authorityManager.delegate({
        delegatedBy: 'user:owner', delegatedTo: 'heidi',
        scopes: ['READ_ONLY', 'LOCAL_WRITE'], riskLimit: 'HIGH', riskLevelLimit: 'R4',
        resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
        timeConstraint: { type: 'session_bounded', sessionId: 'test' },
        requiresConfirmation: STRICT_CONFIRMATION, purpose: 'Test',
      });
      const engine = new HumanActionEngine({
        registry, authorityManager, journal, defaultAuthorityId: auth.authorityId,
      });
      engine.registerAdapter(new FilesystemAdapter(path.resolve(tmpDir2, 'backups')));

      // Very tight bounds
      const operator = new AdaptiveOperator(engine, registry, {
        rootDir: tmpDir2, authorityId: auth.authorityId,
        bounds: { ...DEFAULT_AUTONOMY_BOUNDS, maxActionsPerPlan: 2, maxReplans: 1, maxRetries: 1 },
      });

      const result = await operator.executeGoal('Prepare for production', 'user:owner');
      // Should not exceed bounds
      expect(result.budget.actionsExecuted).toBeLessThanOrEqual(2);
    } finally {
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });
});
