/**
 * HYDI Development Action Adapter
 *
 * Implements development operations: git status/branch/commit/push, run tests, build, deploy.
 * Wraps the existing ProcessAdapter for command execution with additional
 * verification specific to development operations.
 */

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { buildChildEnv } from './safe-child-env';
import type {
  ActionAdapter,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionObservation,
  ActionVerificationResult,
  HumanAction,
  RollbackResult,
} from '../HumanActionTypes';

const execFile = promisify(execFileCb);

/**
 * Fixed dev commands. run_tests / build / deploy previously executed
 * `action.parameters.command` verbatim through a shell — arbitrary code
 * execution reachable by any caller (red-team 2026-09-18). There is no such
 * thing as a safe caller-supplied shell command, so these are fixed argv
 * arrays executed via execFile (no shell interpretation). A capability that
 * needs a different command needs a different allowlist entry, not a free
 * `command` parameter.
 */
const DEV_COMMANDS: Record<string, { file: string; args: string[]; timeoutMs: number }> = {
  'dev.git_status': { file: 'git', args: ['status', '--porcelain'], timeoutMs: 10000 },
  'dev.git_branch': { file: 'git', args: ['branch', '-a'], timeoutMs: 10000 },
  'dev.run_tests': { file: 'npm', args: ['test'], timeoutMs: 120000 },
  'dev.build': { file: 'npm', args: ['run', 'build'], timeoutMs: 120000 },
  'dev.deploy': { file: 'npm', args: ['run', 'deploy'], timeoutMs: 300000 },
};

/** A git branch/ref token — no spaces, quotes, or shell metacharacters. */
const SAFE_GIT_REF = /^[A-Za-z0-9._/-]{1,128}$/;

/**
 * A git *remote name* — stricter than a ref. `SAFE_GIT_REF` permits `.` and
 * `/`, so `remote: '../victim-repo'` passed validation and `git push
 * ../victim-repo HEAD` wrote objects into a repository OUTSIDE the confined
 * cwd (red-team 2026-09-18). A remote must be a configured remote name —
 * letters, digits, `_`, `-` only; no path syntax, no `:` (URL/SCP syntax),
 * no `.`/`/` (filesystem traversal).
 */
const SAFE_GIT_REMOTE = /^[A-Za-z0-9_-]{1,64}$/;

// NAMING COLLISION: there is a SEPARATE, unrelated class also named
// `DevelopmentAdapter` at src/hydi-v3/CapabilityAdapters.js (extends that
// file's CapabilityAdapter, HYDI V3 reliability layer only). THIS one is
// the HumanActionEngine's real adapter -- it actually shells out via
// exec()/execSync() to git/npm/deploy commands (see the audit note on
// this file re: command construction). Check which tree a given consumer
// lives in before assuming which "DevelopmentAdapter" it imports.
export class DevelopmentAdapter implements ActionAdapter {
  adapterId = 'development';
  category = 'DEVELOPMENT' as const;
  capabilities = [
    'dev.git_status',
    'dev.git_branch',
    'dev.git_commit',
    'dev.git_push',
    'dev.run_tests',
    'dev.build',
    'dev.deploy',
  ];

  private repoRoot: string;

  constructor(options?: { repoRoot?: string }) {
    this.repoRoot = path.resolve(options?.repoRoot ?? process.cwd());
  }

  /**
   * A dev action's working directory must stay inside the repo. A caller-
   * controlled `cwd` pointing at an arbitrary directory would let a dev
   * command (or a commit-message temp file) act on an unrelated tree.
   * Resolves `..`, symlinks via realpath where it exists, and fails closed.
   */
  private resolveCwd(cwdParam?: string, target?: string): string {
    const raw = cwdParam ?? target ?? this.repoRoot;
    let resolved: string;
    try {
      resolved = path.resolve(raw);
      // realpath canonicalises the deepest existing ancestor so a symlink
      // cannot smuggle the cwd out of the repo.
      if (require('fs').existsSync(resolved)) {
        resolved = require('fs').realpathSync(resolved);
      }
    } catch {
      throw new Error(`cwd is not a resolvable directory: ${String(raw)}`);
    }
    const realRoot = require('fs').existsSync(this.repoRoot)
      ? require('fs').realpathSync(this.repoRoot)
      : this.repoRoot;
    const rel = path.relative(realRoot, resolved);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error(`cwd escapes the repository root: ${resolved}`);
    }
    return resolved;
  }

  async execute(
    action: HumanAction,
    _context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const startTime = Date.now();
    let cwd: string;
    try {
      cwd = this.resolveCwd(action.parameters.cwd as string, action.target);
    } catch (e) {
      return {
        executed: false, output: null,
        error: e instanceof Error ? e.message : 'cwd rejected',
        evidence: [], durationMs: Date.now() - startTime,
      };
    }

    try {
      let output: unknown;
      const evidence: ActionExecutionResult['evidence'] = [];

      switch (action.capability) {
        case 'dev.git_status': {
          const { stdout } = await execFile('git', ['status', '--porcelain'], { cwd, timeout: 10000, windowsHide: true });
          const lines = stdout.trim().split('\n').filter((l) => l.trim());
          output = { status: stdout.trim(), changedFiles: lines.length };
          evidence.push({
            check: 'git_status',
            status: 'pass',
            value: `${lines.length} changed files`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'dev.git_branch': {
          const { stdout } = await execFile('git', ['branch', '-a'], { cwd, timeout: 10000, windowsHide: true });
          const branches = stdout.trim().split('\n').map((b) => b.trim());
          output = { branches, current: branches.find((b) => b.startsWith('*')) };
          evidence.push({
            check: 'git_branch',
            status: 'pass',
            value: `${branches.length} branches`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'dev.git_commit': {
          const message = action.parameters.message as string;
          if (!message) throw new Error('No commit message provided');
          // NOTE: `git add -A` stages EVERYTHING in the repo, including secrets
          // and protected files. It is not run here — staging is a deliberate
          // human/explicit step; an autonomous commit only records what is
          // already staged. Callers that need staging must do it explicitly.
          const fs = await import('fs');
          const msgFile = path.resolve(cwd, '.commit-msg-temp.txt');
          fs.writeFileSync(msgFile, message);
          try {
            const { stdout } = await execFile('git', ['commit', '-F', msgFile], { cwd, timeout: 15000, windowsHide: true });
            output = { committed: true, output: stdout.trim() };
          } finally {
            try { fs.unlinkSync(msgFile); } catch { /* best effort */ }
          }
          evidence.push({
            check: 'git_commit',
            status: 'pass',
            value: 'Commit created',
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'dev.git_push': {
          const remote = (action.parameters.remote as string) ?? 'origin';
          const branch = (action.parameters.branch as string) ?? 'HEAD';
          if (!SAFE_GIT_REMOTE.test(remote) || !SAFE_GIT_REF.test(branch)) {
            throw new Error(`Refused push to unsafe remote/branch: ${remote} ${branch}`);
          }
          const { stdout, stderr } = await execFile('git', ['push', remote, branch], {
            cwd, timeout: 30000, windowsHide: true,
          });
          output = { pushed: true, output: stdout.trim(), stderr: stderr.trim() };
          evidence.push({
            check: 'git_push',
            status: 'pass',
            value: `Pushed to ${remote}/${branch}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'dev.run_tests': {
          // Fixed command — parameters.command is ignored on purpose. Accepting
          // a caller-supplied command here was arbitrary code execution.
          const cmd = DEV_COMMANDS['dev.run_tests'];
          const { stdout, stderr } = await execFile(cmd.file, cmd.args, {
            cwd, timeout: cmd.timeoutMs, windowsHide: true,
            // parameters.env is NOT merged — env vars like NODE_OPTIONS or
            // npm_config_* are arbitrary code execution inside the child
            // toolchain (red-team 2026-09-18). Only benign flags pass.
            env: buildChildEnv(action.parameters.env),
          });
          const passed = !stdout.includes('failed') && !stderr.includes('failed');
          output = { stdout: stdout.slice(-2000), stderr: stderr.slice(-2000), passed };
          evidence.push({
            check: 'tests_run',
            status: passed ? 'pass' : 'fail',
            value: passed ? 'Tests passed' : 'Tests failed',
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'dev.build': {
          const cmd = DEV_COMMANDS['dev.build'];
          const { stdout, stderr } = await execFile(cmd.file, cmd.args, {
            cwd, timeout: cmd.timeoutMs, windowsHide: true,
            env: buildChildEnv(action.parameters.env),
          });
          output = { stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) };
          evidence.push({
            check: 'build_completed',
            status: 'pass',
            value: 'Build completed',
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'dev.deploy': {
          const cmd = DEV_COMMANDS['dev.deploy'];
          const { stdout, stderr } = await execFile(cmd.file, cmd.args, {
            cwd, timeout: cmd.timeoutMs, windowsHide: true,
            env: buildChildEnv(action.parameters.env),
          });
          output = { stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) };
          evidence.push({
            check: 'deploy_completed',
            status: 'pass',
            value: 'Deploy completed',
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        default:
          return {
            executed: false, output: null,
            error: `Unsupported capability: ${action.capability}`,
            evidence: [], durationMs: Date.now() - startTime,
          };
      }

      return {
        executed: true, output, error: null, evidence,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      // For git commands, non-zero exit may still produce useful output
      const output = { stdout: error.stdout ?? '', stderr: error.stderr ?? error.message };
      return {
        executed: false,
        output,
        error: error.message ?? 'Unknown error',
        evidence: [{
          check: 'execution_error',
          status: 'fail',
          value: error.message ?? 'Unknown error',
          checkedAt: new Date().toISOString(),
        }],
        durationMs: Date.now() - startTime,
      };
    }
  }

  async verify(
    action: HumanAction,
    executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<ActionVerificationResult> {
    const evidence: ActionVerificationResult['evidence'] = [];
    if (!executionResult.executed) {
      return { verified: false, evidence, reason: 'Action was not executed' };
    }

    const hasPass = executionResult.evidence.some((e) => e.status === 'pass');
    evidence.push({
      check: 'execution_evidence',
      status: hasPass ? 'pass' : 'fail',
      value: hasPass ? 'Passing evidence present' : 'No passing evidence',
      checkedAt: new Date().toISOString(),
    });

    return {
      verified: hasPass,
      evidence,
      reason: hasPass ? 'Development operation verified' : 'Verification failed',
    };
  }

  async rollback(
    action: HumanAction,
    _executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<RollbackResult> {
    let cwd: string;
    try {
      cwd = this.resolveCwd(action.parameters.cwd as string, action.target);
    } catch {
      cwd = this.repoRoot;
    }
    try {
      switch (action.capability) {
        case 'dev.git_commit':
          await execFile('git', ['reset', '--soft', 'HEAD~1'], { cwd, timeout: 10000, windowsHide: true });
          return { attempted: true, succeeded: true, evidence: 'Undo last commit (soft reset)' };
        case 'dev.git_push':
          return { attempted: false, succeeded: false, evidence: 'Cannot undo push', error: 'Irreversible' };
        default:
          return { attempted: false, succeeded: false, evidence: 'No rollback strategy', error: 'Not reversible' };
      }
    } catch (error) {
      return {
        attempted: true, succeeded: false,
        evidence: 'Rollback failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  isAvailable(): { available: boolean; reason: string | null } {
    return { available: true, reason: null };
  }

  async observe(target: string, _context: ActionExecutionContext): Promise<ActionObservation> {
    // Confine to the repo root — an arbitrary cwd would let observe probe
    // (and a later commit write a temp file into) an unrelated directory.
    let cwd = this.repoRoot;
    try {
      cwd = this.resolveCwd(target, target);
    } catch { /* fall back to repoRoot */ }
    try {
      const { stdout } = await execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeout: 5000, windowsHide: true });
      const isGitRepo = stdout.trim() === 'true';
      return {
        target: cwd,
        exists: isGitRepo,
        state: isGitRepo ? 'git_repository' : 'not_a_git_repo',
        properties: {},
        observedAt: new Date().toISOString(),
      };
    } catch {
      return {
        target: cwd,
        exists: false,
        state: 'not_a_git_repo',
        properties: {},
        observedAt: new Date().toISOString(),
      };
    }
  }
}
