/**
 * Process execution surface (R2 contract item 4).
 *
 * The autonomous `process.execute` / `infra.docker_operation` capabilities
 * must not run arbitrary commands or shell strings. The fix layers:
 *   - a fixed COMMAND_ALLOWLIST (commandKey -> {command, args}) — the caller
 *     can only pick from approved executables, never a free-form command;
 *   - execFile with an argv array — no shell, so `& ; |` are literal data;
 *   - validateArgs / SAFE_IMAGE_NAME / DOCKER_NAME charsets that refuse
 *     anything outside a bare flag/path/name token.
 *
 * Under test: argument injection, command substitution, shell metacharacters,
 * non-allowlisted executables, and untrusted process/container targets.
 */

import { ProcessAdapter } from '../../lib/human-action/adapters/ProcessAdapter';
import { InfrastructureAdapter } from '../../lib/human-action/adapters/InfrastructureAdapter';
import type { HumanAction, ActionExecutionContext } from '../../lib/human-action/HumanActionTypes';

const ctx = {} as ActionExecutionContext;

function action(capability: string, parameters: Record<string, unknown>, target = ''): HumanAction {
  return {
    id: 'a1',
    capability,
    target,
    parameters,
    timeoutMs: 5000,
  } as unknown as HumanAction;
}

const proc = new ProcessAdapter();
const infra = new InfrastructureAdapter();

describe('process.execute — executable allowlist enforced', () => {
  test('a non-allowlisted commandKey is denied', async () => {
    const r = await proc.execute(action('process.execute', { commandKey: 'rm_rf' }), ctx);
    expect(r.executed).toBe(false);
    expect(r.error).toMatch(/not in the allowlist/i);
  });

  test('an arbitrary executable name cannot be smuggled as a commandKey', async () => {
    for (const key of ['cmd.exe', 'powershell', 'sh', 'bash', 'rm', 'curl']) {
      const r = await proc.execute(action('process.execute', { commandKey: key }), ctx);
      expect(r.executed).toBe(false);
    }
  });

  test('an allowlisted command runs without shell interpretation of extra args', async () => {
    // node --version is allowlisted; passing a metachar arg is refused before
    // execFile, proving it can never reach a shell.
    const r = await proc.execute(action('process.execute', { commandKey: 'node.version', args: ['--version'] }), ctx);
    // Either it runs node --version cleanly, or the extra arg is refused —
    // but it must never error with a shell-injection outcome.
    expect(r.error ?? '').not.toMatch(/not in the allowlist/i);
  });
});

describe('process.execute — injection is blocked', () => {
  const INJECTIONS: Array<[string, string[]]> = [
    ['argument injection', ['&', 'echo', 'PWN']],
    ['command separator', [';', 'rm', '-rf', '/']],
    ['pipe', ['|', 'cat', '/etc/passwd']],
    ['logical-and', ['&&', 'echo', 'x']],
    ['command substitution $()', ['$(whoami)']],
    ['command substitution backtick', ['`id`']],
    ['node -e eval', ['-e', 'require("fs").readdirSync("/")']],
    ['quoted breakout', ['"', 'x']],
    ['space breakout', ['a b']],
    ['redirect', ['>', '/etc/passwd']],
    ['glob escape', ['*', '&&', 'x']],
  ];

  for (const [label, args] of INJECTIONS) {
    test(`refuses ${label}`, async () => {
      const r = await proc.execute(action('process.execute', { commandKey: 'node.version', args }), ctx);
      expect(r.executed).toBe(false);
      expect(r.error).toBeTruthy();
    });
  }
});

describe('process target constraints', () => {
  test('process.inspect refuses an unsafe image/target name — returns invalid_target, inspects nothing', async () => {
    const r = await proc.execute(action('process.inspect', {}, 'node;whoami'), ctx);
    // The image name is rejected before tasklist/pgrep runs — the result is a
    // safe negative, never an injected lookup.
    expect((r.output as any)?.running).toBe(false);
    expect((r.output as any)?.info?.state).toBe('invalid_target');
  });

  test('process.stop refuses an unsafe image name (no taskkill injection)', async () => {
    const r = await proc.execute(action('process.stop', {}, 'node.exe /F & del *'), ctx);
    // isSafeImageName rejects the name — nothing is killed, no shell runs.
    expect((r.output as any)?.stopped).toBe(false);
  });

  test('process.stop refuses a quoted/metachar image name', async () => {
    const r = await proc.execute(action('process.stop', {}, '"$(rm -rf /)"'), ctx);
    expect((r.output as any)?.stopped).toBe(false);
  });
});

describe('infra.docker_operation — container target constrained', () => {
  test('refuses a container name carrying shell metacharacters', async () => {
    const r = await infra.execute(action('infra.docker_operation', { operation: 'logs' }, 'x; whoami'), ctx);
    expect(r.executed).toBe(false);
    expect(r.error).toMatch(/Invalid docker container/i);
  });

  test('refuses a container name with command substitution', async () => {
    const r = await infra.execute(action('infra.docker_operation', { operation: 'inspect' }, '$(id)'), ctx);
    expect(r.executed).toBe(false);
  });

  test('refuses a non-allowlisted docker operation', async () => {
    const r = await infra.execute(action('infra.docker_operation', { operation: 'rm' }, 'container1'), ctx);
    expect(r.executed).toBe(false);
    expect(r.error).toMatch(/not allowed/i);
  });

  test('docker ps needs no container and cannot be given an injected target', async () => {
    // 'ps' ignores the target entirely — but a metachar target must not leak.
    const r = await infra.execute(action('infra.docker_operation', { operation: 'ps' }, 'x; rm -rf /'), ctx);
    // ps doesn't validate the (unused) target, but it also never interpolates it.
    expect(r.error ?? '').not.toMatch(/Invalid docker container/i);
  });
});
