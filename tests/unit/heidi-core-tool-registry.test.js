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

  describe('tool() decorator and registerTool', () => {
    it('exposes the tool decorator on the class', () => {
      expect(typeof ToolRegistry.tool).toBe('function');
    });

    it('builds this.tools from decorated class fields', () => {
      const memory = fakeMemory({ permission_level: 1, enabled: 1 });
      const registry = new ToolRegistry(memory, {});

      expect(registry.tools.system_status).toBeDefined();
      expect(registry.tools.system_status.level).toBe(1);
      expect(registry.tools.system_status.description).toMatch(/live health/);
      expect(registry.tools.system_status.parameters).toEqual({ type: 'object', properties: {}, required: [] });
      expect(registry.tools.list_models).toBeDefined();
      expect(registry.tools.list_agents).toBeDefined();
      expect(registry.tools.run_command).toBeDefined();
      expect(registry.tools.restart_service).toBeDefined();
    });

    it('executes a decorated tool and binds `this` to the registry', async () => {
      const memory = fakeMemory({ permission_level: 1, enabled: 1 });
      memory.listAgents = jest.fn().mockResolvedValue([{ name: 'Kilo', role: 'assistant', permission_level: 3, enabled: 1 }]);
      const registry = new ToolRegistry(memory, {});

      const res = await registry.execute('list_agents', {}, 'Kilo');

      expect(Array.isArray(res)).toBe(true);
      expect(res[0].name).toBe('Kilo');
      expect(memory.listAgents).toHaveBeenCalledWith(false);
    });

    it('allows registerTool to add new tools at runtime', async () => {
      const memory = fakeMemory({ permission_level: 4, enabled: 1 });
      const registry = new ToolRegistry(memory, {});

      const handler = ToolRegistry.tool({
        level: 1,
        description: 'A test tool',
        parameters: { type: 'object', properties: {}, required: [] }
      })(async () => ({ ok: true }));

      registry.registerTool('test_tool', handler);

      expect(registry.tools.test_tool).toBeDefined();
      expect(registry.tools.test_tool.description).toBe('A test tool');
      const res = await registry.execute('test_tool', {}, 'Kilo');
      expect(res).toEqual({ ok: true });
    });

    it('rejects registerTool for handlers not decorated with tool()', () => {
      const memory = fakeMemory({ permission_level: 4, enabled: 1 });
      const registry = new ToolRegistry(memory, {});

      expect(() => registry.registerTool('bad_tool', async () => {}))
        .toThrow(/not decorated with tool/);
    });

    it('toOllamaTools reflects the registered tool set', () => {
      const memory = fakeMemory({ permission_level: 1, enabled: 1 });
      const registry = new ToolRegistry(memory, {});

      const ollama = registry.toOllamaTools();
      const names = ollama.map(t => t.function.name);
      expect(names).toContain('system_status');
      expect(names).toContain('list_models');
      expect(names).toContain('run_command');
    });
  });
});
