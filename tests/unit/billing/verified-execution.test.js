'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTask, loadTask, taskDir } = require('../../../lib/billing/sandbox-workflow');
const { runVerifiedBillingExecution, resumeVerifiedExecution } = require('../../../lib/billing/verified-execution');

describe('verified billing execution', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-verify-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('persists structured checks and never marks live stages PASS', async () => {
    const task = createTask(root);
    const { checks, readiness } = await runVerifiedBillingExecution(task, root, { runHermetic: true });
    const live = checks.filter((c) => c.check_id.startsWith('E.') || c.check_id.startsWith('F.') || c.check_id.startsWith('G.'));
    expect(live.every((c) => c.status === 'NOT_RUN' || c.status === 'NEEDS_HUMAN')).toBe(true);
    expect(readiness.merge_eligible).toBe(false);
    const saved = loadTask(root, task.id);
    expect(saved.verified_checks.length).toBeGreaterThan(5);
    expect(saved.readiness.operator_actions.length).toBeGreaterThan(0);
  });

  it('resumes an existing task id', async () => {
    const task = createTask(root);
    await runVerifiedBillingExecution(task, root, { runHermetic: false });
    const second = await resumeVerifiedExecution(root, task.id, { runHermetic: false });
    expect(second.task.id).toBe(task.id);
    expect(fs.existsSync(taskPath(root, task.id))).toBe(true);
  });
});

function taskPath(root, taskId) {
  return path.join(taskDir(root), `${taskId}.json`);
}
