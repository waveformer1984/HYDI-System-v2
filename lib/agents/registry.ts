import type { ActionExecutor } from '../action-executor';
import { AgentMetrics, SpecialistAgent } from './base-agent';
import { TaskAgent } from './task-agent';
import { EmailAgent } from './email-agent';
import { DatabaseAgent } from './database-agent';
import { DataFetchAgent } from './data-fetch-agent';
import { SchedulingAgent } from './scheduling-agent';

export class AgentRegistry {
  private agents: SpecialistAgent[] = [];

  register(agent: SpecialistAgent): void {
    this.agents.push(agent);
  }

  /** First registered agent that claims it can handle this action type. */
  getAgentFor(actionType: string): SpecialistAgent | undefined {
    return this.agents.find((agent) => agent.canHandle(actionType));
  }

  list(): SpecialistAgent[] {
    return [...this.agents];
  }

  getMetricsSnapshot(): Record<string, AgentMetrics> {
    const snapshot: Record<string, AgentMetrics> = {};
    for (const agent of this.agents) {
      snapshot[agent.id] = agent.getMetrics();
    }
    return snapshot;
  }
}

/** The five agents matching Heidi's real action vocabulary, one per type. */
export function createDefaultAgentRegistry(actionExecutor: ActionExecutor): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register(new TaskAgent(actionExecutor));
  registry.register(new EmailAgent(actionExecutor));
  registry.register(new DatabaseAgent(actionExecutor));
  registry.register(new DataFetchAgent(actionExecutor));
  registry.register(new SchedulingAgent(actionExecutor));
  return registry;
}
