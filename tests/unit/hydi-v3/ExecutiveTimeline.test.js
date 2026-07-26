'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { EventEmitter } = require('events');
const ExecutiveTimeline = require('../../../src/hydi-v3/ExecutiveTimeline');

describe('ExecutiveTimeline', () => {
  let dataPath;
  let executionGateway;
  let workflowEngine;
  let executiveOS;
  let cockpit;
  let timeline;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-timeline-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    executionGateway = new EventEmitter();
    workflowEngine = new EventEmitter();
    executiveOS = new EventEmitter();
    cockpit = new EventEmitter();
    timeline = new ExecutiveTimeline({
      dataPath,
      executionGateway,
      workflowEngine,
      executiveOS,
      cockpit,
      logger: { log: () => {}, error: () => {} },
    });
    await timeline.start();
  });

  afterEach(async () => {
    if (timeline) await timeline.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('lifecycle methods work', async () => {
    expect(timeline.healthCheck().ok).toBe(true);
    await timeline.flush();
    timeline.stop();
    await timeline.destroy();
    expect(timeline._destroyed).toBe(true);
  });

  test('records execution gateway events', () => {
    executionGateway.emit('action-completed', { id: 'a1', type: 'create-report' });
    executionGateway.emit('approval-required', { id: 'a2', type: 'draft-email', requestingAgent: 'Sales Manager' });
    const events = timeline.list({ category: 'execution' });
    expect(events.length).toBe(1);
    expect(events[0].summary).toContain('create-report');
    const approvals = timeline.list({ category: 'approval' });
    expect(approvals.length).toBe(1);
  });

  test('records workflow engine events', () => {
    workflowEngine.emit('workflow-created', { id: 'wf1', title: 'Follow up lead', type: 'sales' });
    workflowEngine.emit('workflow-completed', { id: 'wf1', title: 'Follow up lead' });
    const events = timeline.list({ category: 'workflow' });
    expect(events.length).toBe(2);
  });

  test('records briefing and conversation events', () => {
    executiveOS.emit('briefing', { generatedAt: Date.now(), priorityActions: [1, 2], risks: [] });
    cockpit.emit('interaction', { text: 'status', command: 'status' });
    expect(timeline.list({ category: 'briefing' }).length).toBe(1);
    expect(timeline.list({ category: 'conversation' }).length).toBe(1);
  });

  test('manual record supports system and backup categories', () => {
    timeline.record('backup', 'Backup completed', { files: 3 });
    timeline.record('system', 'Server started');
    expect(timeline.list({ category: 'backup' }).length).toBe(1);
    expect(timeline.list({ category: 'system' }).length).toBe(1);
  });

  test('list is newest-first and respects limit', () => {
    for (let i = 0; i < 5; i++) timeline.record('system', `event ${i}`);
    const all = timeline.list();
    expect(all[0].summary).toBe('event 4');
    const limited = timeline.list({ limit: 2 });
    expect(limited.length).toBe(2);
  });

  test('since() groups events by category', () => {
    const cutoff = Date.now();
    timeline.record('workflow', 'after cutoff');
    const diff = timeline.since(cutoff);
    expect(diff.count).toBeGreaterThanOrEqual(1);
    expect(diff.byCategory.workflow.length).toBeGreaterThanOrEqual(1);
  });

  test('persists and restores across instances', async () => {
    timeline.record('system', 'persisted event');
    await timeline.destroy();

    const restored = new ExecutiveTimeline({ dataPath, logger: { log: () => {}, error: () => {} } });
    await restored.start();
    expect(restored.list().some((e) => e.summary === 'persisted event')).toBe(true);
    await restored.destroy();
    timeline = null;
  });

  test('recovers from corrupted persistence', async () => {
    await timeline.destroy();
    await fs.writeFile(path.join(dataPath, 'executive-timeline.json'), 'not-json {');
    const restored = new ExecutiveTimeline({ dataPath, logger: { log: () => {}, error: () => {} } });
    await expect(restored.start()).resolves.toBeUndefined();
    expect(restored.healthCheck().ok).toBe(true);
    await restored.destroy();
    timeline = null;
  });

  test('stop() unsubscribes from event sources', () => {
    timeline.stop();
    executionGateway.emit('action-completed', { id: 'a1', type: 'create-report' });
    expect(timeline.list({ category: 'execution' }).length).toBe(0);
  });
});
