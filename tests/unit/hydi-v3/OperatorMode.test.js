'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../../../src/hydi-v3/OperatorSession');
const OperatorMode = require('../../../src/hydi-v3/OperatorMode');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

async function makeSession(extra = {}) {
  const dataPath = path.join(os.tmpdir(), `heidi-mode-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dataPath, { recursive: true });
  const session = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10, ...extra });
  await session.start();
  return { session, dataPath };
}

/** Queue a review-required action so there is something real to approve. */
async function pendingAction(session) {
  const queued = await session.executionGateway.execute({
    type: 'update-markdown',
    requestingAgent: 'Operations Manager',
    params: { path: 'notes.md', content: 'hello' },
  });
  return queued.id;
}

describe('OperatorMode', () => {
  let session;
  let dataPath;

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    session = null;
  });

  test('is inert when no mode is active', async () => {
    const mode = new OperatorMode({});
    expect(mode.enabled).toBe(false);
    expect(mode.active).toEqual([]);
    expect(mode.describe()).toContain('live mode');

    ({ session, dataPath } = await makeSession({ mode }));
    const id = await pendingAction(session);
    const result = await session.executionGateway.approve(id);
    expect(result.status).toBe('completed');
    expect(mode.journal).toHaveLength(0);
  });

  test('describes active modes', () => {
    expect(new OperatorMode({ dryRun: true }).active).toEqual(['dry-run']);
    expect(new OperatorMode({ offline: true }).active).toEqual(['offline']);
    expect(new OperatorMode({ dryRun: true, offline: true }).active).toEqual(['dry-run', 'offline']);
    expect(new OperatorMode({ dryRun: true }).describe()).toContain('DRY RUN');
    expect(new OperatorMode({ offline: true }).describe()).toContain('OFFLINE');
  });

  describe('dry run', () => {
    let mode;

    beforeEach(async () => {
      mode = new OperatorMode({ dryRun: true });
      ({ session, dataPath } = await makeSession({ mode }));
    });

    test('approve simulates instead of executing and leaves the action pending', async () => {
      const id = await pendingAction(session);
      const before = session.executionGateway.pending.size;

      const result = await session.executionGateway.approve(id);

      expect(result.dryRun).toBe(true);
      expect(result.approved).toBe(false);
      expect(result.status).toBe('simulated');
      expect(result.result).toBeTruthy();
      expect(result.text).toContain('[dry run]');
      // Still pending — nothing was consumed.
      expect(session.executionGateway.pending.size).toBe(before);
      expect(session.executionGateway.pending.has(id)).toBe(true);
    });

    test('approve records no completed execution in the audit log', async () => {
      const id = await pendingAction(session);
      await session.executionGateway.approve(id);
      const completed = session.executionGateway.getExecutionHistory({ status: 'completed' });
      expect(completed).toHaveLength(0);
    });

    test('reject and requestModification leave the pending action untouched', async () => {
      const id = await pendingAction(session);

      const rejected = session.executionGateway.reject(id);
      expect(rejected.dryRun).toBe(true);
      expect(session.executionGateway.pending.has(id)).toBe(true);

      const modified = session.executionGateway.requestModification(id, 'tighten wording');
      expect(modified.dryRun).toBe(true);
      expect(session.executionGateway.pending.get(id).modificationRequested).toBeFalsy();
    });

    test('autonomous execute is routed down the gateway simulate path', async () => {
      const result = await session.executionGateway.execute({
        type: 'create-report',
        requestingAgent: 'Operations Manager',
        params: { title: 'Weekly' },
      });
      expect(result.status).toBe('completed');
      expect(result.result.simulated).toBe(true);
    });

    test('workflow approvals are simulated', async () => {
      const result = session.workflowEngine.approveWorkflow('wf_test');
      expect(result.dryRun).toBe(true);
      expect(result.text).toContain('[dry run]');
    });

    test('backup writes no files', async () => {
      const result = await session.consoleAPI.backup();
      expect(result.dryRun).toBe(true);
      expect(result.files).toBe(0);
      await expect(fs.readdir(path.join(dataPath, 'backups'))).rejects.toThrow();
    });

    test('read-only commands still work normally', async () => {
      const response = await session.ask('help');
      expect(response.text).toBeTruthy();
      expect(session.briefing()).toHaveProperty('executiveSummary');
    });

    test('journal and summary record every interception', async () => {
      const id = await pendingAction(session);
      await session.executionGateway.approve(id);
      session.executionGateway.reject(id);
      await session.consoleAPI.backup();

      expect(mode.journal.length).toBe(3);
      const summary = mode.summary();
      expect(summary).toContain('3 intercepted action(s)');
      expect(summary).toContain('approve');
      expect(summary).toContain('reject');
      expect(summary).toContain('backup');
    });

    test('summary is explicit when nothing was attempted', () => {
      expect(new OperatorMode({ dryRun: true }).summary()).toContain('no mutating actions');
    });

    test('uninstall restores real behaviour', async () => {
      const id = await pendingAction(session);
      mode.uninstall();
      const result = await session.executionGateway.approve(id);
      expect(result.status).toBe('completed');
      expect(result.dryRun).toBeUndefined();
    });
  });

  describe('offline', () => {
    test('refuses network-dependent action types', async () => {
      const mode = new OperatorMode({ offline: true });
      ({ session, dataPath } = await makeSession({ mode }));

      await expect(session.executionGateway.execute({
        type: 'send-email',
        requestingAgent: 'Sales Manager',
        params: { to: 'a@b.c' },
      })).rejects.toThrow(/offline mode is active/);

      expect(mode.journal.some((e) => e.operation === 'offline-refusal')).toBe(true);
    });

    test('allows local action types', async () => {
      const mode = new OperatorMode({ offline: true });
      ({ session, dataPath } = await makeSession({ mode }));

      const result = await session.executionGateway.execute({
        type: 'create-report',
        requestingAgent: 'Operations Manager',
        params: { title: 'Local only' },
      });
      expect(result.status).toBe('completed');
    });

    test('preflight verifies the stack is local-only', async () => {
      const mode = new OperatorMode({ offline: true });
      ({ session, dataPath } = await makeSession({ mode }));

      const check = mode.verifyOffline(session);
      expect(check.name).toBe('OfflineMode');
      expect(check.ok).toBe(true);
      expect(check.networkCapable).toEqual([]);
    });

    test('preflight flags a runtime-registered network-capable adapter', async () => {
      const mode = new OperatorMode({ offline: true });
      ({ session, dataPath } = await makeSession({ mode }));

      session.executionGateway.addAdapter({
        name: 'rogue',
        allowedActions: ['send-email'],
        supports: (t) => t === 'send-email',
        execute: async () => ({ sent: true }),
        simulate: async () => ({ simulated: true }),
      });

      const check = mode.verifyOffline(session);
      expect(check.ok).toBe(false);
      expect(check.networkCapable[0].type).toBe('send-email');
    });

    test('verifyOffline returns null when offline is not active', async () => {
      const mode = new OperatorMode({ dryRun: true });
      ({ session, dataPath } = await makeSession({ mode }));
      expect(mode.verifyOffline(session)).toBeNull();
    });
  });

  test('dry run and offline compose: offline refusal wins over simulation', async () => {
    const mode = new OperatorMode({ dryRun: true, offline: true });
    ({ session, dataPath } = await makeSession({ mode }));

    await expect(session.executionGateway.execute({
      type: 'send-email',
      requestingAgent: 'Sales Manager',
      params: {},
    })).rejects.toThrow(/offline mode is active/);
  });
});

describe('ExecutionGateway simulate flag', () => {
  let session;
  let dataPath;

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    session = null;
  });

  test('approve honours the gateway-wide simulate config', async () => {
    ({ session, dataPath } = await makeSession());
    session.executionGateway.config.simulate = true;

    const id = await pendingAction(session);
    const result = await session.executionGateway.approve(id);

    expect(result.status).toBe('completed');
    expect(result.result.simulated).toBe(true);
  });
});
