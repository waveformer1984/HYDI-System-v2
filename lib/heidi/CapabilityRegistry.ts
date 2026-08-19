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
  | 'goal_system'
  | 'world_model'
  | 'cognitive_core';

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
