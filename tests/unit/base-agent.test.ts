import { BaseAgent } from '../../pao-system/agents/base.agent';

class TestAgent extends BaseAgent {
  async handle_event(event: any): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

test('load/status reflect real concurrent execution, not frozen defaults', async () => {
  const agent = new TestAgent('test_agent', [], 2); // maxConcurrency = 2

  expect(agent.status).toBe('active');
  expect(agent.load).toBe(0);

  const p1 = agent.execute({});
  expect(agent.load).toBeCloseTo(0.5);
  expect(agent.status).toBe('active');

  const p2 = agent.execute({});
  expect(agent.load).toBeCloseTo(1);
  expect(agent.status).toBe('busy'); // at capacity - validateAgentAvailability would now exclude it

  await Promise.all([p1, p2]);

  expect(agent.load).toBe(0);
  expect(agent.status).toBe('active');
});

test('setOffline overrides derived status until setOnline', async () => {
  const agent = new TestAgent('test_agent_2', [], 5);
  agent.setOffline();
  expect(agent.status).toBe('offline');

  await agent.execute({}); // in-flight work must not silently clear offline
  expect(agent.status).toBe('offline');

  agent.setOnline();
  expect(agent.status).toBe('active');
});
