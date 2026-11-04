'use strict';
// Contract test for the "run the tests" fast-path — exercises the REAL
// create_mission handler (reg.create_mission is the registered tool body,
// same code the model path invokes), not a permissive mock.
const ToolRegistry = require('../../heidi-core/tools/tool-registry.js');
const HeidiCore = require('../../heidi-core/server.js');

const routes = HeidiCore.FAST_PATH_ROUTES;
const routeFor = (input) => routes.find((r) => r.pattern.test(input));
const testRoute = routeFor('run the tests');

function registry(missions = []) {
  return new ToolRegistry({
    createMission: async (goal, priority, context, agent, meta) => {
      missions.push({ goal, priority, context, agent, meta });
      return 42;
    },
  });
}

describe('run-the-tests fast-path contract', () => {
  it('routes to create_mission with the governed npm-test action', () => {
    expect(testRoute.tool).toBe('create_mission');
    const args = testRoute.args('run the tests for this project');
    expect(args.assigned_agent).toBe('Heidi');
    expect(args.action.type).toBe('run_command');
    expect(args.action.command).toBe('npm');
    expect(args.action.args[0]).toBe('--prefix');
    expect(args.action.args[2]).toBe('test');
    expect(require('path').isAbsolute(args.action.args[1])).toBe(true);
    expect(args.success).toEqual({ exitCode: 0 });
    expect(args.goal).toMatch(/FULL jest suite/i);
  });
  it('create_mission accepts the route args and returns task_id', async () => {
    const missions = [];
    const result = await registry(missions).create_mission(testRoute.args('run the tests'));
    expect(result.task_id).toBe(42);
    expect(result.created).toBe(true);
    expect(missions[0].agent).toBe('Heidi');
    expect(missions[0].context.action.command).toBe('npm');
    expect(missions[0].context.success).toEqual({ exitCode: 0 });
  });
  it('create_mission rejects an action without assigned_agent', async () => {
    const args = { ...testRoute.args('run the tests') };
    delete args.assigned_agent;
    const result = await registry().create_mission(args);
    expect(result.error).toMatch(/assigned_agent/);
  });
  it('non-test instructions do not reach create_mission', () => {
    // run_command may still match "run <word>" — the allowlist check in
    // matchFastPath then rejects it — but it must not be create_mission.
    for (const s of ['do not run the tests', 'run the sales tests', 'run the tests and deploy']) {
      const r = routeFor(s);
      if (r) expect(r.tool).not.toBe('create_mission');
    }
  });
});
