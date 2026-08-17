/**
 * Unit tests for lib/agents/* — the Phase 3 specialist agent roster.
 */

import type { ActionExecutor, ActionResult, ExecutorAction } from '../../lib/action-executor';
import { SpecialistAgent } from '../../lib/agents/base-agent';
import { TaskAgent } from '../../lib/agents/task-agent';
import { EmailAgent } from '../../lib/agents/email-agent';
import { DatabaseAgent } from '../../lib/agents/database-agent';
import { DataFetchAgent } from '../../lib/agents/data-fetch-agent';
import { SchedulingAgent } from '../../lib/agents/scheduling-agent';
import { AgentRegistry, createDefaultAgentRegistry } from '../../lib/agents/registry';

function makeFakeExecutor(result: ActionResult): { executor: ActionExecutor; execute: jest.Mock } {
  const execute = jest.fn(async (_action: ExecutorAction, _sessionId: string) => result);
  return { executor: { execute } as unknown as ActionExecutor, execute };
}

describe('SpecialistAgent (via TaskAgent)', () => {
  test('canHandle matches only its own actionType', () => {
    const { executor } = makeFakeExecutor({ status: 'completed' });
    const agent = new TaskAgent(executor);
    expect(agent.canHandle('create_task')).toBe(true);
    expect(agent.canHandle('send_email')).toBe(false);
  });

  test('execute delegates to the injected ActionExecutor, not its own logic', async () => {
    const { executor, execute } = makeFakeExecutor({ status: 'completed', result: { id: 1 } });
    const agent = new TaskAgent(executor);
    const action = { type: 'create_task', payload: { title: 'x' } };

    const outcome = await agent.execute(action, 'session-1');

    expect(execute).toHaveBeenCalledWith(action, 'session-1');
    expect(outcome).toEqual({ status: 'completed', result: { id: 1 } });
  });

  test('tracks metrics: success increments successCount', async () => {
    const { executor } = makeFakeExecutor({ status: 'completed' });
    const agent = new TaskAgent(executor);
    await agent.execute({ type: 'create_task', payload: {} }, 's');
    const metrics = agent.getMetrics();
    expect(metrics.tasksHandled).toBe(1);
    expect(metrics.successCount).toBe(1);
    expect(metrics.failureCount).toBe(0);
    expect(metrics.lastActiveAt).not.toBeNull();
  });

  test('tracks metrics: failure increments failureCount', async () => {
    const { executor } = makeFakeExecutor({ status: 'failed', error: 'boom' });
    const agent = new TaskAgent(executor);
    await agent.execute({ type: 'create_task', payload: {} }, 's');
    const metrics = agent.getMetrics();
    expect(metrics.successCount).toBe(0);
    expect(metrics.failureCount).toBe(1);
  });

  test('metrics accumulate across multiple calls', async () => {
    const { executor } = makeFakeExecutor({ status: 'completed' });
    const agent = new TaskAgent(executor);
    await agent.execute({ type: 'create_task', payload: {} }, 's');
    await agent.execute({ type: 'create_task', payload: {} }, 's');
    expect(agent.getMetrics().tasksHandled).toBe(2);
  });

  test('getMetrics returns a copy, not a live reference', async () => {
    const { executor } = makeFakeExecutor({ status: 'completed' });
    const agent = new TaskAgent(executor);
    const before = agent.getMetrics();
    await agent.execute({ type: 'create_task', payload: {} }, 's');
    expect(before.tasksHandled).toBe(0);
  });
});

describe('concrete agent id/actionType mapping', () => {
  const { executor } = makeFakeExecutor({ status: 'completed' });

  const cases: Array<[new (e: ActionExecutor) => SpecialistAgent, string, string]> = [
    [TaskAgent, 'task-agent', 'create_task'],
    [EmailAgent, 'email-agent', 'send_email'],
    [DatabaseAgent, 'database-agent', 'update_database'],
    [DataFetchAgent, 'data-fetch-agent', 'fetch_data'],
    [SchedulingAgent, 'scheduling-agent', 'schedule_event'],
  ];

  test.each(cases)('%p maps id=%s to actionType=%s', (AgentClass, id, actionType) => {
    const agent = new AgentClass(executor);
    expect(agent.id).toBe(id);
    expect(agent.actionType).toBe(actionType);
  });
});

describe('AgentRegistry', () => {
  test('getAgentFor returns the registered agent for its actionType', () => {
    const { executor } = makeFakeExecutor({ status: 'completed' });
    const registry = new AgentRegistry();
    const taskAgent = new TaskAgent(executor);
    registry.register(taskAgent);

    expect(registry.getAgentFor('create_task')).toBe(taskAgent);
  });

  test('getAgentFor returns undefined for an unregistered actionType', () => {
    const registry = new AgentRegistry();
    expect(registry.getAgentFor('unknown_type')).toBeUndefined();
  });

  test('list returns all registered agents', () => {
    const { executor } = makeFakeExecutor({ status: 'completed' });
    const registry = new AgentRegistry();
    registry.register(new TaskAgent(executor));
    registry.register(new EmailAgent(executor));
    expect(registry.list()).toHaveLength(2);
  });

  test('getMetricsSnapshot keys by agent id', async () => {
    const { executor } = makeFakeExecutor({ status: 'completed' });
    const registry = new AgentRegistry();
    const taskAgent = new TaskAgent(executor);
    registry.register(taskAgent);
    await taskAgent.execute({ type: 'create_task', payload: {} }, 's');

    const snapshot = registry.getMetricsSnapshot();
    expect(snapshot['task-agent'].tasksHandled).toBe(1);
  });
});

describe('createDefaultAgentRegistry', () => {
  test('registers exactly the 5 agents matching Heidi\'s real action types', () => {
    const { executor } = makeFakeExecutor({ status: 'completed' });
    const registry = createDefaultAgentRegistry(executor);

    const expected = ['create_task', 'send_email', 'update_database', 'fetch_data', 'schedule_event'];
    for (const type of expected) {
      expect(registry.getAgentFor(type)).toBeDefined();
    }
    expect(registry.list()).toHaveLength(5);
  });

  test('all 5 agents delegate to the same shared ActionExecutor instance', async () => {
    const { executor, execute } = makeFakeExecutor({ status: 'completed' });
    const registry = createDefaultAgentRegistry(executor);

    for (const type of ['create_task', 'send_email', 'update_database', 'fetch_data', 'schedule_event']) {
      await registry.getAgentFor(type)!.execute({ type, payload: {} }, 's');
    }

    expect(execute).toHaveBeenCalledTimes(5);
  });
});
