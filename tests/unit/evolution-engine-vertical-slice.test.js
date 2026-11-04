'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { GitWorkspace } = require('../../lib/evolution-engine/git-workspace');
const { JobManager } = require('../../lib/mobile-ops/job-manager');
const { JOBS } = require('../../lib/mobile-ops/job-catalog');
const { runStructuredMemoryAudit } = require('../../heidi-core/memory/memory-commands');
const { ConversationStore } = require('../../heidi-core/memory/conversation-store');

describe('evolution vertical slice', () => {
  it('registers evolution.improvement job with fixed argv', () => {
    const steps = JOBS['evolution.improvement'].steps({ run_id: 'abc', item_id: 'imp-1', idempotency_key: 'k1' }, '/repo');
    expect(Array.isArray(steps)).toBe(true);
    expect(steps[0].args).toContain('scripts/evolution-execute.js');
    expect(steps[0].args).toContain('--run-id');
  });

  it('execute_async starts job and links run', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-vs-'));
    const { runAction } = require('../../lib/mobile-ops/action-runners');
    const jm = new JobManager({
      root: tmp,
      jobs: JOBS,
      spawn: () => ({ on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} }, pid: 1 }),
    });
    fs.mkdirSync(path.join(tmp, 'api'));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ scripts: { test: 'jest', typecheck: 'tsc' } }));
    fs.writeFileSync(path.join(tmp, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), '#');
    fs.writeFileSync(path.join(tmp, 'CONTRIBUTING.md'), '#');
    process.env.EVOLUTION_ALLOW_EXECUTE = 'true';

    return runAction('evolution.execute_async', { idempotency_key: 'idem-1', confirm: true }, {
      repoRoot: tmp,
      role: 'owner',
      operatorId: 'test',
      jobManager: jm,
    }).then((out) => {
      expect(out.ok).toBe(true);
      expect(out.result.run_id).toBeDefined();
      expect(out.result.job_id).toBeDefined();
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  it('git workspace uses worktree add (mocked)', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-git-'));
    const calls = [];
    const git = new GitWorkspace({
      repoRoot: repo,
      worktreesRoot: path.join(repo, '.runtime/evolution/worktrees'),
      execFile: async (cmd, args) => {
        calls.push([cmd, args.join(' ')]);
        return { stdout: '', stderr: '' };
      },
    });
    await git.createWorktree('run1', 'deadbeef');
    expect(calls.some((c) => c[1].includes('worktree add'))).toBe(true);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('structured memory audit passes on temp store', () => {
    const db = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-')), 'm.db');
    const store = new ConversationStore({ dbPath: db });
    const r = runStructuredMemoryAudit(store);
    expect(r.passed).toBe(r.total);
    expect(r.memory_retrieval_accuracy).toBe(1);
  });
});
