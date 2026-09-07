/**
 * HYDI Development Action Adapter
 *
 * Implements development operations: git status/branch/commit/push, run tests, build, deploy.
 * Wraps the existing ProcessAdapter for command execution with additional
 * verification specific to development operations.
 */

import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import type {
  ActionAdapter,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionObservation,
  ActionVerificationResult,
  HumanAction,
  RollbackResult,
} from '../HumanActionTypes';

const exec = promisify(execCb);

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

  async execute(
    action: HumanAction,
    _context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const startTime = Date.now();
    const cwd = (action.parameters.cwd as string) ?? action.target ?? process.cwd();

    try {
      let output: unknown;
      const evidence: ActionExecutionResult['evidence'] = [];

      switch (action.capability) {
        case 'dev.git_status': {
          const { stdout } = await exec('git status --porcelain', { cwd, timeout: 10000 });
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
          const { stdout } = await exec('git branch -a', { cwd, timeout: 10000 });
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
          // Stage all changes if requested
          if (action.parameters.stageAll) {
            await exec('git add -A', { cwd, timeout: 10000 });
          }
          // Write commit message to temp file to avoid shell escaping issues
          const msgFile = path.resolve(cwd, '.commit-msg-temp.txt');
          const fs = await import('fs');
          fs.writeFileSync(msgFile, message);
          const { stdout } = await exec(`git commit -F "${msgFile}"`, { cwd, timeout: 15000 });
          fs.unlinkSync(msgFile);
          output = { committed: true, output: stdout.trim() };
          evidence.push({
            check: 'git_commit',
            status: 'pass',
            value: `Commit created: ${stdout.trim().split('\n')[0]}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'dev.git_push': {
          const remote = (action.parameters.remote as string) ?? 'origin';
          const branch = (action.parameters.branch as string) ?? 'HEAD';
          const { stdout, stderr } = await exec(`git push ${remote} ${branch}`, {
            cwd, timeout: 30000,
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
          const testCmd = (action.parameters.command as string) ?? 'npm test';
          const { stdout, stderr } = await exec(testCmd, {
            cwd, timeout: 120000,
            env: { ...process.env, ...(action.parameters.env as Record<string, string> | undefined) },
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
          const buildCmd = (action.parameters.command as string) ?? 'npm run build';
          const { stdout, stderr } = await exec(buildCmd, {
            cwd, timeout: 120000,
            env: { ...process.env, ...(action.parameters.env as Record<string, string> | undefined) },
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
          const deployCmd = (action.parameters.command as string) ?? 'npm run deploy';
          const { stdout, stderr } = await exec(deployCmd, {
            cwd, timeout: 300000,
            env: { ...process.env, ...(action.parameters.env as Record<string, string> | undefined) },
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
    const cwd = (action.parameters.cwd as string) ?? process.cwd();
    try {
      switch (action.capability) {
        case 'dev.git_commit':
          await exec('git reset --soft HEAD~1', { cwd, timeout: 10000 });
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
    const cwd = target || process.cwd();
    try {
      const { stdout } = await exec('git rev-parse --is-inside-work-tree', { cwd, timeout: 5000 });
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
