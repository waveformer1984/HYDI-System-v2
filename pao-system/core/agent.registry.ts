import { BaseAgent } from '../agents/base.agent';

// NAMING COLLISION: there is a SEPARATE, unrelated class also named
// `AgentRegistry` at lib/agents/registry.ts (registers lib/agents/*
// "specialist" agents like DatabaseAgent/DataFetchAgent/SchedulingAgent).
// THIS one registers PAO (Personal AI Orchestration) business/operations
// agents (see pao-system/agents/*) keyed off pao-system's own BaseAgent.
// Check which tree a given consumer lives in before assuming which
// "AgentRegistry" it imports.
export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();

  registerAgent(agent: BaseAgent): void {
    this.agents.set(agent.id, agent);
    console.log(`Agent registered: ${agent.id}`);
  }

  getAgent(id: string): BaseAgent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  getAllAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  getAgentsByCapability(capability: string): BaseAgent[] {
    return Array.from(this.agents.values()).filter(agent => 
      agent.capabilities.includes(capability)
    );
  }

  unregisterAgent(id: string): boolean {
    return this.agents.delete(id);
  }
}