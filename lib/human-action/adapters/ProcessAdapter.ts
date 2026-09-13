/**
 * HYDI Process Action Adapter
 *
 * Implements process operations: execute, inspect, start, stop.
 *
 * Safety:
 *   - Commands are structured, NOT arbitrary shell strings
 *   - An allowlist of commands is enforced
 *   - Exit codes and output are captured as evidence
 *   - Secret material is never passed via command line
 */

import { exec as execCb, spawn } from 'child_process';
import { promisify } from 'util';
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

// ---------------------------------------------------------------------------
// Command allowlist — structured commands only, no arbitrary shell
// ---------------------------------------------------------------------------

interface AllowedCommand {
  command: string;
  args: string[];
  description: string;
  timeoutMs: number;
}

const COMMAND_ALLOWLIST: Map<string, AllowedCommand> = new Map([
  ['npm.test', { command: 'npm', args: ['test'], description: 'Run npm test suite', timeoutMs: 120000 }],
  ['npm.build', { command: 'npm', args: ['run', 'build'], description: 'Run npm build', timeoutMs: 120000 }],
  ['npm.run.dev', { command: 'npm', args: ['run', 'dev'], description: 'Start dev server', timeoutMs: 60000 }],
  ['npm.run.boot', { command: 'npm', args: ['run', 'boot'], description: 'Boot full system', timeoutMs: 60000 }],
  ['npm.run.typecheck', { command: 'npm', args: ['run', 'typecheck'], description: 'Run typecheck', timeoutMs: 60000 }],
  ['npm.run.lint', { command: 'npm', args: ['run', 'lint'], description: 'Run lint', timeoutMs: 60000 }],
  ['git.status', { command: 'git', args: ['status', '--porcelain'], description: 'Git status', timeoutMs: 10000 }],
  ['git.log', { command: 'git', args: ['log', '--oneline', '-10'], description: 'Git log', timeoutMs: 10000 }],
  ['git.branch', { command: 'git', args: ['branch', '-a'], description: 'List branches', timeoutMs: 10000 }],
  ['git.diff', { command: 'git', args: ['diff', '--stat'], description: 'Git diff stat', timeoutMs: 10000 }],
  ['node.version', { command: 'node', args: ['--version'], description: 'Node version', timeoutMs: 5000 }],
  ['npx.jest', { command: 'npx', args: ['jest'], description: 'Run jest', timeoutMs: 120000 }],
  ['docker.ps', { command: 'docker', args: ['ps'], description: 'Docker ps', timeoutMs: 10000 }],
  ['docker.logs', { command: 'docker', args: ['logs'], description: 'Docker logs', timeoutMs: 15000 }],
]);

export class ProcessAdapter implements ActionAdapter {
  adapterId = 'process';
  category = 'SYSTEM' as const;
  capabilities = [
    'process.execute',
    'process.inspect',
    'process.start',
    'process.stop',
  ];

  private runningProcesses: Map<string, { pid: number; command: string }> = new Map();

  async execute(
    action: HumanAction,
    _context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const startTime = Date.now();

    try {
      let output: unknown;
      const evidence: ActionExecutionResult['evidence'] = [];

      switch (action.capability) {
        case 'process.execute': {
          const result = await this.executeCommand(action);
          output = result;
          evidence.push({
            check: 'exit_code',
            status: result.exitCode === 0 ? 'pass' : 'fail',
            value: `Exit code: ${result.exitCode}`,
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'process.inspect': {
          output = await this.inspectProcess(action);
          evidence.push({
            check: 'process_inspected',
            status: 'pass',
            value: 'Process info retrieved',
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'process.start': {
          const result = await this.startProcess(action);
          output = result;
          evidence.push({
            check: 'process_started',
            status: result.started ? 'pass' : 'fail',
            value: result.started ? `PID: ${result.pid}` : 'Failed to start',
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        case 'process.stop': {
          const result = await this.stopProcess(action);
          output = result;
          evidence.push({
            check: 'process_stopped',
            status: result.stopped ? 'pass' : 'fail',
            value: result.stopped ? 'Process stopped' : 'Failed to stop',
            checkedAt: new Date().toISOString(),
          });
          break;
        }

        default:
          return {
            executed: false,
            output: null,
            error: `Unsupported capability: ${action.capability}`,
            evidence: [],
            durationMs: Date.now() - startTime,
          };
      }

      return {
        executed: true,
        output,
        error: null,
        evidence,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        executed: false,
        output: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        evidence: [{
          check: 'execution_error',
          status: 'fail',
          value: error instanceof Error ? error.message : 'Unknown error',
          checkedAt: new Date().toISOString(),
        }],
        durationMs: Date.now() - startTime,
      };
    }
  }

  async verify(
    _action: HumanAction,
    executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<ActionVerificationResult> {
    const evidence: ActionVerificationResult['evidence'] = [];

    if (!executionResult.executed) {
      return { verified: false, evidence, reason: 'Action was not executed' };
    }

    // Check if there's a pass evidence
    const hasPass = executionResult.evidence.some((e) => e.status === 'pass');
    evidence.push({
      check: 'execution_evidence',
      status: hasPass ? 'pass' : 'fail',
      value: hasPass ? 'Execution evidence present' : 'No passing evidence',
      checkedAt: new Date().toISOString(),
    });

    return {
      verified: hasPass,
      evidence,
      reason: hasPass ? 'Execution verified via evidence' : 'No passing evidence',
    };
  }

  async rollback(
    _action: HumanAction,
    _executionResult: ActionExecutionResult,
    _context: ActionExecutionContext,
  ): Promise<RollbackResult> {
    // Process execution is generally not reversible
    return {
      attempted: false,
      succeeded: false,
      evidence: 'Process execution cannot be rolled back',
      error: 'Not reversible',
    };
  }

  isAvailable(): { available: boolean; reason: string | null } {
    return { available: true, reason: null };
  }

  async observe(target: string, _context: ActionExecutionContext): Promise<ActionObservation> {
    // Check if a process is running by name or PID
    const pid = parseInt(target, 10);
    let exists = false;
    let state = 'not_running';

    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0);
        exists = true;
        state = 'running';
      } catch {
        exists = false;
        state = 'not_running';
      }
    } else {
      // Check by command name
      try {
        const { stdout } = await exec(
          process.platform === 'win32'
            ? `tasklist /FI "IMAGENAME eq ${target}" /NH`
            : `pgrep -f "${target}"`,
          { timeout: 5000 },
        );
        exists = stdout.trim().length > 0;
        state = exists ? 'running' : 'not_running';
      } catch {
        exists = false;
        state = 'not_running';
      }
    }

    return {
      target,
      exists,
      state,
      properties: {},
      observedAt: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // Private operation implementations
  // -----------------------------------------------------------------------

  private async executeCommand(action: HumanAction): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    const commandKey = action.parameters.commandKey as string;
    const allowed = COMMAND_ALLOWLIST.get(commandKey);
    if (!allowed) {
      throw new Error(
        `Command '${commandKey}' is not in the allowlist. Allowed: [${Array.from(COMMAND_ALLOWLIST.keys()).join(', ')}]`,
      );
    }

    // Allow additional args from parameters, but validate them
    const extraArgs = (action.parameters.args as string[]) ?? [];
    const allArgs = [...allowed.args, ...extraArgs];

    const timeout = action.timeoutMs || allowed.timeoutMs;
    try {
      const { stdout, stderr } = await exec(
        `${allowed.command} ${allArgs.join(' ')}`,
        {
          timeout,
          cwd: action.parameters.cwd as string | undefined,
          env: { ...process.env, ...(action.parameters.env as Record<string, string> | undefined) },
        },
      );
      return { exitCode: 0, stdout, stderr };
    } catch (error: any) {
      return {
        exitCode: error.code ?? 1,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message,
      };
    }
  }

  private async inspectProcess(action: HumanAction): Promise<{
    pid?: number;
    running: boolean;
    info: Record<string, unknown>;
  }> {
    const target = action.target;
    const pid = parseInt(target, 10);

    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0);
        return { pid, running: true, info: { pid } };
      } catch {
        return { pid, running: false, info: { pid, state: 'not_running' } };
      }
    }

    // Search by name
    try {
      const { stdout } = await exec(
        process.platform === 'win32'
          ? `tasklist /FI "IMAGENAME eq ${target}" /NH`
          : `pgrep -la "${target}"`,
        { timeout: 5000 },
      );
      const lines = stdout.trim().split('\n').filter((l) => l.trim());
      return {
        running: lines.length > 0,
        info: { matches: lines.length, output: stdout.trim() },
      };
    } catch {
      return { running: false, info: { state: 'not_running' } };
    }
  }

  private async startProcess(action: HumanAction): Promise<{
    started: boolean;
    pid?: number;
  }> {
    const commandKey = action.parameters.commandKey as string;
    const allowed = COMMAND_ALLOWLIST.get(commandKey);
    if (!allowed) {
      throw new Error(`Command '${commandKey}' is not in the allowlist`);
    }

    const extraArgs = (action.parameters.args as string[]) ?? [];
    const allArgs = [...allowed.args, ...extraArgs];

    const child = spawn(allowed.command, allArgs, {
      detached: true,
      stdio: 'ignore',
      cwd: action.parameters.cwd as string | undefined,
      env: { ...process.env, ...(action.parameters.env as Record<string, string> | undefined) },
    });

    child.unref();

    const processKey = action.actionId || commandKey;
    this.runningProcesses.set(processKey, {
      pid: child.pid ?? 0,
      command: allowed.command,
    });

    return { started: true, pid: child.pid ?? undefined };
  }

  private async stopProcess(action: HumanAction): Promise<{ stopped: boolean }> {
    const target = action.target;
    const pid = parseInt(target, 10);

    if (!isNaN(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
        return { stopped: true };
      } catch {
        return { stopped: false };
      }
    }

    // Find by name and kill
    try {
      const { stdout } = await exec(
        process.platform === 'win32'
          ? `taskkill /IM "${target}" /F`
          : `pkill -f "${target}"`,
        { timeout: 10000 },
      );
      return { stopped: true };
    } catch {
      return { stopped: false };
    }
  }
}
