'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const BusinessMemory = require('../../../src/hydi-v3/BusinessMemory');
const ExecutiveOperatingSystem = require('../../../src/hydi-v3/ExecutiveOperatingSystem');
const { ExecutionGateway } = require('../../../src/hydi-v3/ExecutionGateway');
const { BusinessWorkflowEngine } = require('../../../src/hydi-v3/BusinessWorkflowEngine');
const StrategicObjectives = require('../../../src/hydi-v3/StrategicObjectives');
const ApprovalCenter = require('../../../src/hydi-v3/ApprovalCenter');

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

describe('ApprovalCenter', () => {
  let dataPath;
  let memory;
  let executiveOS;
  let executionGateway;
  let workflowEngine;
  let strategicObjectives;
  let center;
  let pendingExec;
  let wfId;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-approvalcenter-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });

    memory = new BusinessMemory({ dataPath, logger: SILENT });
    await memory.start();
    strategicObjectives = new StrategicObjectives({ ownerPriority: 'default' });

    executiveOS = new ExecutiveOperatingSystem({ dataPath, businessMemory: memory, strategicObjectives, logger: SILENT });
    await executiveOS.start();

    executionGateway = new ExecutionGateway({ dataPath, businessMemory: memory, logger: SILENT });
    await executionGateway.start();
    pendingExec = await executionGateway.execute({
      type: 'draft-email', params: { to: 'client@example.com' }, requestingAgent: 'Sales Manager',
    });

    workflowEngine = new BusinessWorkflowEngine({
      dataPath, businessMemory: memory, executiveOS, strategicObjectives, logger: SILENT,
    });
    await workflowEngine.start();
    wfId = workflowEngine.createWorkflow({
      type: 'sales', title: 'Big deal proposal', assignedAgent: 'Sales Manager', expectedValue: 4000, probability: 0.7,
    });
    workflowEngine.workflows.get(wfId).status = 'awaiting-approval';

    center = new ApprovalCenter({ executionGateway, workflowEngine, strategicObjectives });
  });

  afterEach(async () => {
    await workflowEngine.destroy().catch(() => {});
    await executionGateway.destroy().catch(() => {});
    await executiveOS.destroy().catch(() => {});
    await memory.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('lists merged execution and workflow approvals', () => {
    const list = center.list();
    expect(list.length).toBe(2);
    expect(list.some((a) => a.kind === 'execution')).toBe(true);
    expect(list.some((a) => a.kind === 'workflow')).toBe(true);
  });

  test('enriched record includes business value, risk, resources, agent, plan', () => {
    const wfItem = center.get(wfId);
    expect(wfItem.businessValue).toBe(4000);
    expect(wfItem.responsibleAgent).toBe('Sales Manager');
    expect(Array.isArray(wfItem.executionPlan)).toBe(true);
    expect(wfItem.executionPlan.length).toBeGreaterThan(0);
    expect(wfItem.risk).toBeCloseTo(0.3, 5);
  });

  test('explain answers why/expected outcome/impact/risk/effort/objective/confidence/approval', () => {
    const explained = center.explain(wfId);
    expect(explained.ok).toBe(true);
    for (const key of ['why', 'expectedOutcome', 'businessImpact', 'risk', 'estimatedEffort', 'strategicObjective', 'confidence', 'requiredApproval']) {
      expect(explained).toHaveProperty(key);
    }
  });

  test('simulate previews without mutating pending state', async () => {
    const before = center.list().length;
    const sim = await center.simulate(pendingExec.id);
    expect(sim.ok).toBe(true);
    expect(center.list().length).toBe(before);
  });

  test('requestModification attaches notes without approving/rejecting', () => {
    const result = center.requestModification(wfId, 'Lower the price 10%');
    expect(result.ok).toBe(true);
    expect(center.get(wfId).modificationRequested).toBe(true);
    expect(center.get(wfId).modificationNotes).toContain('10%');
  });

  test('approve routes workflow approvals through BusinessWorkflowEngine', async () => {
    const result = await center.approve(wfId);
    expect(result.ok).toBe(true);
    expect(center.list().length).toBe(1);
    expect(workflowEngine.getWorkflow(wfId).approved).toBe(true);
  });

  test('approve routes execution approvals through ExecutionGateway', async () => {
    const result = await center.approve(pendingExec.id);
    expect(result.ok).toBe(true);
    expect(result.result.status).toBe('completed');
  });

  test('reject removes the item from the pending list', () => {
    const result = center.reject(pendingExec.id);
    expect(result.ok).toBe(true);
    expect(center.list().some((a) => a.id === pendingExec.id)).toBe(false);
  });

  test('unknown id returns ok:false without throwing', async () => {
    expect((await center.approve('missing')).ok).toBe(false);
    expect(center.reject('missing').ok).toBe(false);
    expect((await center.simulate('missing')).ok).toBe(false);
    expect(center.explain('missing').ok).toBe(false);
  });
});
