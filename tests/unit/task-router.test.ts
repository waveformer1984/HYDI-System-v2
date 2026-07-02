import { TaskRouter } from '../../pao-system/core/task.router';
import { AgentRegistry } from '../../pao-system/core/agent.registry';
import { BaseAgent } from '../../pao-system/agents/base.agent';

describe('TaskRouter', () => {
  test('with a registry wired in, route() returns the real registered agent, not a placeholder', () => {
    const registry = new AgentRegistry();
    const realAgent = new BaseAgent('finance.agent', ['budgeting']);
    registry.registerAgent(realAgent);

    const router = new TaskRouter(registry);
    const routed = router.route({ type: 'BUDGET_THRESHOLD_EXCEEDED' } as any);

    expect(routed).toBe(realAgent); // same instance, not a fresh placeholder
    expect(routed?.capabilities).toEqual(['budgeting']);
  });

  test('with no registry wired in, falls back to a placeholder rather than throwing', () => {
    const router = new TaskRouter();
    const routed = router.route({ type: 'BUDGET_THRESHOLD_EXCEEDED' } as any);

    expect(routed).toBeInstanceOf(BaseAgent);
    expect(routed?.id).toBe('finance.agent');
  });

  test('returns undefined for an unrouted event type', () => {
    const router = new TaskRouter(new AgentRegistry());
    expect(router.route({ type: 'NO_SUCH_EVENT_TYPE' } as any)).toBeUndefined();
  });
});
