/**
 * PDR Completeness Tests
 *
 * Verifies that Policy Decision Records are complete — no silent empty fields.
 * Every autonomous decision must produce a structured record with all fields
 * populated. Fields that don't apply must be explicitly marked, not empty.
 */

import { PolicyDecisionRecordStore } from '../../lib/operational/PolicyDecisionRecord';
import type { PolicyDecisionRecord } from '../../lib/operational/types';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('PDR Completeness', () => {
  let store: PolicyDecisionRecordStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-pdr-test-'));
    store = new PolicyDecisionRecordStore(tmpDir);
  });

  afterEach(() => {
    store.destroy();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  });

  it('record() produces a record with all required fields', () => {
    const rec = store.record({
      incidentId: 'test-incident',
      correlationId: 'test-correlation',
      component: 'test-component',
      observedState: 'UNAVAILABLE',
      evidence: [],
      candidateActions: [],
      selectedAction: null,
      risk: 'R1',
      policy: null,
      authorization: { capability: 'health.recover', authorized: false, reason: 'no policy', scope: [] },
      executor: 'test',
      result: 'pending',
      reason: 'test reason',
    });

    expect(rec.decisionId).toBeDefined();
    expect(rec.timestamp).toBeDefined();
    expect(rec.incidentId).toBe('test-incident');
    expect(rec.correlationId).toBe('test-correlation');
    expect(rec.component).toBe('test-component');
    expect(rec.observedState).toBe('UNAVAILABLE');
    expect(rec.evidence).toEqual([]);
    expect(rec.candidateActions).toEqual([]);
    expect(rec.selectedAction).toBeNull();
    expect(rec.risk).toBe('R1');
    expect(rec.policy).toBeNull();
    expect(rec.authorization).toBeDefined();
    expect(rec.executor).toBe('test');
    expect(rec.result).toBe('pending');
    expect(rec.reason).toBe('test reason');
  });

  it('update() modifies an existing record by ID', () => {
    const rec = store.record({
      incidentId: 'test-incident',
      correlationId: 'test-correlation',
      component: 'test-component',
      observedState: 'UNAVAILABLE',
      evidence: [],
      candidateActions: [],
      selectedAction: null,
      risk: 'R1',
      policy: null,
      authorization: { capability: 'health.recover', authorized: true, scope: ['test-component'] },
      executor: 'test',
      result: 'pending',
      reason: 'test reason',
    });

    const updated = store.update(rec.decisionId, {
      result: 'success',
      verification: [{ check: 'health-endpoint', status: 'pass', value: 'HTTP 200', checkedAt: new Date().toISOString() }],
    });

    expect(updated).not.toBeNull();
    expect(updated!.result).toBe('success');
    expect(updated!.verification).toBeDefined();
    expect(updated!.verification!.length).toBe(1);
    expect(updated!.decisionId).toBe(rec.decisionId); // ID preserved
  });

  it('update() returns null for non-existent record', () => {
    const result = store.update('nonexistent-id', { result: 'success' });
    expect(result).toBeNull();
  });

  it('getById() retrieves a record by ID', () => {
    const rec = store.record({
      incidentId: 'test-incident',
      correlationId: 'test-correlation',
      component: 'test-component',
      observedState: 'UNAVAILABLE',
      evidence: [],
      candidateActions: [],
      selectedAction: null,
      risk: 'R1',
      policy: null,
      authorization: { capability: 'health.recover', authorized: true, scope: [] },
      executor: 'test',
      result: 'pending',
      reason: 'test',
    });

    const retrieved = store.getById(rec.decisionId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.decisionId).toBe(rec.decisionId);
  });

  it('detail field captures assessment, execution, outcome, escalation', () => {
    const rec = store.record({
      incidentId: 'test-incident',
      correlationId: 'test-correlation',
      component: 'test-component',
      observedState: 'UNAVAILABLE',
      evidence: [],
      candidateActions: [],
      selectedAction: null,
      risk: 'R1',
      policy: null,
      authorization: { capability: 'health.recover', authorized: true, scope: [] },
      executor: 'test',
      result: 'pending',
      reason: 'test',
      detail: {
        phase: 'pre-execution',
        assessment: 'component unavailable',
        execution: 'not_started',
        outcome: 'pending',
        escalation: 'not_required',
      },
    });

    expect(rec.detail).toBeDefined();
    expect(rec.detail!.phase).toBe('pre-execution');
    expect(rec.detail!.assessment).toBe('component unavailable');
    expect(rec.detail!.execution).toBe('not_started');
    expect(rec.detail!.outcome).toBe('pending');
    expect(rec.detail!.escalation).toBe('not_required');
  });

  it('update() can change result from pending to escalated with escalation detail', () => {
    const rec = store.record({
      incidentId: 'test-incident',
      correlationId: 'test-correlation',
      component: 'test-component',
      observedState: 'UNAVAILABLE',
      evidence: [],
      candidateActions: [],
      selectedAction: null,
      risk: 'R1',
      policy: null,
      authorization: { capability: 'health.recover', authorized: true, scope: [] },
      executor: 'test',
      result: 'pending',
      reason: 'test',
    });

    const updated = store.update(rec.decisionId, {
      result: 'escalated',
      detail: {
        phase: 'escalated',
        assessment: 'recovery exhausted',
        execution: 'not_executed',
        outcome: 'escalated',
        escalation: 'esc-123',
        recommendedNextAction: 'manual intervention required',
      },
    });

    expect(updated!.result).toBe('escalated');
    expect(updated!.detail!.escalation).toBe('esc-123');
    expect(updated!.detail!.recommendedNextAction).toBe('manual intervention required');
  });
});
