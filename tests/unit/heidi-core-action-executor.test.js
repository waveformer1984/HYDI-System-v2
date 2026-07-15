'use strict';

/**
 * Unit tests for heidi-core/actions/action-executor.js — the allowlisted
 * command/script executor behind /act and (as of the mission worker) the
 * level-3 run_command/restart_service chat tools.
 */

const ActionExecutor = require('../../heidi-core/actions/action-executor');

describe('ActionExecutor', () => {
  let exec;
  beforeEach(() => { exec = new ActionExecutor(); });

  describe('git push/merge guard', () => {
    it('runCommand refuses git push', async () => {
      await expect(exec.runCommand('git', ['push', 'origin', 'main']))
        .rejects.toThrow(/requires human execution/);
    });

    it('runCommand refuses git merge', async () => {
      await expect(exec.runCommand('git', ['merge', 'feature-branch']))
        .rejects.toThrow(/requires human execution/);
    });

    it('runCommand refuses git push regardless of case', async () => {
      await expect(exec.runCommand('git', ['PUSH', 'origin', 'main']))
        .rejects.toThrow(/requires human execution/);
    });

    it('isSafe returns false for git push', () => {
      expect(exec.isSafe({ type: 'run_command', command: 'git', args: ['push'] })).toBe(false);
    });

    it('isSafe returns false for git merge', () => {
      expect(exec.isSafe({ type: 'run_command', command: 'git', args: ['merge', 'main'] })).toBe(false);
    });

    it('other git subcommands are not blocked by the guard', async () => {
      // status has no side effects and is expected to spawn successfully in
      // this repo; the guard must not touch it either way.
      const res = await exec.runCommand('git', ['status']);
      expect(res.exitCode).toBe(0);
    });

    it('gh (PR merge CLI) was never in the approved command list to begin with', () => {
      expect(exec.approvedCommands.has('gh')).toBe(false);
    });
  });

  describe('baseline allowlist behavior (regression guard)', () => {
    it('rejects a command not on the approved list', async () => {
      await expect(exec.runCommand('curl', ['http://example.com']))
        .rejects.toThrow(/not in approved list/);
    });

    it('rejects a command string containing whitespace (no inline args)', async () => {
      await expect(exec.runCommand('git push', []))
        .rejects.toThrow(/bare executable name/);
    });

    it('rejects dangerous arguments even for an approved command', async () => {
      await expect(exec.runCommand('node', ['-e', 'process.exit(1)']))
        .rejects.toThrow(/Refused unsafe argument/);
    });

    it('emulates echo in-process (no shell spawn)', async () => {
      const res = await exec.runCommand('echo', ['hello', 'world']);
      expect(res).toEqual({ stdout: 'hello world\n', stderr: '', exitCode: 0 });
    });

    it('isSafe rejects write_file and api_call unconditionally', () => {
      expect(exec.isSafe({ type: 'write_file', target: 'logs/x.txt', content: 'x' })).toBe(false);
      expect(exec.isSafe({ type: 'api_call', target: 'http://localhost:3000' })).toBe(false);
    });

    it('isSafe accepts a clean, approved run_command', () => {
      expect(exec.isSafe({ type: 'run_command', command: 'git', args: ['status'] })).toBe(true);
    });
  });
});
