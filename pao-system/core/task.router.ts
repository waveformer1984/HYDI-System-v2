import { BaseAgent } from '../agents/base.agent';
import { Event } from '../schemas/event.schema';

export class TaskRouter {
  private routeMap: Map<string, string[]> = new Map();

  constructor() {
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
    // In a real system, we would get the agent from the agent registry
    // This is a simplified version for the boilerplate
    const agentId = agentIds[0];
    // We would normally get the agent from a registry, but for boilerplate we return a placeholder
    // In practice, the HeidiController would use the AgentRegistry to get the agent instance
    return { id: agentId, capabilities: [] } as BaseAgent; // Placeholder
  }
}