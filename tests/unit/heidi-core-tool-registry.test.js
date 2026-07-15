'use strict';

/**
 * Unit tests for heidi-core/tools/tool-registry.js -- specifically the two
 * new level-3 tools (run_command, restart_service) and the permission-ladder
 * enforcement that gates them. memory and actions are both mocked.
 */

const path = require('path');
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

    it('delegates to scripts/restart-module.js via run_script, with an absolute target', async () => {
      const memory = fakeMemory({ permission_level: 3, enabled: 1 });
      const actions = fakeActions();
      actions.execute.mockResolvedValue({ result: { stdout: 'restarted', stderr: '', exitCode: 0 } });
      const registry = new ToolRegistry(memory, { actions });

      const res = await registry.execute('restart_service', { service: 'heidi-mobile-chat' }, 'Kilo');

      expect(actions.execute).toHaveBeenCalledTimes(1);
      const calledWith = actions.execute.mock.calls[0][0];
      expect(calledWith.type).toBe('run_script');
      expect(calledWith.args).toEqual(['heidi-mobile-chat']);
      // Regression: target MUST be absolute (path.isAbsolute), not a bare
      // 'scripts/restart-module.js' string -- ActionExecutor resolves a
      // relative target against process.cwd() at check time, not this
      // repo's root, which silently failed isSafe() and blocked every
      // auto-healing restart mission for hours before this fix.
      expect(path.isAbsolute(calledWith.target)).toBe(true);
      expect(calledWith.target.endsWith('restart-module.js')).toBe(true);
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

  describe('extractToolCalls', () => {
    function buildRegistry() {
      return new ToolRegistry(fakeMemory({ permission_level: 1, enabled: 1 }), {});
    }

    it('returns an empty array for empty or non-string text', () => {
      const registry = buildRegistry();
      expect(registry.extractToolCalls('')).toEqual([]);
      expect(registry.extractToolCalls(null)).toEqual([]);
      expect(registry.extractToolCalls(undefined)).toEqual([]);
      expect(registry.extractToolCalls(123)).toEqual([]);
    });

    it('extracts a tool call from Ollama tool_call JSON shape', () => {
      const registry = buildRegistry();
      const text = JSON.stringify({ function: { name: 'system_status', arguments: {} } });
      const calls = registry.extractToolCalls(text);
      expect(calls).toEqual([{ function: { name: 'system_status', arguments: {} } }]);
    });

    it('extracts tool calls from a plain { name, arguments } object', () => {
      const registry = buildRegistry();
      const text = 'I will call system_status.\n' + JSON.stringify({ name: 'system_status', arguments: {} });
      const calls = registry.extractToolCalls(text);
      expect(calls).toEqual([{ function: { name: 'system_status', arguments: {} } }]);
    });

    it('extracts run_command with arguments from a code block', () => {
      const registry = buildRegistry();
      const text = '\n```json\n{"name":"run_command","arguments":{"command":"git","args":["status"]}}\n```\n';
      const calls = registry.extractToolCalls(text);
      expect(calls).toEqual([{ function: { name: 'run_command', arguments: { command: 'git', args: ['status'] } } }]);
    });

    it('ignores unknown tool names', () => {
      const registry = buildRegistry();
      const text = JSON.stringify({ name: 'not_a_real_tool', arguments: {} });
      expect(registry.extractToolCalls(text)).toEqual([]);
    });

    it('parses argument string as JSON when possible', () => {
      const registry = buildRegistry();
      const text = JSON.stringify({ name: 'restart_service', arguments: '{"service":"heidi-mobile-chat"}' });
      expect(registry.extractToolCalls(text)).toEqual([
        { function: { name: 'restart_service', arguments: { service: 'heidi-mobile-chat' } } }
      ]);
    });

    it('deduplicates repeated tool calls', () => {
      const registry = buildRegistry();
      const text = `${JSON.stringify({ name: 'system_status', arguments: {} })} ${JSON.stringify({ name: 'system_status', arguments: {} })}`;
      expect(registry.extractToolCalls(text)).toEqual([{ function: { name: 'system_status', arguments: {} } }]);
    });
  });
});
