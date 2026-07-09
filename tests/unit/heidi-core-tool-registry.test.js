'use strict';

/**
 * Unit tests for heidi-core/tools/tool-registry.js -- specifically the two
 * new level-3 tools (run_command, restart_service) and the permission-ladder
 * enforcement that gates them. memory and actions are both mocked.
 */

const ToolRegistry = require('../../heidi-core/tools/tool-registry');

function fakeMemory(agent) {
  return {
    getAgent: jest.fn().mockResolvedValue(agent),
    storeSystemState: jest.fn().mockResolvedValue(undefined),
  };
}

function fakeActions() {
  return { execute: jest.fn() };
}

describe('ToolRegistry: level-3 tools', () => {
  describe('permission ladder', () => {
    it('denies run_command to an agent below level 3', async () => {
      const memory = fakeMemory({ permission_level: 2, enabled: 1 });
      const actions = fakeActions();
      const registry = new ToolRegistry(memory, { actions });

      const res = await registry.execute('run_command', { command: 'git', args: ['status'] }, 'Kilo');

      expect(res.error).toMatch(/permission denied/);
      expect(res.error).toMatch(/requires level 3/);
      expect(actions.execute).not.toHaveBeenCalled();
    });

    it('denies restart_service to an agent below level 3', async () => {
      const memory = fakeMemory({ permission_level: 1, enabled: 1 });
      const actions = fakeActions();
      const registry = new ToolRegistry(memory, { actions });

      const res = await registry.execute('restart_service', { service: 'heidi-mobile-chat' }, 'Kilo');

      expect(res.error).toMatch(/permission denied/);
      expect(actions.execute).not.toHaveBeenCalled();
    });

    it('treats a disabled agent as level 0 regardless of stored permission_level', async () => {
      const memory = fakeMemory({ permission_level: 4, enabled: 0 });
      const actions = fakeActions();
      const registry = new ToolRegistry(memory, { actions });

      const res = await registry.execute('run_command', { command: 'git', args: ['status'] }, 'Kilo');

      expect(res.error).toMatch(/permission denied/);
      expect(actions.execute).not.toHaveBeenCalled();
    });

    it('treats an unknown agent as level 0', async () => {
      const memory = fakeMemory(null);
      const actions = fakeActions();
      const registry = new ToolRegistry(memory, { actions });

      const res = await registry.execute('run_command', { command: 'git', args: ['status'] }, 'NoSuchAgent');

      expect(res.error).toMatch(/permission denied/);
    });

    it('allows run_command for an agent at exactly level 3', async () => {
      const memory = fakeMemory({ permission_level: 3, enabled: 1 });
      const actions = fakeActions();
      actions.execute.mockResolvedValue({ result: { stdout: 'clean\n', stderr: '', exitCode: 0 } });
      const registry = new ToolRegistry(memory, { actions });

      const res = await registry.execute('run_command', { command: 'git', args: ['status'] }, 'Kilo');

      expect(res).toEqual({ stdout: 'clean\n', stderr: '', exitCode: 0 });
      expect(actions.execute).toHaveBeenCalledWith({ type: 'run_command', command: 'git', args: ['status'] });
    });

    it('logs an audit entry for both allowed and denied calls', async () => {
      const memory = fakeMemory({ permission_level: 3, enabled: 1 });
      const actions = fakeActions();
      actions.execute.mockResolvedValue({ result: {} });
      const registry = new ToolRegistry(memory, { actions });

      await registry.execute('run_command', { command: 'git', args: [] }, 'Kilo');

      expect(memory.storeSystemState).toHaveBeenCalledWith(
        'tool_execution',
        expect.objectContaining({ tool: 'run_command', agent: 'Kilo', agent_level: 3, required_level: 3, allowed: true }),
        'info'
      );
    });
  });

  describe('run_command', () => {
    it('requires a command argument', async () => {
      const memory = fakeMemory({ permission_level: 3, enabled: 1 });
      const actions = fakeActions();
      const registry = new ToolRegistry(memory, { actions });

      const res = await registry.execute('run_command', {}, 'Kilo');
      expect(res.error).toBe('command is required');
      expect(actions.execute).not.toHaveBeenCalled();
    });

    it('surfaces the ActionExecutor rejection for git push (defense in depth)', async () => {
      const memory = fakeMemory({ permission_level: 4, enabled: 1 });
      const actions = fakeActions();
      actions.execute.mockRejectedValue(new Error("Refused: 'git push' requires human execution (landing changes on a remote/protected branch is never autonomous)"));
      const registry = new ToolRegistry(memory, { actions });

      const res = await registry.execute('run_command', { command: 'git', args: ['push'] }, 'Kilo');
      expect(res.error).toMatch(/requires human execution/);
    });

    it('returns a clear error when no ActionExecutor was configured', async () => {
      const memory = fakeMemory({ permission_level: 3, enabled: 1 });
      const registry = new ToolRegistry(memory, {}); // no actions

      const res = await registry.execute('run_command', { command: 'git', args: [] }, 'Kilo');
      expect(res.error).toMatch(/no ActionExecutor configured/);
    });
  });

  describe('restart_service', () => {
    it('requires a service argument', async () => {
      const memory = fakeMemory({ permission_level: 3, enabled: 1 });
      const actions = fakeActions();
      const registry = new ToolRegistry(memory, { actions });

      const res = await registry.execute('restart_service', {}, 'Kilo');
      expect(res.error).toBe('service is required');
    });

    it('delegates to scripts/restart-module.js via run_script', async () => {
      const memory = fakeMemory({ permission_level: 3, enabled: 1 });
      const actions = fakeActions();
      actions.execute.mockResolvedValue({ result: { stdout: 'restarted', stderr: '', exitCode: 0 } });
      const registry = new ToolRegistry(memory, { actions });

      const res = await registry.execute('restart_service', { service: 'heidi-mobile-chat' }, 'Kilo');

      expect(actions.execute).toHaveBeenCalledWith({
        type: 'run_script',
        target: 'scripts/restart-module.js',
        args: ['heidi-mobile-chat']
      });
      expect(res).toEqual({ stdout: 'restarted', stderr: '', exitCode: 0 });
    });
  });
});
