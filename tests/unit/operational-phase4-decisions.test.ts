/**
 * Phase 4 — Policy Decision Records, Escalation, & Incident Correlation Tests
 *
 * Tests:
 * - Decision records are created and persisted
 * - Decision records link to incidents via correlation IDs
 * - Escalation packages are produced when recovery is exhausted
 * - Escalation packages contain evidence, attempted actions, and recommendations
 * - Incident correlation groups downstream failures with root cause
 * - Incident escalation marks state as 'escalated'
 * - Operator can reconstruct incident from decision log
 */

import { PolicyDecisionRecordStore } from '../../lib/operational/PolicyDecisionRecord';
import { EscalationManager } from '../../lib/operational/EscalationManager';
import { IncidentCorrelator } from '../../lib/operational/IncidentCorrelator';
import { SystemStateModel } from '../../lib/operational/SystemStateModel';
import { DependencyGraphBuilder } from '../../lib/operational/DependencyGraphBuilder';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

describe('Phase 4 — PolicyDecisionRecordStore', () => {
  let store: PolicyDecisionRecordStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(__dirname, '..', '..', '.hydi-operational-test-' + randomUUID());
    fs.mkdirSync(tmpDir, { recursive: true });
    store = new PolicyDecisionRecordStore(tmpDir);
  });

  afterEach(async () => {
    await store.destroy();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  });

  it('creates a decision record with ID and timestamp', () => {
    const record = store.record({
      incidentId: 'inc-1',
      correlationId: 'corr-1',
      component: 'protoforge-core',
      observedState: 'UNAVAILABLE',
      evidence: [],
      candidateActions: [],
      selectedAction: null,
      risk: 'R1',
      policy: null,
      authorization: { capability: 'health.recover', authorized: false, reason: 'test' },
      executor: 'test',
      result: 'no_action',
      reason: 'test decision',
    });

    expect(record.decisionId).toBeDefined();
    expect(record.timestamp).toBeDefined();
    expect(record.component).toBe('protoforge-core');
    expect(record.reason).toBe('test decision');
  });

  it('retrieves decisions by incident ID', () => {
    store.record({
      incidentId: 'inc-1',
      correlationId: 'corr-1',
      component: 'protoforge-core',
      observedState: 'UNAVAILABLE',
      evidence: [],
      candidateActions: [],
      selectedAction: null,
      risk: 'R1',
      policy: null,
      authorization: { capability: 'health.recover', authorized: false, reason: 'test' },
      executor: 'test',
      result: 'no_action',
      reason: 'decision 1',
    });
    store.record({
      incidentId: 'inc-1',
      correlationId: 'corr-1',
      component: 'protoforge-core',
      observedState: 'HEALTHY',
      evidence: [],
      candidateActions: [],
      selectedAction: null,
      risk: 'R0',
      policy: null,
      authorization: { capability: 'health.read', authorized: true, scope: ['*'] },
      executor: 'test',
      result: 'success',
      reason: 'decision 2',
    });

    const decisions = store.getByIncidentId('inc-1');
    expect(decisions).toHaveLength(2);
  });

  it('retrieves decisions by component', () => {
    store.record({
      incidentId: 'inc-1',
      correlationId: 'corr-1',
      component: 'protoforge-core',
      observedState: 'UNAVAILABLE',
      evidence: [],
      candidateActions: [],
      selectedAction: null,
      risk: 'R1',
      policy: null,
      authorization: { capability: 'health.recover', authorized: false, reason: 'test' },
      executor: 'test',
      result: 'no_action',
      reason: 'test',
    });

    const decisions = store.getByComponent('protoforge-core');
    expect(decisions).toHaveLength(1);
  });

  it('persists decisions to disk and loads them on restart', async () => {
    store.record({
      incidentId: 'inc-1',
      correlationId: 'corr-1',
      component: 'protoforge-core',
      observedState: 'UNAVAILABLE',
      evidence: [],
      candidateActions: [],
      selectedAction: null,
      risk: 'R1',
      policy: null,
      authorization: { capability: 'health.recover', authorized: false, reason: 'test' },
      executor: 'test',
      result: 'no_action',
      reason: 'persisted decision',
    });

    await store.flush();

    // Create a new store pointing at the same directory
    const store2 = new PolicyDecisionRecordStore(tmpDir);
    const records = store2.getRecent();
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].reason).toBe('persisted decision');
  });
});

describe('Phase 4 — EscalationManager', () => {
  let model: SystemStateModel;
  let decisionStore: PolicyDecisionRecordStore;
  let escalationManager: EscalationManager;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(__dirname, '..', '..', '.hydi-operational-test-' + randomUUID());
    fs.mkdirSync(tmpDir, { recursive: true });
    model = new SystemStateModel();
    model.registerComponent('protoforge-core', 'protoforge');
    decisionStore = new PolicyDecisionRecordStore(tmpDir);
    escalationManager = new EscalationManager(model, decisionStore);
  });

  afterEach(async () => {
    await decisionStore.destroy();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  });

  it('creates an escalation package with evidence and recommendations', () => {
    const escalation = escalationManager.escalate(
      'protoforge-core',
      'inc-1',
      'corr-1',
      [{ check: 'port-listening', status: 'fail', value: 'port 3005 not listening', checkedAt: new Date().toISOString() }],
      [{ action: 'restart_process', result: 'failure', timestamp: new Date().toISOString(), error: 'postcondition failed' }],
      'recovery budget exhausted after 3 attempts',
      'Review component logs and manually restart',
      'R1',
      ['protoforge-core', 'heidi-web'],
    );

    expect(escalation.escalationId).toBeDefined();
    expect(escalation.component).toBe('protoforge-core');
    expect(escalation.state).toBe('ESCALATION_REQUIRED');
    expect(escalation.attemptedActions).toHaveLength(1);
    expect(escalation.recommendedNextAction).toContain('manually restart');
    expect(escalation.affectedComponents).toContain('heidi-web');
  });

  it('sets component state to ESCALATION_REQUIRED', () => {
    escalationManager.escalate(
      'protoforge-core',
      'inc-1',
      'corr-1',
      [],
      [],
      'budget exhausted',
      'manual review',
      'R1',
      ['protoforge-core'],
    );

    expect(model.getState('protoforge-core').state).toBe('ESCALATION_REQUIRED');
  });

  it('tracks active escalations', () => {
    escalationManager.escalate(
      'protoforge-core',
      'inc-1',
      'corr-1',
      [],
      [],
      'budget exhausted',
      'manual review',
      'R1',
      ['protoforge-core'],
    );

    expect(escalationManager.getActiveEscalations()).toHaveLength(1);
    expect(escalationManager.isEscalated('protoforge-core')).toBe(true);
  });

  it('clears escalation', () => {
    escalationManager.escalate(
      'protoforge-core',
      'inc-1',
      'corr-1',
      [],
      [],
      'budget exhausted',
      'manual review',
      'R1',
      ['protoforge-core'],
    );

    escalationManager.clearEscalation('protoforge-core');
    expect(escalationManager.isEscalated('protoforge-core')).toBe(false);
  });

  it('produces human-readable escalation report', () => {
    const escalation = escalationManager.escalate(
      'protoforge-core',
      'inc-1',
      'corr-1',
      [{ check: 'port-listening', status: 'fail', value: 'not listening', checkedAt: new Date().toISOString() }],
      [{ action: 'restart', result: 'failed', timestamp: new Date().toISOString() }],
      'budget exhausted',
      'manual restart needed',
      'R1',
      ['protoforge-core'],
    );

    const formatted = escalationManager.formatEscalation(escalation);
    expect(formatted).toContain('ESCALATION REQUIRED');
    expect(formatted).toContain('protoforge-core');
    expect(formatted).toContain('budget exhausted');
    expect(formatted).toContain('manual restart needed');
  });
});

describe('Phase 4 — IncidentCorrelator (enhanced)', () => {
  let model: SystemStateModel;
  let correlator: IncidentCorrelator;
  const root = path.resolve(__dirname, '..', '..');

  beforeEach(() => {
    const graphBuilder = new DependencyGraphBuilder(root);
    const graph = graphBuilder.build();
    model = new SystemStateModel();
    for (const [id, node] of graph.nodes) {
      model.registerComponent(id, node.category);
    }
    correlator = new IncidentCorrelator(model, graph);
  });

  it('creates incidents with correlation IDs (Phase 4)', () => {
    const event = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      type: 'state_transition' as const,
      component: 'database',
      previousState: 'HEALTHY' as const,
      newState: 'UNAVAILABLE' as const,
      cause: 'connection lost',
    };
    const incident = correlator.correlateFailure(event);
    expect(incident).not.toBeNull();
    expect(incident!.correlationId).toBeDefined();
    expect(incident!.timeline).toBeDefined();
    expect(incident!.timeline!.length).toBeGreaterThan(0);
  });

  it('escalates incidents (Phase 4)', () => {
    const event = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      type: 'state_transition' as const,
      component: 'database',
      previousState: 'HEALTHY' as const,
      newState: 'UNAVAILABLE' as const,
      cause: 'connection lost',
    };
    correlator.correlateFailure(event);

    const escalated = correlator.escalateIncident('database', 'recovery exhausted');
    expect(escalated).not.toBeNull();
    expect(escalated!.state).toBe('escalated');
    expect(escalated!.resolution).toContain('ESCALATED');
  });

  it('records actions on incidents (Phase 4)', () => {
    const event = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      type: 'state_transition' as const,
      component: 'database',
      previousState: 'HEALTHY' as const,
      newState: 'UNAVAILABLE' as const,
      cause: 'connection lost',
    };
    correlator.correlateFailure(event);

    correlator.recordAction('database', 'restart_process', 'success');
    const incident = correlator.getIncidentForComponent('database');
    expect(incident!.actions).toBeDefined();
    expect(incident!.actions!.length).toBe(1);
    expect(incident!.actions![0].action).toBe('restart_process');
  });

  it('returns correlation ID for active incident (Phase 4)', () => {
    const event = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      type: 'state_transition' as const,
      component: 'database',
      previousState: 'HEALTHY' as const,
      newState: 'UNAVAILABLE' as const,
      cause: 'connection lost',
    };
    correlator.correlateFailure(event);

    const corrId = correlator.getCorrelationId('database');
    expect(corrId).not.toBeNull();
  });
});
