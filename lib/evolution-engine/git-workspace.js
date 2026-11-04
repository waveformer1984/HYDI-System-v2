'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Isolated git worktree for evolution patches (never touches operator cwd).
 */
class GitWorkspace {
  /**
   * @param {{ repoRoot: string, worktreesRoot?: string, execFile?: Function }} opts
   */
  constructor(opts) {
    this.repoRoot = opts.repoRoot;
    this.worktreesRoot = opts.worktreesRoot || path.join(opts.repoRoot, '.runtime', 'evolution', 'worktrees');
    this.execFile = opts.execFile || execFileAsync;
  }

  async git(args, cwd = this.repoRoot) {
    const { stdout, stderr } = await this.execFile('git', args, { cwd, maxBuffer: 4 * 1024 * 1024 });
    return `${stdout}${stderr}`.trim();
  }

  /**
   * @param {string} runId
   * @param {string} baseSha
   */
  async createWorktree(runId, baseSha) {
    fs.mkdirSync(this.worktreesRoot, { recursive: true });
    const wtPath = path.join(this.worktreesRoot, runId);
    if (fs.existsSync(wtPath)) {
      return { ok: true, path: wtPath, reused: true };
    }
    await this.git(['worktree', 'add', '--detach', wtPath, baseSha || 'HEAD']);
    return { ok: true, path: wtPath, reused: false };
  }

  /**
   * @param {object} opts
   * @param {string} opts.runId
   * @param {string} opts.baseSha
   * @param {string} opts.branchName
   * @param {string} opts.patchRelPath path under worktree
   * @param {string} opts.patchBody
   * @param {boolean} [opts.createPr]
   * @param {string} [opts.prTitle]
   * @param {string} [opts.prBodyPath]
   */
  async applyPatchAndOptionalPr(opts) {
    const wt = await this.createWorktree(opts.runId, opts.baseSha);
    const branch = opts.branchName || `evolution/${opts.runId}`;
    await this.git(['checkout', '-b', branch], wt.path);
    const target = path.join(wt.path, opts.patchRelPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, opts.patchBody);
    await this.git(['add', opts.patchRelPath], wt.path);
    await this.git(['commit', '-m', `evolution(${opts.runId}): bounded workspace patch`], wt.path);
    let pr_url = null;
    if (opts.createPr && process.env.EVOLUTION_ALLOW_PR === 'true') {
      try {
        await this.execFile('git', ['push', '-u', 'origin', branch], { cwd: wt.path, maxBuffer: 4 * 1024 * 1024 });
        const prArgs = ['pr', 'create', '--base', 'clean-main', '--head', branch, '--title', opts.prTitle || `Evolution ${opts.runId}`, '--body-file', opts.prBodyPath];
        const { stdout } = await this.execFile('gh', prArgs, { cwd: this.repoRoot, maxBuffer: 1024 * 1024 });
        const m = stdout.match(/https:\/\/[^\s]+/);
        pr_url = m ? m[0] : stdout.trim();
      } catch (err) {
        return {
          ok: true,
          worktree: wt.path,
          branch,
          pr_error: err instanceof Error ? err.message : 'pr_failed',
        };
      }
    }
    return { ok: true, worktree: wt.path, branch, pr_url };
  }

  async removeWorktree(runId) {
    const wtPath = path.join(this.worktreesRoot, runId);
    if (!fs.existsSync(wtPath)) return { ok: true, removed: false };
    try {
      await this.git(['worktree', 'remove', '--force', wtPath]);
    } catch {
      fs.rmSync(wtPath, { recursive: true, force: true });
    }
    return { ok: true, removed: true };
  }
}

module.exports = { GitWorkspace };
