import { EventBus } from './event.bus';
import { TaskRouter } from './task.router';
import { ApprovalEngine } from './approval.engine';
import { RiskEngine } from './risk.engine';
import { AgentRegistry } from './agent.registry';
import { RezonateAgent } from '../agents/execution/rezonate.agent';

export interface HeidiDirective {
  task_id: string;
  assigned_agent: string;
  task_type: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  deadline?: string;
  dependencies?: string[];
  estimated_duration?: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  expected_outcome: string;
}

export interface SystemMetrics {
  tasks_processed: number;
  tasks_completed: number;
  tasks_failed: number;
  approvals_pending: number;
  conflicts_resolved: number;
  system_efficiency: number;
  agent_utilization: Record<string, number>;
}

export class HeidiController {
  private eventBus: EventBus;
  private taskRouter: TaskRouter;
  private approvalEngine: ApprovalEngine;
  private riskEngine: RiskEngine;
  private agentRegistry: AgentRegistry;
  private running: boolean = false;
  
  private activeTasks: Map<string, HeidiDirective> = new Map();
  private completedTasks: HeidiDirective[] = [];
  private failedTasks: HeidiDirective[] = [];
  private systemMetrics: SystemMetrics;
  private taskRoutingMatrix: Map<string, string[]> = new Map();
  private conflictResolutionHistory: any[] = [];

  constructor() {
    this.eventBus = new EventBus();
    this.approvalEngine = new ApprovalEngine();
    this.riskEngine = new RiskEngine();
    this.agentRegistry = new AgentRegistry();
    this.taskRouter = new TaskRouter(this.agentRegistry);
    
    this.systemMetrics = {
      tasks_processed: 0,
      tasks_completed: 0,
      tasks_failed: 0,
      approvals_pending: 0,
      conflicts_resolved: 0,
      system_efficiency: 0,
      agent_utilization: {}
    };
    
    this.initializeRoutingMatrix();
    this.agentRegistry.registerAgent(new RezonateAgent());
    this.setupEventHandlers();
  }

  private initializeRoutingMatrix(): void {
    this.taskRoutingMatrix = new Map([
      ['DESIGN_CONTAINER_MODULE', ['architect_agent']],
      ['STRUCTURAL_ANALYSIS', ['architect_agent']],
      ['LOAD_SIMULATION', ['architect_agent']],
      ['CAD_GENERATION', ['architect_agent']],
      ['POWER_SYSTEM_DESIGN', ['energy_system_agent']],
      ['ENERGY_OPTIMIZATION', ['energy_system_agent']],
      ['STORAGE_MANAGEMENT', ['energy_system_agent']],
      ['RENEWABLE_PLANNING', ['energy_system_agent']],
      ['AI_DEPLOYMENT', ['ai_systems_agent']],
      ['MODEL_OPTIMIZATION', ['ai_systems_agent']],
      ['SYSTEM_SCALING', ['ai_systems_agent']],
      ['INFRASTRUCTURE_AI', ['ai_systems_agent']],
      ['SOURCE_MATERIALS', ['procurement_agent']],
      ['VENDOR_NEGOTIATION', ['procurement_agent']],
      ['SUPPLY_CHAIN_TRACK', ['procurement_agent']],
      ['PRICE_OPTIMIZATION', ['procurement_agent']],
      ['CONSTRUCTION_COORDINATE', ['construction_agent']],
      ['CREW_SCHEDULING', ['construction_agent']],
      ['SAFETY_MANAGEMENT', ['construction_agent']],
      ['TIMELINE_MANAGEMENT', ['construction_agent']],
      ['FABRICATE_PARTS', ['fabrication_agent']],
      ['QUALITY_INSPECTION', ['fabrication_agent']],
      ['PRODUCTION_SETUP', ['fabrication_agent']],
      ['CUSTOM_MANUFACTURING', ['fabrication_agent']],
      ['BUDGET_ALLOCATION', ['finance_agent']],
      ['CASH_FLOW_FORECAST', ['finance_agent']],
      ['BURN_RATE_CONTROL', ['finance_agent']],
      ['FINANCIAL_ANALYSIS', ['finance_agent']],
      ['GRANT_SEARCH', ['funding_agent']],
      ['PROPOSAL_GENERATION', ['funding_agent']],
      ['APPLICATION_TRACKING', ['funding_agent']],
      ['DEADLINE_MANAGEMENT', ['funding_agent']],
      ['REVENUE_STRATEGY', ['revenue_agent']],
      ['PRICING_OPTIMIZATION', ['revenue_agent']],
      ['MONETIZATION_ANALYSIS', ['revenue_agent']],
      ['MARKET_ANALYSIS', ['revenue_agent']],
      ['PARTNERSHIP_DEVELOP', ['outreach_agent']],
      ['EMAIL_CAMPAIGN', ['outreach_agent']],
      ['PROPOSAL_GENERATION_OUTREACH', ['outreach_agent']],
      ['CRM_MANAGEMENT', ['outreach_agent']],
      ['BRAND_DEVELOPMENT', ['marketing_agent']],
      ['CONTENT_CREATION', ['marketing_agent']],
      ['CAMPAIGN_MANAGEMENT', ['marketing_agent']],
      ['SOCIAL_MEDIA', ['marketing_agent']],
      ['COMMUNITY_MANAGEMENT', ['community_agent']],
      ['USER_ONBOARDING', ['community_agent']],
      ['SUPPORT_COORDINATION', ['community_agent']],
      ['FEEDBACK_COLLECTION', ['community_agent']],
      ['FACILITY_CONTROL', ['facility_agent']],
      ['HVAC_MANAGEMENT', ['facility_agent']],
      ['LIGHTING_SYSTEMS', ['facility_agent']],
      ['ENVIRONMENTAL_MONITORING', ['facility_agent']],
      ['SECURITY_MONITORING', ['security_agent']],
      ['ACCESS_CONTROL', ['security_agent']],
      ['INCIDENT_RESPONSE', ['security_agent']],
      ['SURVEILLANCE_MANAGEMENT', ['security_agent']],
      ['WORKFLOW_OPTIMIZE', ['workflow_agent']],
      ['RESOURCE_ALLOCATION', ['workflow_agent']],
      ['PRODUCTIVITY_TRACK', ['workflow_agent']],
      ['SPACE_MANAGEMENT', ['workflow_agent']],
      ['REZONATE_LIST_PROJECTS', ['rezonate.agent']],
      ['REZONATE_CREATE_PROJECT', ['rezonate.agent']],
      ['REZONATE_LIST_TRACKS', ['rezonate.agent']],
      ['REZONATE_CREATE_TRACK', ['rezonate.agent']],
      ['REZONATE_GET_JOB', ['rezonate.agent']],
      ['REZONATE_CREATE_JOB', ['rezonate.agent']],
      ['REZONATE_START_JOB', ['rezonate.agent']],
      ['REZONATE_EXPORT_PROJECT', ['rezonate.agent']],
      ['REZONATE_HEALTH', ['rezonate.agent']]
    ]);
  }

  private setupEventHandlers(): void {
    this.eventBus.subscribe({
      agent_id: 'heidi_controller',
      event_types: ['*'],
      handler: async (event: any) => {
        await this.processEvent(event);
      }
    });
  }

  private async processEvent(event: any): Promise<void> {
    this.systemMetrics.tasks_processed++;
    console.log(`[HEIDI] Processing: ${event.type} from ${event.source_agent}`);
    
    if (this.isRedundantTask(event)) {
      console.log(`[HEIDI] Redundant task detected: ${event.type} - SKIPPING`);
      return;
    }
    
    const riskAssessment = this.riskEngine.assess(event);
    
    if (riskAssessment.requires_approval) {
      await this.escalateForApproval(event, riskAssessment);
      return;
    }
    
    const directive = this.createDirective(event);
    const assignedAgents = this.assignAgents(directive);
    
    for (const agentId of assignedAgents) {
      await this.routeToAgent(agentId, directive);
    }
    
    this.updateMetrics();
  }

  private isRedundantTask(event: any): boolean {
    for (const [, activeTask] of this.activeTasks.entries()) {
      if (activeTask.task_type === event.type &&
          JSON.stringify(activeTask) === JSON.stringify(event.payload)) {
        return true;
      }
    }
    return false;
  }

  private createDirective(event: any): HeidiDirective {
    const routingAgents = this.taskRoutingMatrix.get(event.type) || [];
    const primaryAgent = routingAgents[0] || 'unknown';
    return {
      task_id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      assigned_agent: primaryAgent,
      task_type: event.type,
      priority: event.priority || 'medium',
      description: this.generateTaskDescription(event),
      deadline: event.deadline,
      dependencies: event.dependencies || [],
      estimated_duration: event.estimated_duration,
      risk_level: this.assessTaskRisk(event),
      expected_outcome: this.defineExpectedOutcome(event)
    };
  }

  private assignAgents(directive: HeidiDirective): string[] {
    const assignedAgents = [directive.assigned_agent];
    if (directive.task_type.includes('DESIGN') && directive.task_type.includes('ENERGY')) {
      assignedAgents.push('energy_system_agent');
    }
    if (directive.task_type.includes('CONSTRUCTION') && directive.task_type.includes('SAFETY')) {
      assignedAgents.push('security_agent');
    }
    return this.validateAgentAvailability(assignedAgents);
  }

  private validateAgentAvailability(agents: string[]): string[] {
    const availableAgents = agents.filter(agentId => {
      const agent = this.agentRegistry.getAgent(agentId);
      return agent && agent.status === 'active' && agent.load < 0.8;
    });
    if (availableAgents.length === 0) {
      console.warn(`[HEIDI] No available agents for task: ${agents.join(', ')}`);
      return agents;
    }
    return availableAgents;
  }

  private async routeToAgent(agentId: string, directive: HeidiDirective): Promise<void> {
    const agent = this.agentRegistry.getAgent(agentId);
    if (!agent) {
      console.error(`[HEIDI] Agent not found: ${agentId}`);
      this.handleTaskFailure(directive, 'Agent not found');
      return;
    }
    try {
      this.activeTasks.set(directive.task_id, directive);
      await agent.execute({
        task_id: directive.task_id,
        type: directive.task_type,
        payload: directive,
        source_agent: 'heidi_controller',
        target_agent: agentId,
        priority: directive.priority,
        timestamp: new Date().toISOString()
      });
      console.log(`[HEIDI] Routed ${directive.task_type} to ${agentId} (Priority: ${directive.priority})`);
    } catch (error) {
      console.error(`[HEIDI] Task execution failed: ${directive.task_id}`, error);
      this.handleTaskFailure(directive, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private handleTaskFailure(directive: HeidiDirective, reason: string): void {
    this.failedTasks.push(directive);
    this.activeTasks.delete(directive.task_id);
    this.systemMetrics.tasks_failed++;
    if (directive.priority === 'critical' || directive.risk_level === 'critical') {
      this.escalateCriticalFailure(directive, reason);
    }
  }

  private generateTaskDescription(event: any): string {
    const descriptions: Record<string, string> = {
      'DESIGN_CONTAINER_MODULE': 'Design modular container structure with load analysis',
      'POWER_SYSTEM_DESIGN': 'Design autonomous power system with renewable integration',
      'BUDGET_ALLOCATION': 'Allocate budget across project phases based on priorities',
      'GRANT_SEARCH': 'Search and identify suitable funding opportunities',
      'FACILITY_CONTROL': 'Control and monitor facility systems'
    };
    return descriptions[event.type] || `Execute ${event.type} task`;
  }

  private defineExpectedOutcome(event: any): string {
    const outcomes: Record<string, string> = {
      'DESIGN_CONTAINER_MODULE': 'Complete CAD specifications and structural analysis',
      'POWER_SYSTEM_DESIGN': 'Optimized power system design with cost projections',
      'BUDGET_ALLOCATION': 'Balanced budget allocation with risk mitigation',
      'GRANT_SEARCH': 'List of qualified funding opportunities with deadlines',
      'FACILITY_CONTROL': 'Stable facility operations with monitoring'
    };
    return outcomes[event.type] || 'Task completed successfully';
  }

  private assessTaskRisk(event: any): 'low' | 'medium' | 'high' | 'critical' {
    const riskFactors: Record<string, 'low' | 'medium' | 'high' | 'critical'> = {
      'STRUCTURAL_MODIFICATION': 'high',
      'LEGAL_COMMITMENT': 'critical',
      'LARGE_FINANCIAL': 'critical',
      'SYSTEM_SHUTDOWN': 'critical',
      'SAFETY_CRITICAL': 'high',
      'DESIGN_REVISION': 'medium',
      'BUDGET_REALLOCATION': 'medium'
    };
    return riskFactors[event.type] || 'low';
  }

  private async escalateForApproval(event: any, riskAssessment: any): Promise<void> {
    const approvalRequest = {
      decision_id: `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      summary: `Approval required for ${event.type}`,
      risk_level: riskAssessment.level,
      recommended_action: riskAssessment.recommendation,
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      event,
      risk_assessment: riskAssessment
    };
    this.systemMetrics.approvals_pending++;
    await this.approvalEngine.request(approvalRequest);
    console.log(`[HEIDI] Escalated for approval: ${event.type} (${riskAssessment.level})`);
  }

  private escalateCriticalFailure(directive: HeidiDirective, reason: string): void {
    const escalation = {
      task_id: directive.task_id,
      severity: 'critical',
      reason,
      directive,
      timestamp: new Date().toISOString(),
      requires_immediate_attention: true
    };
    this.emit('critical_failure', escalation);
    console.error(`[HEIDI] CRITICAL FAILURE: ${directive.task_type} - ${reason}`);
  }

  private emit(_event: string, _data: unknown): void {}

  private updateMetrics(): void {
    const totalTasks = this.systemMetrics.tasks_processed;
    const completedTasks = this.systemMetrics.tasks_completed;
    this.systemMetrics.system_efficiency = totalTasks > 0 ? completedTasks / totalTasks : 0;
    for (const agentId of this.agentRegistry.getAllAgentIds()) {
      const agent = this.agentRegistry.getAgent(agentId);
      this.systemMetrics.agent_utilization[agentId] = agent ? agent.load : 0;
    }
  }

  getSystemStatus(): any {
    return { running: this.running, metrics: this.systemMetrics, active_tasks: this.activeTasks.size, completed_tasks: this.completedTasks.length, failed_tasks: this.failedTasks.length, agent_status: this.agentRegistry.getAllAgents(), routing_matrix: Object.fromEntries(this.taskRoutingMatrix) };
  }

  getTaskQueue(): HeidiDirective[] {
    return Array.from(this.activeTasks.values()).sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  completeTask(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (task) { this.completedTasks.push(task); this.activeTasks.delete(taskId); this.systemMetrics.tasks_completed++; console.log(`[HEIDI] Task completed: ${task.task_type}`); }
  }

  async start(): Promise<void> {
    this.running = true;
    console.log('[HEIDI] Executive Orchestrator started');
    while (this.running) {
      try {
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('[HEIDI] Error in main loop:', error);
      }
    }
  }

  stop(): void {
    this.running = false;
    console.log('[HEIDI] Executive Orchestrator stopped');
  }
}
