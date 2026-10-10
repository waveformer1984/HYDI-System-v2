/**
 * FilesystemAdapter enforcement (Phase 4).
 *
 * The companion suite (filesystem-authorization.test.ts) proves the authorizer
 * makes correct decisions. This one proves the ADAPTER ACTUALLY CALLS IT --
 * which is the whole point. A correct validator that nothing invokes is
 * exactly the failure mode being fixed here: `allowedTargets` was declared on
 * 45 capabilities and read by zero call sites.
 *
 * Every test asserts the absence of the side effect, not merely a failed
 * return value. "It said no" and "it did nothing" are different claims, and
 * only the second one is security.
 *
 * Fully hermetic: a fake repo is built in a temp directory. Protected matching
 * is by repo-relative path, so it behaves identically without touching the
 * real tree.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { FilesystemAdapter } from '../../lib/human-action/adapters/FilesystemAdapter';
import type { HumanAction, ActionExecutionContext } from '../../lib/human-action/HumanActionTypes';

let repoRoot: string;
let adapter: FilesystemAdapter;

const ctx = {} as ActionExecutionContext;

function makeAction(capability: string, target: string, parameters: Record<string, unknown> = {}): HumanAction {
  return {
    id: 'act-test',
    capability,
    target,
    parameters,
    risk: 'R1',
    requestedBy: 'test',
    requestedAt: new Date().toISOString(),
  } as unknown as HumanAction;
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-fsadapter-'));
  // Mirror the protected shapes that matter.
  fs.mkdirSync(path.join(repoRoot, 'lib', 'operational'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'lib', 'missions'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'tests', 'unit'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, '.hydi-operational'), { recursive: true });
  // Writable zones mirror FILESYSTEM_WRITABLE_ZONES in the real registry.
  fs.mkdirSync(path.join(repoRoot, 'hydi-workspace'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });

  fs.writeFileSync(path.join(repoRoot, 'lib', 'operational', 'AutonomyPolicyModel.ts'), 'ORIGINAL POLICY');
  fs.writeFileSync(path.join(repoRoot, 'tests', 'unit', 'some.test.ts'), 'ORIGINAL TEST');
  fs.writeFileSync(path.join(repoRoot, '.hydi-operational', 'operational-events.jsonl'), 'ORIGINAL LEDGER');
  fs.writeFileSync(path.join(repoRoot, '.env'), 'SECRET_KEY=hunter2');
  fs.writeFileSync(path.join(repoRoot, 'lib', 'missions', 'scratch.json'), '{"original":true}');
  fs.writeFileSync(path.join(repoRoot, 'hydi-workspace', 'scratch.json'), '{"original":true}');
  fs.writeFileSync(path.join(repoRoot, 'src', 'server.js'), 'ORIGINAL SERVER');

  adapter = new FilesystemAdapter(path.join(repoRoot, '.backups'), { repoRoot, sandboxRoot: null });
});

afterEach(() => {
  try { fs.rmSync(repoRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('Phase 4 — the adapter refuses protected writes AND leaves the file untouched', () => {
  test('write_file to governance source is refused, file content unchanged', async () => {
    const target = path.join(repoRoot, 'lib', 'operational', 'AutonomyPolicyModel.ts');
    const res = await adapter.execute(
      makeAction('filesystem.write_file', target, { content: 'PWNED' }),
      ctx
    );

    expect(res.executed).toBe(false);
    expect(res.error).toMatch(/PROTECTED_GOVERNANCE|protected/i);
    expect(res.evidence[0].check).toBe('filesystem_authorization');
    expect(res.evidence[0].status).toBe('fail');

    // The claim that matters.
    expect(fs.readFileSync(target, 'utf8')).toBe('ORIGINAL POLICY');
  });

  test('write_file to the test suite is refused — HYDI cannot edit its own proof', async () => {
    const target = path.join(repoRoot, 'tests', 'unit', 'some.test.ts');
    const res = await adapter.execute(makeAction('filesystem.write_file', target, { content: 'expect(true).toBe(true)' }), ctx);

    expect(res.executed).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe('ORIGINAL TEST');
  });

  test('write_file to the evidence ledger is refused — history is not rewritable', async () => {
    const target = path.join(repoRoot, '.hydi-operational', 'operational-events.jsonl');
    const res = await adapter.execute(makeAction('filesystem.write_file', target, { content: '' }), ctx);

    expect(res.executed).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe('ORIGINAL LEDGER');
  });

  test('delete_file on the evidence ledger is refused and the file still exists', async () => {
    const target = path.join(repoRoot, '.hydi-operational', 'operational-events.jsonl');
    const res = await adapter.execute(makeAction('filesystem.delete_file', target), ctx);

    expect(res.executed).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
  });

  test('read_file on .env is refused and returns no secret material', async () => {
    const res = await adapter.execute(makeAction('filesystem.read_file', path.join(repoRoot, '.env')), ctx);

    expect(res.executed).toBe(false);
    expect(JSON.stringify(res)).not.toContain('hunter2');
  });
});

describe('Phase 4 — move_file is checked on BOTH paths', () => {
  test('a move whose DESTINATION is protected is refused', async () => {
    const source = path.join(repoRoot, 'hydi-workspace', 'scratch.json');
    const dest = path.join(repoRoot, 'lib', 'operational', 'AutonomyPolicyModel.ts');

    const res = await adapter.execute(
      makeAction('filesystem.move_file', source, { destination: dest }),
      ctx
    );

    expect(res.executed).toBe(false);
    expect(res.error).toMatch(/destination/i);
    // Source untouched, destination unchanged.
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.readFileSync(dest, 'utf8')).toBe('ORIGINAL POLICY');
  });

  test('a move whose SOURCE is protected is refused', async () => {
    const source = path.join(repoRoot, 'lib', 'operational', 'AutonomyPolicyModel.ts');
    const dest = path.join(repoRoot, 'lib', 'missions', 'stolen.ts');

    const res = await adapter.execute(
      makeAction('filesystem.move_file', source, { destination: dest }),
      ctx
    );

    expect(res.executed).toBe(false);
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.existsSync(dest)).toBe(false);
  });
});

describe('Phase 4 — explicit writable zones, not "**/* minus protected"', () => {
  // The contract: an autonomous write must not mean '**/*'. Production source
  // is not a writable zone -- it changes through promotion, not an action.
  test('write_file to production source (src/) is refused even though it is not "protected"', async () => {
    const target = path.join(repoRoot, 'src', 'server.js');
    const res = await adapter.execute(makeAction('filesystem.write_file', target, { content: 'PWNED' }), ctx);

    expect(res.executed).toBe(false);
    expect(res.error).toMatch(/allowedTargets|NOT_IN_ALLOWED_TARGETS/i);
    expect(fs.readFileSync(target, 'utf8')).toBe('ORIGINAL SERVER');
  });

  test('write_file to a non-protected lib/ path is refused — zones, not complements', async () => {
    const target = path.join(repoRoot, 'lib', 'missions', 'output.json');
    const res = await adapter.execute(makeAction('filesystem.write_file', target, { content: 'x' }), ctx);

    expect(res.executed).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });

  test('create_directory outside the zones is refused', async () => {
    const target = path.join(repoRoot, 'workers', 'rogue');
    const res = await adapter.execute(makeAction('filesystem.create_directory', target), ctx);

    expect(res.executed).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });

  test('a move FROM outside the zones is refused — source must be writable too', async () => {
    const source = path.join(repoRoot, 'src', 'server.js');
    const dest = path.join(repoRoot, 'hydi-workspace', 'stolen.js');
    const res = await adapter.execute(makeAction('filesystem.move_file', source, { destination: dest }), ctx);

    expect(res.executed).toBe(false);
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.existsSync(dest)).toBe(false);
  });
});

describe('Phase 4 — legitimate work still succeeds inside the zones', () => {
  test('write_file to a zone path executes and really writes', async () => {
    const target = path.join(repoRoot, 'hydi-workspace', 'output.json');
    const res = await adapter.execute(
      makeAction('filesystem.write_file', target, { content: '{"ok":true}' }),
      ctx
    );

    expect(res.executed).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"ok":true}');
  });

  test('write_file to the artifacts zone executes', async () => {
    const target = path.join(repoRoot, 'artifacts', 'customer-jobs', 'job-1', 'out.json');
    const res = await adapter.execute(
      makeAction('filesystem.write_file', target, { content: '{"ok":true}' }),
      ctx
    );

    expect(res.executed).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('{"ok":true}');
  });

  test('read_file on ordinary source succeeds — R0 observation stays possible', async () => {
    const res = await adapter.execute(
      makeAction('filesystem.read_file', path.join(repoRoot, 'lib', 'missions', 'scratch.json')),
      ctx
    );
    expect(res.executed).toBe(true);
    expect(String(res.output)).toContain('original');
  });

  test('a legitimate move inside the zones succeeds', async () => {
    const source = path.join(repoRoot, 'hydi-workspace', 'scratch.json');
    const dest = path.join(repoRoot, 'hydi-workspace', 'moved.json');
    const res = await adapter.execute(makeAction('filesystem.move_file', source, { destination: dest }), ctx);

    expect(res.executed).toBe(true);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.existsSync(source)).toBe(false);
  });
});

describe('Phase 4 — traversal cannot escape through the adapter', () => {
  test('a traversal target outside the repo is refused and writes nothing', async () => {
    const outside = path.join(repoRoot, '..', `escape-${Date.now()}.txt`);
    const res = await adapter.execute(makeAction('filesystem.write_file', outside, { content: 'x' }), ctx);

    expect(res.executed).toBe(false);
    expect(res.error).toMatch(/escape|traversal|repository root/i);
    expect(fs.existsSync(path.resolve(outside))).toBe(false);
  });

  test('a normalized traversal onto a protected file is refused', async () => {
    const sneaky = path.join(repoRoot, 'lib', 'missions', '..', 'operational', 'AutonomyPolicyModel.ts');
    const res = await adapter.execute(makeAction('filesystem.write_file', sneaky, { content: 'PWNED' }), ctx);

    expect(res.executed).toBe(false);
    expect(fs.readFileSync(path.join(repoRoot, 'lib', 'operational', 'AutonomyPolicyModel.ts'), 'utf8')).toBe('ORIGINAL POLICY');
  });
});
