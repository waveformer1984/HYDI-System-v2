/**
 * Operational Learning Layer Tests (Phase 7)
 *
 * Verifies that HEIDI can learn from operational events and produce
 * recommendations, but NEVER auto-apply them.
 */

import { OperationalLearning } from '../../lib/operational/OperationalLearning';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Operational Learning Layer', () => {
  let tmpDir: string;
  let opDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-learning-'));
    opDir = path.join(tmpDir, '.hydi-operational');
    fs.mkdirSync(opDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  function writeEvents(events: any[]) {
    const filePath = path.join(opDir, 'operational-events.jsonl');
    fs.writeFileSync(filePath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }

  function writePDRs(pdrs: any[]) {
    const filePath = path.join(opDir, 'policy-decisions.jsonl');
    fs.writeFileSync(filePath, pdrs.map((p) => JSON.stringify(p)).join('\n') + '\n');
  }

  it('produces insights from operational events', () => {
    writeEvents([
      { id: '1', timestamp: new Date().toISOString(), type: 'recovery_started', component: 'protoforge-core', correlationId: 'c1' },
      { id: '2', timestamp: new Date().toISOString(), type: 'recovery_completed', component: 'protoforge-core', actionResult: 'success', correlationId: 'c1' },
      { id: '3', timestamp: new Date().toISOString(), type: 'recovery_started', component: 'heidi-web', correlationId: 'c2' },
      { id: '4', timestamp: new Date().toISOString(), type: 'recovery_failed', component: 'heidi-web', correlationId: 'c2' },
    ]);

    const learning = new OperationalLearning(tmpDir);
    const insights = learning.analyze();

    expect(insights.totalRecoveryAttempts).toBe(2);
    expect(insights.successfulRecoveries).toBe(1);
    expect(insights.failedRecoveries).toBe(1);
    expect(insights.recoverySuccessRate).toBe(0.5);
  });

  it('never auto-applies recommendations', () => {
    writeEvents([
      { id: '1', timestamp: new Date().toISOString(), type: 'recovery_failed', component: 'comp1', correlationId: 'c1' },
      { id: '2', timestamp: new Date().toISOString(), type: 'recovery_failed', component: 'comp1', correlationId: 'c2' },
      { id: '3', timestamp: new Date().toISOString(), type: 'recovery_failed', component: 'comp1', correlationId: 'c3' },
      { id: '4', timestamp: new Date().toISOString(), type: 'recovery_failed', component: 'comp1', correlationId: 'c4' },
      { id: '5', timestamp: new Date().toISOString(), type: 'recovery_failed', component: 'comp1', correlationId: 'c5' },
    ]);

    const learning = new OperationalLearning(tmpDir);
    const insights = learning.analyze();

    for (const rec of insights.recommendations) {
      expect(rec.autoApply).toBe(false);
    }
  });

  it('identifies frequently failing components', () => {
    writeEvents([
      { id: '1', timestamp: new Date().toISOString(), type: 'recovery_started', component: 'protoforge-core', correlationId: 'c1' },
      { id: '2', timestamp: new Date().toISOString(), type: 'recovery_started', component: 'protoforge-core', correlationId: 'c2' },
      { id: '3', timestamp: new Date().toISOString(), type: 'recovery_started', component: 'protoforge-core', correlationId: 'c3' },
      { id: '4', timestamp: new Date().toISOString(), type: 'recovery_started', component: 'heidi-web', correlationId: 'c4' },
    ]);

    const learning = new OperationalLearning(tmpDir);
    const insights = learning.analyze();

    expect(insights.frequentlyFailingComponents).toContain('protoforge-core');
    expect(insights.frequentlyFailingComponents).not.toContain('heidi-web');
  });

  it('recommends policy review when success rate is low', () => {
    const events: any[] = [];
    // 4 successes
    for (let i = 0; i < 4; i++) {
      events.push({ id: `s${i}`, timestamp: new Date().toISOString(), type: 'recovery_completed', component: 'comp', actionResult: 'success', correlationId: `c${i}` });
    }
    // 6 failures (40% success rate — below 50% threshold)
    for (let i = 0; i < 6; i++) {
      events.push({ id: `f${i}`, timestamp: new Date().toISOString(), type: 'recovery_failed', component: 'comp', correlationId: `f${i}` });
    }
    writeEvents(events);

    const learning = new OperationalLearning(tmpDir);
    const insights = learning.analyze();

    const policyRec = insights.recommendations.find((r) => r.type === 'policy');
    expect(policyRec).toBeDefined();
    expect(policyRec!.priority).toBe('high');
  });

  it('handles empty operational data gracefully', () => {
    const learning = new OperationalLearning(tmpDir);
    const insights = learning.analyze();

    expect(insights.totalRecoveryAttempts).toBe(0);
    expect(insights.recoverySuccessRate).toBe(0);
    expect(insights.recommendations).toEqual([]);
  });

  it('is read-only (does not modify operational data)', () => {
    const events = [
      { id: '1', timestamp: new Date().toISOString(), type: 'recovery_completed', component: 'comp', actionResult: 'success', correlationId: 'c1' },
    ];
    writeEvents(events);
    const eventsFile = path.join(opDir, 'operational-events.jsonl');
    const before = fs.readFileSync(eventsFile, 'utf8');

    const learning = new OperationalLearning(tmpDir);
    learning.analyze();

    const after = fs.readFileSync(eventsFile, 'utf8');
    expect(after).toBe(before);
  });
});
