/**
 * Chokepoint gate — applyBoundedPatch itself refuses when HEIDI_ALLOW_DEV_PATCH
 * is unset. The gate lives inside the executor so no caller (CognitiveCore's
 * ops.dev_patch, ops.dev_author auto-apply, or the builder agent) can bypass
 * it: refusal happens before any file is read and before any git process runs.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

jest.mock('child_process', () => {
  const actual = jest.requireActual<typeof import('child_process')>('child_process');
  return { ...actual, execFileSync: jest.fn(actual.execFileSync) };
});
const mockExec = execFileSync as unknown as jest.Mock;

import { applyBoundedPatch } from '../../lib/heidi/DevPatchExecutor';
import { GATE_DEV_PATCH_DISABLED } from '../../lib/heidi/executor-env-gates';

describe('applyBoundedPatch env gate (chokepoint)', () => {
  const saved = process.env.HEIDI_ALLOW_DEV_PATCH;
  beforeEach(() => { delete process.env.HEIDI_ALLOW_DEV_PATCH; mockExec.mockClear(); });
  afterAll(() => { if (saved === undefined) delete process.env.HEIDI_ALLOW_DEV_PATCH; else process.env.HEIDI_ALLOW_DEV_PATCH = saved; });

  it('refuses before touching the file or spawning git', async () => {
    const tmp = path.join(os.tmpdir(), `gate-probe-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'original');
    const res = await applyBoundedPatch({
      missionId: 'gate-test',
      patches: [{ file: 'tests/gate-probe.txt', oldString: 'original', newString: 'patched' }],
      commitMessage: 'should never commit',
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe('REJECTED');
    expect(res.reason).toBe(GATE_DEV_PATCH_DISABLED);
    expect(res.filesChanged).toEqual([]);
    // No git child process was spawned.
    const gitCalls = mockExec.mock.calls.filter(c => /git/i.test(String(c[0])) || (Array.isArray(c[1]) && c[1].some(a => /git/i.test(String(a)))));
    expect(gitCalls).toEqual([]);
    // The temp file (outside the repo) was never read or written.
    expect(fs.readFileSync(tmp, 'utf8')).toBe('original');
    fs.unlinkSync(tmp);
  });
});
