import { BaseAgent } from '../agents/base.agent';
import { Event } from '../schemas/event.schema';
import { AgentRegistry } from './agent.registry';

export class TaskRouter {
  private routeMap: Map<string, string[]> = new Map();
  private agentRegistry?: AgentRegistry;

  constructor(agentRegistry?: AgentRegistry) {
    this.agentRegistry = agentRegistry;
    // Initialize route mappings based on the specification
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // Funding opportunities
    this.routeMap.set('FUNDING_OPPORTUNITY_FOUND', ['funding.agent']);
    
    // Design updates
    this.routeMap.set('DESIGN_UPDATE', ['architect.agent']);
    this.routeMap.set('DESIGN_REVISION_REQUIRED', ['architect.agent']);
    
    // Supply issues
    this.routeMap.set('SUPPLY_ISSUE', ['procurement.agent']);
    this.routeMap.set('MATERIAL_SHORTAGE', ['procurement.agent']);
    
    // Cash flow alerts
    this.routeMap.set('CASHFLOW_ALERT', ['finance.agent']);
    this.routeMap.set('BUDGET_THRESHOLD_EXCEEDED', ['finance.agent']);
    
    // Add more routes as needed
  }

  route(event: Event): BaseAgent | undefined {
    const agentIds = this.routeMap.get(event.type);
    if (!agentIds || agentIds.length === 0) {
      return undefined;
    }

    // For now, return the first agent (later we can implement load balancing)
    const agentId = agentIds[0];

    if (this.agentRegistry) {
      return this.agentRegistry.getAgent(agentId);
    }

    // No registry wired in - fall back to a fresh placeholder so callers
    // still get a usable BaseAgent, but note this loses any real state
    // (status/load/registered subclass) the real instance would carry.
    return new BaseAgent(agentId, []);
  }
}