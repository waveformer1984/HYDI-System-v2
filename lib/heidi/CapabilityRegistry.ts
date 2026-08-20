/**
 * HEIDI Capability Registry
 *
 * The single source of truth for all capabilities HEIDI can invoke.
 * Rather than a hard-coded switch statement inside CognitiveCore, this
 * registry lets HEIDI discover:
 *   - capability name
 *   - provider (which existing system implements it)
 *   - risk level (R0-R5)
 *   - autonomy requirement
 *   - dependencies
 *   - verification strategy
 *   - current availability/health
 *
 * Capabilities are registered from the existing authoritative systems:
 *   - ActionExecutor (create_task, fetch_data, update_database, schedule_event, send_email)
 *   - OperationalIntelligence (recovery actions)
 *   - CommunicationLayer (send_message)
 *   - RevenueControlLoop (revenue actions)
 *   - GoalSystem (goal management)
 *   - WorldModel (observation)
 *
 * The registry does NOT execute anything. It only describes what exists
 * and how to authorize it. Execution is handled by CognitiveCore through
 * the registered executor function.
 */

import type { RiskLevel } from '../operational/types';

export type CapabilityProvider =
  | 'action_executor'
  | 'operational_intelligence'
  | 'communication_layer'
  | 'revenue_control_loop'
  | 'revenue_pipeline'
  | 'revenue_lifecycle'
  | 'revenue_ledger'
  | 'commercial_workflow'
  | 'goal_system'
  | 'world_model'
  | 'cognitive_core'
  | 'capability_health_manager'
  | 'blocker_resolution_engine'
  | 'self_repair_engine';

export type CapabilityStatus =
  | 'available'
  | 'unavailable'
  | 'degraded'
  | 'unknown';

export interface CapabilityDescriptor {
  capabilityId: string;
  capabilityName: string;
  description: string;
  provider: CapabilityProvider;
  riskLevel: RiskLevel;
  autonomyRequirement: number; // 0-5 autonomy level required
  dependencies: string[]; // other capabilityIds this depends on
  verificationStrategy: string;
  reversible: boolean;
  timeoutMs: number;
  status: CapabilityStatus;
  healthNote: string | null;
  metadata: Record<string, unknown>;
}

export interface CapabilityResult {
  capabilityId: string;
  executed: boolean;
  outcome: 'success' | 'failure' | 'skipped' | 'pending';
  result: unknown;
  error: string | null;
  evidence: unknown[];
  verified: boolean;
  verificationDetails: string;
}

// Executor function type — called by CognitiveCore to invoke the capability
export type CapabilityExecutor = (
  params: Record<string, unknown>,
  context: CapabilityExecutionContext,
) => Promise<CapabilityResult>;

export interface CapabilityExecutionContext {
  sessionId: string;
  actorId: string;
  actorTrustLevel: string;
  authorizationMode: string;
  auditTrail: unknown[];
}

interface RegisteredCapability {
  descriptor: CapabilityDescriptor;
  executor: CapabilityExecutor | null; // null for capabilities that are not yet wired
}

export class CapabilityRegistry {
  private capabilities: Map<string, RegisteredCapability> = new Map();

  /**
   * Register a capability. If executor is null, the capability is
   * discovered but not yet executable — CognitiveCore will report it
   * as "known but not wired" rather than silently failing.
   */
  register(
    descriptor: Omit<CapabilityDescriptor, 'status' | 'healthNote'>,
    executor: CapabilityExecutor | null = null,
  ): void {
    const fullDescriptor: CapabilityDescriptor = {
      ...descriptor,
      status: executor ? 'available' : 'unavailable',
      healthNote: executor ? null : 'Not yet wired to an executor',
    };
    this.capabilities.set(descriptor.capabilityId, { descriptor: fullDescriptor, executor });
  }

  /**
   * Update a capability's status and health.
   */
  updateStatus(capabilityId: string, status: CapabilityStatus, healthNote?: string): void {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) return;
    cap.descriptor.status = status;
    if (healthNote !== undefined) {
      cap.descriptor.healthNote = healthNote;
    }
  }

  /**
   * Get a capability descriptor.
   */
  get(capabilityId: string): CapabilityDescriptor | null {
    const cap = this.capabilities.get(capabilityId);
    return cap ? cap.descriptor : null;
  }

  /**
   * Get the executor for a capability.
   */
  getExecutor(capabilityId: string): CapabilityExecutor | null {
    const cap = this.capabilities.get(capabilityId);
    return cap ? cap.executor : null;
  }

  /**
   * List all capabilities.
   */
  listAll(): CapabilityDescriptor[] {
    return Array.from(this.capabilities.values()).map((c) => c.descriptor);
  }

  /**
   * List capabilities by provider.
   */
  listByProvider(provider: CapabilityProvider): CapabilityDescriptor[] {
    return this.listAll().filter((c) => c.provider === provider);
  }

  /**
   * List capabilities by risk level.
   */
  listByRiskLevel(riskLevel: RiskLevel): CapabilityDescriptor[] {
    return this.listAll().filter((c) => c.riskLevel === riskLevel);
  }

  /**
   * List capabilities available at a given autonomy level.
   */
  listAvailableAt(autonomyLevel: number): CapabilityDescriptor[] {
    return this.listAll().filter(
      (c) => c.autonomyRequirement <= autonomyLevel && c.status === 'available',
    );
  }

  /**
   * Check if a capability is available and authorized at a given autonomy level.
   */
  isExecutable(capabilityId: string, autonomyLevel: number): {
    executable: boolean;
    reason: string;
  } {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) {
      return { executable: false, reason: `Capability '${capabilityId}' not registered` };
    }
    if (!cap.executor) {
      return { executable: false, reason: `Capability '${capabilityId}' has no executor (not wired)` };
    }
    if (cap.descriptor.status === 'unavailable') {
      return { executable: false, reason: `Capability '${capabilityId}' is unavailable: ${cap.descriptor.healthNote}` };
    }
    if (cap.descriptor.autonomyRequirement > autonomyLevel) {
      return {
        executable: false,
        reason: `Capability '${capabilityId}' requires autonomy level ${cap.descriptor.autonomyRequirement}, current is ${autonomyLevel}`,
      };
    }
    return { executable: true, reason: 'Capability is available and authorized' };
  }

  /**
   * Execute a capability through its registered executor.
   */
  async execute(
    capabilityId: string,
    params: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ): Promise<CapabilityResult> {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) {
      return {
        capabilityId,
        executed: false,
        outcome: 'failure',
        result: null,
        error: `Capability '${capabilityId}' not registered`,
        evidence: [],
        verified: false,
        verificationDetails: 'Capability not found — nothing to verify',
      };
    }
    if (!cap.executor) {
      return {
        capabilityId,
        executed: false,
        outcome: 'skipped',
        result: null,
        error: `Capability '${capabilityId}' has no executor (not wired)`,
        evidence: [],
        verified: false,
        verificationDetails: 'No executor — nothing to verify',
      };
    }
    try {
      return await cap.executor(params, context);
    } catch (error) {
      return {
        capabilityId,
        executed: false,
        outcome: 'failure',
        result: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        evidence: [],
        verified: false,
        verificationDetails: 'Executor threw — nothing to verify',
      };
    }
  }

  /**
   * Get a summary of all capabilities.
   */
  getSummary(): {
    total: number;
    available: number;
    unavailable: number;
    byProvider: Record<string, number>;
    byRiskLevel: Record<string, number>;
  } {
    const all = this.listAll();
    const byProvider: Record<string, number> = {};
    const byRiskLevel: Record<string, number> = {};
    let available = 0;
    let unavailable = 0;

    for (const cap of all) {
      byProvider[cap.provider] = (byProvider[cap.provider] || 0) + 1;
      byRiskLevel[cap.riskLevel] = (byRiskLevel[cap.riskLevel] || 0) + 1;
      if (cap.status === 'available') available++;
      else unavailable++;
    }

    return { total: all.length, available, unavailable, byProvider, byRiskLevel };
  }
}

// ─── Default capability descriptors ────────────────────────────────────
//
// These describe the capabilities that exist in the repository.
// Executors are wired by CognitiveCore during initialization.

export const DEFAULT_CAPABILITIES: Array<Omit<CapabilityDescriptor, 'status' | 'healthNote'>> = [
  // ActionExecutor capabilities
  {
    capabilityId: 'tool.create_task',
    capabilityName: 'Create Task',
    description: 'Create a task in the actions table',
    provider: 'action_executor',
    riskLevel: 'R1',
    autonomyRequirement: 2,
    dependencies: [],
    verificationStrategy: 'Verify task exists in actions table by ID',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'create_task' },
  },
  {
    capabilityId: 'tool.fetch_data',
    capabilityName: 'Fetch Data',
    description: 'Fetch data from a readable table',
    provider: 'action_executor',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify data was returned (non-null result)',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'fetch_data' },
  },
  {
    capabilityId: 'tool.update_database',
    capabilityName: 'Update Database',
    description: 'Update a writable table',
    provider: 'action_executor',
    riskLevel: 'R2',
    autonomyRequirement: 3,
    dependencies: [],
    verificationStrategy: 'Verify persisted state by re-reading the updated row',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'update_database' },
  },
  {
    capabilityId: 'tool.schedule_event',
    capabilityName: 'Schedule Event',
    description: 'Schedule a future event in the actions table',
    provider: 'action_executor',
    riskLevel: 'R1',
    autonomyRequirement: 2,
    dependencies: [],
    verificationStrategy: 'Verify scheduled event exists in actions table by ID',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'schedule_event' },
  },
  {
    capabilityId: 'tool.send_email',
    capabilityName: 'Send Email',
    description: 'Send an email via Resend',
    provider: 'action_executor',
    riskLevel: 'R2',
    autonomyRequirement: 3,
    dependencies: [],
    verificationStrategy: 'Verify provider response contains email ID',
    reversible: false,
    timeoutMs: 30000,
    metadata: { actionType: 'send_email' },
  },

  // OperationalIntelligence capabilities
  {
    capabilityId: 'recovery.governed_recover',
    capabilityName: 'Governed Recovery',
    description: 'Execute governed recovery for a component via OperationalIntelligence',
    provider: 'operational_intelligence',
    riskLevel: 'R1',
    autonomyRequirement: 2,
    dependencies: [],
    verificationStrategy: 'Re-observe target component health after recovery',
    reversible: true,
    timeoutMs: 60000,
    metadata: { actionType: 'governed_recover' },
  },
  {
    capabilityId: 'recovery.auto_recover',
    capabilityName: 'Auto Recovery',
    description: 'Automatically diagnose and recover all unhealthy components',
    provider: 'operational_intelligence',
    riskLevel: 'R2',
    autonomyRequirement: 3,
    dependencies: [],
    verificationStrategy: 'Final health check shows all components healthy',
    reversible: true,
    timeoutMs: 120000,
    metadata: { actionType: 'auto_recover' },
  },
  {
    capabilityId: 'ops.diagnose',
    capabilityName: 'Diagnostic Snapshot',
    description: 'Produce a diagnostic snapshot of the system',
    provider: 'operational_intelligence',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Snapshot contains expected sections',
    reversible: true,
    timeoutMs: 30000,
    metadata: { actionType: 'diagnose' },
  },
  {
    capabilityId: 'ops.check_health',
    capabilityName: 'Check Health',
    description: 'Run a full health check and return overall state',
    provider: 'operational_intelligence',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Health check returns a valid ComponentState',
    reversible: true,
    timeoutMs: 30000,
    metadata: { actionType: 'check_health' },
  },

  // CommunicationLayer capabilities
  {
    capabilityId: 'comm.send_message',
    capabilityName: 'Send Message',
    description: 'Send a message through the unified CommunicationLayer',
    provider: 'communication_layer',
    riskLevel: 'R2',
    autonomyRequirement: 3,
    dependencies: [],
    verificationStrategy: 'Verify delivery status in communication_events',
    reversible: false,
    timeoutMs: 30000,
    metadata: { actionType: 'send_message' },
  },
  {
    capabilityId: 'comm.get_capabilities',
    capabilityName: 'Get Communication Capabilities',
    description: 'List available communication channels and their status',
    provider: 'communication_layer',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Capabilities list is non-empty',
    reversible: true,
    timeoutMs: 5000,
    metadata: { actionType: 'get_capabilities' },
  },

  // RevenueControlLoop capabilities
  {
    capabilityId: 'revenue.run_cycle',
    capabilityName: 'Revenue Control Loop Cycle',
    description: 'Run one cycle of the revenue control loop (metrics→actions→execute→verify)',
    provider: 'revenue_control_loop',
    riskLevel: 'R2',
    autonomyRequirement: 3,
    dependencies: [],
    verificationStrategy: 'RevenueControlLoopResult contains metrics and action results',
    reversible: true,
    timeoutMs: 60000,
    metadata: { actionType: 'run_cycle' },
  },
  {
    capabilityId: 'revenue.collect_metrics',
    capabilityName: 'Collect Revenue Metrics',
    description: 'Collect current revenue metrics without executing actions',
    provider: 'revenue_control_loop',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Metrics object contains expected fields',
    reversible: true,
    timeoutMs: 15000,
    metadata: { actionType: 'collect_metrics' },
  },

  // GoalSystem capabilities
  {
    capabilityId: 'goal.create',
    capabilityName: 'Create Goal',
    description: 'Create a new hierarchical goal',
    provider: 'goal_system',
    riskLevel: 'R1',
    autonomyRequirement: 2,
    dependencies: [],
    verificationStrategy: 'Verify goal exists by ID in heidi_goals table',
    reversible: true,
    timeoutMs: 5000,
    metadata: { actionType: 'create_goal' },
  },
  {
    capabilityId: 'goal.advance',
    capabilityName: 'Advance Goal',
    description: 'Mark a goal as in_progress and begin working on it',
    provider: 'goal_system',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify goal status changed to in_progress',
    reversible: true,
    timeoutMs: 5000,
    metadata: { actionType: 'advance_goal' },
  },
  {
    capabilityId: 'goal.complete',
    capabilityName: 'Complete Goal',
    description: 'Mark a goal as completed with a result',
    provider: 'goal_system',
    riskLevel: 'R1',
    autonomyRequirement: 2,
    dependencies: [],
    verificationStrategy: 'Verify goal status is completed and has a result',
    reversible: false,
    timeoutMs: 5000,
    metadata: { actionType: 'complete_goal' },
  },

  // WorldModel capabilities
  {
    capabilityId: 'world.sync',
    capabilityName: 'Sync World Model',
    description: 'Sync the world model from runtime sources',
    provider: 'world_model',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'World model entity count increased or stable',
    reversible: true,
    timeoutMs: 30000,
    metadata: { actionType: 'sync' },
  },
  {
    capabilityId: 'world.query',
    capabilityName: 'Query World Model',
    description: 'Query the world model for entities or health summary',
    provider: 'world_model',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Query returns a valid result',
    reversible: true,
    timeoutMs: 5000,
    metadata: { actionType: 'query' },
  },

  // CognitiveCore capabilities
  {
    capabilityId: 'cognitive.observe',
    capabilityName: 'Observe',
    description: 'Run a perception cycle without executing actions',
    provider: 'cognitive_core',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Perception result contains system health',
    reversible: true,
    timeoutMs: 30000,
    metadata: { actionType: 'observe' },
  },

  // Revenue pipeline capabilities (ProspectPipeline)
  {
    capabilityId: 'revenue.identify_prospect',
    capabilityName: 'Identify Prospect',
    description: 'Identify a new prospect from company/contact signals',
    provider: 'revenue_pipeline',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify prospect exists in revenue_prospects by ID',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'identify_prospect' },
  },
  {
    capabilityId: 'revenue.score_prospect',
    capabilityName: 'Score Prospect',
    description: 'Score a prospect against the ideal customer profile',
    provider: 'revenue_pipeline',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: ['revenue.identify_prospect'],
    verificationStrategy: 'Verify score result contains numeric score and factors',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'score_prospect' },
  },
  {
    capabilityId: 'revenue.update_prospect_status',
    capabilityName: 'Update Prospect Status',
    description: 'Update a prospect pipeline status (e.g. qualified, opted_out)',
    provider: 'revenue_pipeline',
    riskLevel: 'R1',
    autonomyRequirement: 2,
    dependencies: ['revenue.identify_prospect'],
    verificationStrategy: 'Verify prospect status changed by re-reading the prospect',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'update_prospect_status' },
  },
  {
    capabilityId: 'revenue.create_opportunity',
    capabilityName: 'Create Opportunity',
    description: 'Create a revenue opportunity from a qualified prospect',
    provider: 'revenue_pipeline',
    riskLevel: 'R1',
    autonomyRequirement: 2,
    dependencies: ['revenue.score_prospect'],
    verificationStrategy: 'Verify opportunity exists in revenue_opportunities by ID',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'create_opportunity' },
  },
  {
    capabilityId: 'revenue.pipeline_metrics',
    capabilityName: 'Pipeline Metrics',
    description: 'Collect current prospect pipeline metrics',
    provider: 'revenue_pipeline',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify metrics object contains total and byStatus fields',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'pipeline_metrics' },
  },

  // Revenue lifecycle capabilities (CustomerLifecycle)
  {
    capabilityId: 'revenue.start_onboarding',
    capabilityName: 'Start Customer Onboarding',
    description: 'Start onboarding a new customer',
    provider: 'revenue_lifecycle',
    riskLevel: 'R2',
    autonomyRequirement: 3,
    dependencies: [],
    verificationStrategy: 'Verify customer service record exists with onboarding status',
    reversible: true,
    timeoutMs: 15000,
    metadata: { actionType: 'start_onboarding' },
  },
  {
    capabilityId: 'revenue.activate_service',
    capabilityName: 'Activate Service',
    description: 'Activate a provisioned customer service',
    provider: 'revenue_lifecycle',
    riskLevel: 'R2',
    autonomyRequirement: 3,
    dependencies: ['revenue.start_onboarding'],
    verificationStrategy: 'Verify service status is active by re-reading the record',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'activate_service' },
  },
  {
    capabilityId: 'revenue.verify_service',
    capabilityName: 'Verify Service',
    description: 'Verify a customer service is operational',
    provider: 'revenue_lifecycle',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify result contains verified boolean and details',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'verify_service' },
  },

  // Revenue ledger capabilities (RevenueLedger)
  {
    capabilityId: 'revenue.get_verified_revenue',
    capabilityName: 'Get Verified Revenue',
    description: 'Get the total verified revenue amount (never fabricated)',
    provider: 'revenue_ledger',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify result is a non-negative number',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'get_verified_revenue' },
  },
  {
    capabilityId: 'revenue.get_revenue_summary',
    capabilityName: 'Get Revenue Summary',
    description: 'Get a full revenue summary (verified revenue, MRR, events)',
    provider: 'revenue_ledger',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify summary object contains expected revenue fields',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'get_revenue_summary' },
  },

  // Commercial workflow capabilities (CommercialWorkflow)
  {
    capabilityId: 'commercial.get_state',
    capabilityName: 'Get Commercial State',
    description: 'Get the current commercial workflow state including discovery, email, and Stripe availability',
    provider: 'commercial_workflow',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify state object contains availability flags',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'commercial_get_state' },
  },
  {
    capabilityId: 'commercial.discover_prospects',
    capabilityName: 'Discover Prospects',
    description: 'Discover prospects from external sources (reports BLOCKED if no provider configured)',
    provider: 'commercial_workflow',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify discovery result contains available flag and provenance',
    reversible: true,
    timeoutMs: 30000,
    metadata: { actionType: 'commercial_discover' },
  },
  {
    capabilityId: 'commercial.ingest_prospect',
    capabilityName: 'Ingest Prospect',
    description: 'Ingest a discovered prospect into the pipeline with deduplication and scoring',
    provider: 'commercial_workflow',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify prospect was created or deduplicated with score',
    reversible: true,
    timeoutMs: 15000,
    metadata: { actionType: 'commercial_ingest' },
  },
  {
    capabilityId: 'commercial.create_opportunity',
    capabilityName: 'Create Opportunity',
    description: 'Create an opportunity for a qualified prospect (requires ICP score >= 50)',
    provider: 'commercial_workflow',
    riskLevel: 'R1',
    autonomyRequirement: 2,
    dependencies: [],
    verificationStrategy: 'Verify opportunity was created in DB with correct offer',
    reversible: true,
    timeoutMs: 15000,
    metadata: { actionType: 'commercial_create_opportunity' },
  },
  {
    capabilityId: 'commercial.prepare_outreach',
    capabilityName: 'Prepare Outreach Draft',
    description: 'Generate an evidence-backed outreach draft (R0 — no hallucination, no sending)',
    provider: 'commercial_workflow',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify draft contains evidence and explicit unknown facts',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'commercial_prepare_outreach' },
  },
  {
    capabilityId: 'commercial.create_authorization_package',
    capabilityName: 'Create Authorization Package',
    description: 'Create an authorization package for R2+ commercial action (requires human approval)',
    provider: 'commercial_workflow',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify package contains all required fields and decision=pending',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'commercial_create_auth_package' },
  },
  {
    capabilityId: 'commercial.verify_revenue',
    capabilityName: 'Verify Revenue',
    description: 'Verify revenue from the authoritative RevenueLedger (never fabricated)',
    provider: 'commercial_workflow',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Verify revenue result comes from RevenueLedger',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'commercial_verify_revenue' },
  },
  // ─── Self-Sufficiency capabilities ────────────────────────────────────
  {
    capabilityId: 'self_sufficiency.check_all_capabilities',
    capabilityName: 'Check All Capabilities',
    description: 'Probe all registered capabilities and return evidence-backed health summary',
    provider: 'capability_health_manager',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Health summary returned with evidence for each capability',
    reversible: true,
    timeoutMs: 30000,
    metadata: { actionType: 'self_sufficiency_check_all' },
  },
  {
    capabilityId: 'self_sufficiency.check_capability',
    capabilityName: 'Check Single Capability',
    description: 'Probe a single capability by ID and return evidence-backed health report',
    provider: 'capability_health_manager',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Health report returned with evidence',
    reversible: true,
    timeoutMs: 15000,
    metadata: { actionType: 'self_sufficiency_check_capability' },
  },
  {
    capabilityId: 'self_sufficiency.get_ready_capabilities',
    capabilityName: 'Get Ready Capabilities',
    description: 'Return all capabilities currently in READY state with evidence',
    provider: 'capability_health_manager',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'READY capabilities have evidence and lastSuccessfulVerification',
    reversible: true,
    timeoutMs: 5000,
    metadata: { actionType: 'self_sufficiency_get_ready' },
  },
  {
    capabilityId: 'self_sufficiency.resolve_blockers',
    capabilityName: 'Resolve Blockers',
    description: 'Classify and resolve blockers for a set of capability health reports',
    provider: 'blocker_resolution_engine',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Blocker resolution result returned with classifications',
    reversible: true,
    timeoutMs: 15000,
    metadata: { actionType: 'self_sufficiency_resolve_blockers' },
  },
  {
    capabilityId: 'self_sufficiency.run_self_repair',
    capabilityName: 'Run Self-Repair',
    description: 'Run governed self-repair loop on a health summary (R0/R1 autonomous, R2+ human)',
    provider: 'self_repair_engine',
    riskLevel: 'R1',
    autonomyRequirement: 1,
    dependencies: [],
    verificationStrategy: 'Self-repair result includes verification evidence for each repair',
    reversible: true,
    timeoutMs: 30000,
    metadata: { actionType: 'self_sufficiency_run_self_repair' },
  },
  {
    capabilityId: 'self_sufficiency.get_repair_history',
    capabilityName: 'Get Repair History',
    description: 'Return the history of all self-repair actions with rollback info',
    provider: 'self_repair_engine',
    riskLevel: 'R0',
    autonomyRequirement: 0,
    dependencies: [],
    verificationStrategy: 'Repair history returned with audit trail',
    reversible: true,
    timeoutMs: 5000,
    metadata: { actionType: 'self_sufficiency_get_repair_history' },
  },
];

// Singleton
let _instance: CapabilityRegistry | null = null;

export function getCapabilityRegistry(): CapabilityRegistry {
  if (!_instance) {
    _instance = new CapabilityRegistry();
    // Register all default capabilities (without executors — CognitiveCore wires them)
    for (const cap of DEFAULT_CAPABILITIES) {
      _instance.register(cap, null);
    }
  }
  return _instance;
}
