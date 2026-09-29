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

import { execFile as execFileCb, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
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
 * Extra caller-supplied args to an allowlisted command are passed via
 * execFile's argv array (never a shell string), so `&`, `;`, `|` are literal
 * data, not operators. We still reject anything outside a conservative
 * charset as defence-in-depth — the allowlisted commands only take flags,
 * paths, and simple values, so a metacharacter has no legitimate use.
 */
const SAFE_ARG = /^[A-Za-z0-9._\-/:=@,+%]+$/;

/**
 * Validate caller-supplied extra args against a per-command flag allowlist.
 * SAFE_ARG alone is NOT sufficient (red-team 2026-09-18): `npx.jest` +
 * `--setupFiles ./evil.js` and `git.log` + `--output=C:/x` are in-charset yet
 * load code / write files. Any `-`-prefixed arg must therefore have its flag
 * (the part before `=`) in the command's explicit allowlist; bare SAFE_ARG
 * values (test path patterns, refs, image names) pass for every command.
 */
function validateArgs(args: string[], allowedFlags: ReadonlySet<string>): string[] {
  for (const a of args) {
    if (typeof a !== 'string' || a.length === 0 || a.length > 512 || !SAFE_ARG.test(a)) {
      throw new Error(`Argument rejected: not a simple flag/path/value (${JSON.stringify(a)})`);
    }
    if (a.startsWith('-')) {
      const flag = a.split('=', 1)[0];
      if (!allowedFlags.has(flag)) {
        throw new Error(`Flag '${flag}' is not permitted for this command — only explicitly allowlisted flags are`);
      }
    }
  }
  return args;
}

/**
 * A process image/name token. These values are interpolated into tasklist /
 * taskkill / pgrep / pkill arguments, so anything that could break out of the
 * single argument (spaces, quotes, metacharacters) is refused outright.
 */
const SAFE_IMAGE_NAME = /^[A-Za-z0-9._-]{1,128}$/;
function isSafeImageName(name: unknown): name is string {
  return typeof name === 'string' && SAFE_IMAGE_NAME.test(name);
}

// ---------------------------------------------------------------------------
// Command allowlist — structured commands only, no arbitrary shell
// ---------------------------------------------------------------------------

interface AllowedCommand {
  command: string;
  args: string[];
  description: string;
  timeoutMs: number;
  /**
   * Flags a caller may add on top of the fixed argv. Read/run-only flags
   * only — nothing that loads a module, writes a file, changes the working
   * tree, or points the tool at a different config. An empty set means no
   * dash-prefixed extra args at all (bare SAFE_ARG values still allowed).
   */
  allowedFlags: ReadonlySet<string>;
}

const NO_FLAGS: ReadonlySet<string> = new Set();

const COMMAND_ALLOWLIST: Map<string, AllowedCommand> = new Map([
  // `--` lets callers pass bare test-path patterns through to the test script.
  ['npm.test', { command: 'npm', args: ['test'], description: 'Run npm test suite', timeoutMs: 120000, allowedFlags: new Set(['--']) }],
  ['npm.build', { command: 'npm', args: ['run', 'build'], description: 'Run npm build', timeoutMs: 120000, allowedFlags: NO_FLAGS }],
  ['npm.run.dev', { command: 'npm', args: ['run', 'dev'], description: 'Start dev server', timeoutMs: 60000, allowedFlags: NO_FLAGS }],
  ['npm.run.boot', { command: 'npm', args: ['run', 'boot'], description: 'Boot full system', timeoutMs: 60000, allowedFlags: NO_FLAGS }],
  ['npm.run.typecheck', { command: 'npm', args: ['run', 'typecheck'], description: 'Run typecheck', timeoutMs: 60000, allowedFlags: NO_FLAGS }],
  ['npm.run.lint', { command: 'npm', args: ['run', 'lint'], description: 'Run lint', timeoutMs: 60000, allowedFlags: NO_FLAGS }],
  ['git.status', { command: 'git', args: ['status', '--porcelain'], description: 'Git status', timeoutMs: 10000, allowedFlags: new Set(['--porcelain', '--short', '-s', '-b', '--branch', '--long', '--ignored', '--untracked-files']) }],
  ['git.log', { command: 'git', args: ['log', '--oneline', '-10'], description: 'Git log', timeoutMs: 10000, allowedFlags: new Set(['--oneline', '--all', '--graph', '--stat', '--name-only', '--name-status', '-n', '--max-count', '--since', '--until', '--author', '--grep', '--pretty', '--format', '--abbrev-commit', '--follow', '-p', '--decorate']) }],
  ['git.branch', { command: 'git', args: ['branch', '-a'], description: 'List branches', timeoutMs: 10000, allowedFlags: new Set(['-a', '-r', '-v', '-vv', '--list', '--show-current', '--merged', '--no-merged']) }],
  ['git.diff', { command: 'git', args: ['diff', '--stat'], description: 'Git diff stat', timeoutMs: 10000, allowedFlags: new Set(['--stat', '--name-only', '--name-status', '--cached', '--staged', '-p', '--shortstat', '--numstat', '-w', '-b', '--no-color', '--color']) }],
  ['node.version', { command: 'node', args: ['--version'], description: 'Node version', timeoutMs: 5000, allowedFlags: NO_FLAGS }],
  // Jest run-control flags only. Anything that loads code (setupFiles,
  // reporters, transform, resolver, testEnvironment, globalSetup...) or
  // mutates (updateSnapshot) is deliberately absent.
  ['npx.jest', { command: 'npx', args: ['jest'], description: 'Run jest', timeoutMs: 120000, allowedFlags: new Set(['--coverage', '--runInBand', '--forceExit', '--detectOpenHandles', '--silent', '--verbose', '-t', '--testNamePattern', '--testPathPattern', '--listTests', '--passWithNoTests', '--ci', '--onlyChanged', '--bail', '--maxWorkers']) }],
  ['docker.ps', { command: 'docker', args: ['ps'], description: 'Docker ps', timeoutMs: 10000, allowedFlags: new Set(['--all', '-a', '-q', '--quiet', '--no-trunc', '--format', '--filter', '-n', '--latest', '-l', '-s', '--size']) }],
  ['docker.logs', { command: 'docker', args: ['logs'], description: 'Docker logs', timeoutMs: 15000, allowedFlags: new Set(['--tail', '--since', '--until', '--timestamps', '-t', '--details']) }],
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
  private workspaceRoot: string;

  constructor(options?: { workspaceRoot?: string }) {
    this.workspaceRoot = path.resolve(options?.workspaceRoot ?? process.cwd());
  }

  /**
   * Confine the child working directory to the adapter's workspace root
   * (red-team 2026-09-18): an arbitrary caller `cwd` turns an allowlisted
   * command into arbitrary code execution — `npm test` run in an attacker
   * directory executes the attacker's package.json scripts. Resolves `..`
   * and symlinks (realpath on existing paths), then fails closed if the
   * result escapes the root.
   */
  private resolveCwd(cwdParam?: string): string {
    const raw = cwdParam ?? this.workspaceRoot;
    let resolved = path.resolve(raw);
    try {
      if (fs.existsSync(resolved)) {
        resolved = fs.realpathSync(resolved);
      }
    } catch {
      throw new Error(`cwd is not a resolvable directory: ${String(raw)}`);
    }
    const realRoot = fs.existsSync(this.workspaceRoot)
      ? fs.realpathSync(this.workspaceRoot)
      : this.workspaceRoot;
    const rel = path.relative(realRoot, resolved);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
      throw new Error(`cwd escapes the workspace root: ${resolved}`);
    }
    return resolved;
  }

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
      // Check by command name. The image name is passed as a literal argv entry
      // (execFile, no shell) and restricted to a bare token first.
      try {
        if (!isSafeImageName(target)) {
          exists = false;
          state = 'invalid_target';
          return { target, exists, state, properties: {}, observedAt: new Date().toISOString() };
        }
        const { stdout } = process.platform === 'win32'
          ? await execFile('tasklist', ['/FI', `IMAGENAME eq ${target}`, '/NH'], { timeout: 5000, windowsHide: true })
          : await execFile('pgrep', ['-f', target], { timeout: 5000 });
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

    // Extra args go through execFile's argv array — NOT a shell string. This
    // is the fix for the red-team injection (2026-09-18): `exec(cmd + args.join
    // (' '))` ran through cmd.exe, so args=['&','echo','PWN'] executed PWN as a
    // command. execFile passes each element as a literal argv entry, so `&` is
    // data. validateArgs additionally refuses anything outside a simple
    // flag/path/value charset, since the allowlisted commands take no complex
    // arguments.
    const extraArgs = validateArgs((action.parameters.args as string[]) ?? [], allowed.allowedFlags);
    const allArgs = [...allowed.args, ...extraArgs];

    const timeout = action.timeoutMs || allowed.timeoutMs;
    const cwd = this.resolveCwd(action.parameters.cwd as string | undefined);
    const env = buildChildEnv(action.parameters.env);
    try {
      const { stdout, stderr } = await execFile(
        allowed.command,
        allArgs,
        {
          timeout,
          cwd,
          env,
          windowsHide: true,
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

    // Search by name. The image name is interpolated into a filter arg, so it
    // must be a bare process-name token — anything else (quotes, metachars,
    // a second filter) is refused rather than handed to the shell. We also use
    // execFile so the value stays a single literal argv entry.
    if (typeof target !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(target)) {
      return { running: false, info: { state: 'invalid_target' } };
    }
    try {
      const { stdout } = process.platform === 'win32'
        ? await execFile('tasklist', ['/FI', `IMAGENAME eq ${target}`, '/NH'], { timeout: 5000, windowsHide: true })
        : await execFile('pgrep', ['-la', target], { timeout: 5000 });
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

    // Same validation as executeCommand — this path previously skipped
    // validateArgs/env/cwd checks entirely (red-team 2026-09-18).
    const extraArgs = validateArgs((action.parameters.args as string[]) ?? [], allowed.allowedFlags);
    const allArgs = [...allowed.args, ...extraArgs];
    const cwd = this.resolveCwd(action.parameters.cwd as string | undefined);
    const env = buildChildEnv(action.parameters.env);

    const child = spawn(allowed.command, allArgs, {
      detached: true,
      stdio: 'ignore',
      cwd,
      env,
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

    // Find by name and kill — literal argv via execFile, image name restricted
    // to a bare token so it cannot inject a second process or operator.
    try {
      if (!isSafeImageName(target)) return { stopped: false };
      if (process.platform === 'win32') {
        await execFile('taskkill', ['/IM', target, '/F'], { timeout: 10000, windowsHide: true });
      } else {
        await execFile('pkill', ['-f', target], { timeout: 10000 });
      }
      return { stopped: true };
    } catch {
      return { stopped: false };
    }
  }
}
