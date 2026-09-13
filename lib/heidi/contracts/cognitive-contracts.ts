/**
 * Capability contracts for the capabilities CognitiveCore actually verifies.
 *
 * Each of these replaces one branch of the former ~270-line if-chain in
 * `CognitiveCore.verifyAction()`. The semantics are carried over faithfully:
 * where the legacy branch re-read a database row, the contract observes
 * `database`; where it inspected the executor's return value, the contract
 * observes `api_response` and says plainly that this is the weaker check.
 *
 * What changed is WHERE the knowledge lives. Adding the fourteenth capability
 * now means adding a contract, not editing the planner.
 *
 * Honesty note on `api_response`: four of these verify against the executor's
 * own return value. That is not real verification — it is the executor
 * marking its own homework — and it is retained only because the legacy chain
 * did exactly the same thing and no durable record exists to read instead.
 * Each such contract carries a `weakVerification: true` metadata flag so
 * `npm run capability:audit` can list them as debt rather than let them pass
 * as verified work.
 */

import type {
  CapabilityContract,
  EffectSpec,
  VerificationSpec,
} from '../../capability-contract';
import { defineContract } from '../../capability-contract';

const OWNER = 'unassigned';

export function dbEffect(table: string, verb: EffectSpec['verb']): EffectSpec {
  return {
    verb,
    resourceKind: 'database',
    resourcePatterns: [table],
    worstCaseScope: verb === 'read' ? 'none' : 'single_resource',
    crossesTrustBoundary: false,
  };
}

export function dbObservation(target: string, extractFields: string[]): VerificationSpec['observation'] {
  return { source: 'database', target, extractFields, settleMs: 0 };
}

export function responseObservation(): VerificationSpec['observation'] {
  return { source: 'api_response', target: 'response', extractFields: [], settleMs: 0 };
}

export const OWNER_DEFAULT = OWNER;

export const WEAK = { weakVerification: true, reason: 'verifies against the executor’s own return value' };

/**
 * How much a verification predicate is actually worth. These are deliberately
 * NOT collapsed into "success":
 *
 *   independent         re-read from a durable record or an authoritative
 *                       subsystem that did not perform the action
 *   provider_acceptance a third party acknowledged receipt — stronger than
 *                       self-report, weaker than confirmed delivery
 *   orchestrated        the capability's durable effects are produced and
 *                       verified by the capabilities it invokes
 *   self_report         the executor's own claim; verification in name only
 *   unverifiable        no automatable check exists; requires human confirmation
 */
export const CLASS_INDEPENDENT = { verificationClass: 'independent' };
export const CLASS_PROVIDER_ACCEPTANCE = { verificationClass: 'provider_acceptance' };
export const CLASS_ORCHESTRATED = { verificationClass: 'orchestrated' };
export const CLASS_UNVERIFIABLE = { verificationClass: 'unverifiable' };

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export const GOAL_ADVANCE = defineContract({
  identity: {
    id: 'goal.advance',
    version: '1.0.0',
    owner: OWNER,
    provider: 'goal_system',
    description: 'Advance a goal to in_progress',
  },
  effects: [dbEffect('goals', 'update')],
  reversibility: {
    // Corrected after advisory telemetry: declaring this irreversible pushed a
    // single-row status write to R4 in 15% of cycles. A goal status CAN be set
    // back — `goal.advance` re-run, or GoalSystem.updateGoal — which is the
    // same self-inverse pattern `revenue.update_prospect_status` already uses
    // and which showed zero disagreements. The asymmetry was in the
    // declaration, not the system.
    kind: 'inverse_capability',
    inverseCapabilityId: 'goal.advance',
    windowMs: Number.POSITIVE_INFINITY,
    caveat:
      'Restores the status only. Work already performed under the goal, and any ' +
      'downstream effect the advance triggered, are not undone.',
  },
  cost: { estimatedMs: 500, timeoutMs: 10_000 },
  verification: {
    description: 'The goal re-reads as in_progress or completed.',
    observation: dbObservation('goal:{targetGoalId}|goal:{goalId}', ['status']),
    conditions: [
      { field: 'found', operator: 'eq', expected: true },
      { field: 'status', operator: 'matches', expected: '^(in_progress|completed)$' },
    ],
    onFailure: 'replan',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
  contract: {
    signature: {
      params: [
        {
          name: 'targetGoalId',
          type: 'string',
          required: true,
          description: 'Goal to advance',
          resourceRef: 'database',
        },
      ],
      returns: '{ goalId, status }',
    },
  },
});

export const GOAL_COMPLETE = defineContract({
  identity: {
    id: 'goal.complete',
    version: '1.0.0',
    owner: OWNER,
    provider: 'goal_system',
    description: 'Mark a goal complete',
  },
  effects: [dbEffect('goals', 'update')],
  reversibility: {
    kind: 'inverse_capability',
    inverseCapabilityId: 'goal.advance',
    windowMs: Number.POSITIVE_INFINITY,
    caveat:
      'Reopening restores the status only; it does not retract anything done ' +
      'on the strength of the goal having been completed.',
  },
  cost: { estimatedMs: 500, timeoutMs: 10_000 },
  verification: {
    description: 'The goal re-reads as completed.',
    observation: dbObservation('goal:{targetGoalId}|goal:{goalId}', ['status']),
    conditions: [
      { field: 'found', operator: 'eq', expected: true },
      { field: 'status', operator: 'eq', expected: 'completed' },
    ],
    onFailure: 'replan',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
  contract: {
    signature: {
      params: [
        {
          name: 'targetGoalId',
          type: 'string',
          required: true,
          description: 'Goal to complete',
          resourceRef: 'database',
        },
      ],
      returns: '{ goalId, status, result }',
    },
  },
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const TOOL_CREATE_TASK = defineContract({
  identity: {
    id: 'tool.create_task',
    version: '1.0.0',
    owner: OWNER,
    provider: 'action_executor',
    description: 'Create a task row in the actions table',
  },
  effects: [dbEffect('actions', 'create')],
  reversibility: {
    // Advisory telemetry put this at R3 on 100% of invocations, driven solely
    // by `undo=none`. That was the contract telling the truth: nothing could
    // retract a created task. The answer was to build the undo, not to relabel
    // the risk — `tool.cancel_task` now exists and is wired.
    kind: 'inverse_capability',
    inverseCapabilityId: 'tool.cancel_task',
    windowMs: Number.POSITIVE_INFINITY,
    caveat:
      'Bounded by STATE, not time: the task can be retracted only while it is ' +
      'still `pending`. Once a worker claims it the undo correctly refuses, ' +
      'because work that has run cannot be un-run by deleting its record.',
  },
  cost: { estimatedMs: 800, timeoutMs: 10_000 },
  verification: {
    description: 'The task row exists in `actions` and carries a status.',
    observation: dbObservation('sql:actions:id={task_id}|sql:actions:id={taskId}', ['id', 'status']),
    conditions: [
      { field: 'found', operator: 'eq', expected: true },
      { field: 'status', operator: 'not_null', expected: null },
    ],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
});

export const TOOL_CANCEL_TASK = defineContract({
  identity: {
    id: 'tool.cancel_task',
    version: '1.0.0',
    owner: OWNER,
    provider: 'action_executor',
    description: 'Delete a still-pending task row — the inverse of tool.create_task',
  },
  effects: [dbEffect('actions', 'delete')],
  reversibility: {
    // Honest asymmetry: the undo does not itself have an undo. Re-creating the
    // task would produce a new row with a new id, not restore this one.
    kind: 'none',
    windowMs: 0,
    caveat:
      'Re-running create_task makes a NEW task; it does not restore the deleted ' +
      'row or its id. The delete is only ever applied to work that had not started.',
  },
  cost: { estimatedMs: 800, timeoutMs: 10_000 },
  verification: {
    description: 'The task row is absent from `actions`.',
    observation: dbObservation('sql:actions:id={task_id}|sql:actions:id={taskId}', ['id']),
    conditions: [{ field: 'found', operator: 'eq', expected: false }],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
  contract: {
    signature: {
      params: [
        {
          name: 'task_id',
          type: 'string',
          required: true,
          description: 'Task to cancel; must still be pending',
          resourceRef: 'database',
        },
      ],
      returns: '{ task_id, task_name, cancelled: boolean }',
    },
    dependencies: ['tool.create_task'],
  },
});

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

function recoveryContract(id: string, description: string): CapabilityContract {
  return defineContract({
    identity: { id, version: '1.0.0', owner: OWNER, provider: 'operational_intelligence', description },
    effects: [
      {
        verb: 'restart',
        resourceKind: 'service',
        // Bounded by the operational layer's own RESTARTABLE_MODULES set; the
        // contract mirrors it rather than inventing a second source of truth.
        resourcePatterns: [
          'protoforge-core',
          'heidi-web',
          'heidi-mobile-chat',
          'supabase_*',
          'ollama',
        ],
        worstCaseScope: 'subsystem',
        crossesTrustBoundary: false,
      },
    ],
    reversibility: {
      kind: 'self_healing',
      windowMs: 60_000,
      caveat: 'A restart is repeatable, but in-flight work at the moment of restart is lost.',
    },
    cost: { estimatedMs: 15_000, timeoutMs: 60_000 },
    verification: {
      description: 'A post-recovery health check completes without throwing.',
      observation: { source: 'process', target: 'health:{component}', extractFields: [], settleMs: 2_000 },
      conditions: [{ field: 'healthCheckCompleted', operator: 'eq', expected: true }],
      onFailure: 'escalate',
      maxRetries: 1,
      requiresHumanConfirmation: false,
    },
    contract: {
      signature: {
        params: [
          {
            name: 'component',
            type: 'string',
            required: true,
            description: 'Component to recover',
            resourceRef: 'service',
          },
        ],
        returns: '{ recovered: boolean }',
      },
      metadata: {
        verificationCaveat:
          'checkHealth() resolving is treated as healthy. It does not assert that the ' +
          'specific recovered component is healthy — only that the health subsystem ' +
          'answered. Narrowing this to a per-component assertion is open work.',
      },
    },
  });
}

export const RECOVERY_GOVERNED = recoveryContract(
  'recovery.governed_recover',
  'Governed recovery of a component',
);
export const RECOVERY_AUTO = recoveryContract(
  'recovery.auto_recover',
  'Automatic recovery of a component',
);

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------

export const COMM_SEND_MESSAGE = defineContract({
  identity: {
    id: 'comm.send_message',
    version: '1.0.0',
    owner: OWNER,
    provider: 'communication_layer',
    description: 'Send a message to an external recipient',
  },
  effects: [
    {
      verb: 'communicate',
      resourceKind: 'external_party',
      resourcePatterns: [],
      worstCaseScope: 'external',
      crossesTrustBoundary: true,
    },
  ],
  reversibility: {
    kind: 'none',
    windowMs: 0,
    caveat: 'A delivered message cannot be recalled.',
  },
  cost: { estimatedMs: 2_000, timeoutMs: 30_000 },
  verification: {
    description:
      'Delivery re-read from the durable conversation store via ' +
      'CommunicationLayer.verifyDelivery(), not from the send call’s return value.',
    observation: {
      source: 'process',
      target: 'delivery:{messageId}',
      extractFields: [],
      // Delivery status is written asynchronously by the channel adapter.
      settleMs: 1_000,
    },
    conditions: [{ field: 'status', operator: 'matches', expected: '^(delivered|sent)$' }],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
  contract: {
    metadata: {
      ...CLASS_INDEPENDENT,
      environmentBlocker:
        'conversationStore.getMessage() selects `message_id`, which does not exist ' +
        'in this database (chat_messages has: id, conversation_id, sender_type, ' +
        'content, tool_call, created_at). The independent path is implemented and ' +
        'will report `error` here until that drift is resolved — which is the ' +
        'correct failure, not a reason to fall back to the transport’s self-report.',
    },
  },
});

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

export const REVENUE_RUN_CYCLE = defineContract({
  identity: {
    id: 'revenue.run_cycle',
    version: '1.0.0',
    owner: OWNER,
    provider: 'revenue_control_loop',
    description: 'Run one revenue control-loop cycle',
  },
  effects: [
    {
      verb: 'update',
      resourceKind: 'database',
      resourcePatterns: ['revenue_*'],
      // Subsystem, not single_resource. One invocation performs an unbounded
      // set of writes — status updates, scoring, service checks — across the
      // whole revenue pipeline. Declaring it as a single-row update understated
      // it by an order of magnitude.
      worstCaseScope: 'subsystem',
      crossesTrustBoundary: false,
    },
  ],
  reversibility: {
    kind: 'none',
    windowMs: 0,
    caveat: 'The cycle writes pipeline state; there is no single undo for a whole cycle.',
  },
  cost: { estimatedMs: 10_000, timeoutMs: 60_000 },
  verification: {
    description:
      'The cycle returned a result carrying metrics. WEAK: shape check on the return ' +
      'value, not a read of what the cycle wrote.',
    observation: responseObservation(),
    conditions: [
      { field: 'present', operator: 'eq', expected: true },
      { field: 'metrics', operator: 'exists', expected: null },
    ],
    onFailure: 'replan',
    maxRetries: 0,
    requiresHumanConfirmation: false,
  },
  contract: {
    metadata: {
      // NOT `orchestrated`. That classification was written first and was
      // wrong: it assumed run_cycle dispatched its writes through the
      // capability registry, so each would be individually authorized and
      // verified by its own contract. It does not. RevenueControlLoop calls
      // `this.pipeline.updateStatus(...)`, `this.pipeline.scoreProspect(...)`
      // and `this.lifecycle.*` as plain in-process method calls.
      //
      // GOVERNANCE BYPASS: one R3 authorization of run_cycle admits an
      // unbounded set of pipeline writes that are neither individually
      // authorized nor individually verified, even though contracts exist for
      // exactly those operations. The contracts simply never run on this path.
      verificationClass: 'self_report',
      governanceBypass:
        'CLOSED. RevenueControlLoop now authorizes each mutating operation ' +
        'against its own contract via a CapabilityGovernor: score_prospect, ' +
        'update_prospect_status (x2), create_opportunity, start_provisioning ' +
        'and update_health_status. The last two had no contract at all and were ' +
        'written as part of the fix — they were not weakly verified, they were ' +
        'invisible. Every write is recorded in RevenueControlLoopResult.governance, ' +
        'including as `ungoverned` when no governor is supplied, so the bypass ' +
        'cannot silently return.',
      residualRisk:
        'run_cycle keeps subsystem scope and R4: it still authorizes a SEQUENCE ' +
        'of writes in one decision. Per-operation governance bounds each step; ' +
        'it does not make the composition equivalent to a single R2 action.',
      staleComment:
        'The file header claims step 7 "Records evidence in revenue_events", but ' +
        'no such write exists in RevenueControlLoop.',
    },
  },
});

export const REVENUE_IDENTIFY_PROSPECT = defineContract({
  identity: {
    id: 'revenue.identify_prospect',
    version: '1.0.0',
    owner: OWNER,
    provider: 'revenue_pipeline',
    description: 'Identify and persist a prospect',
  },
  effects: [dbEffect('revenue_prospects', 'create')],
  reversibility: {
    kind: 'none',
    windowMs: 0,
    caveat: 'No prospect-delete capability is registered.',
  },
  cost: { estimatedMs: 3_000, timeoutMs: 30_000 },
  verification: {
    description: 'The prospect row exists in revenue_prospects.',
    observation: dbObservation(
      'sql:revenue_prospects:id={prospectId}|sql:revenue_prospects:id={id}',
      ['id'],
    ),
    conditions: [{ field: 'found', operator: 'eq', expected: true }],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
});

export const REVENUE_UPDATE_PROSPECT_STATUS = defineContract({
  identity: {
    id: 'revenue.update_prospect_status',
    version: '1.0.0',
    owner: OWNER,
    provider: 'revenue_pipeline',
    description: 'Move a prospect to a new pipeline status',
  },
  effects: [dbEffect('revenue_prospects', 'update')],
  reversibility: {
    kind: 'inverse_capability',
    inverseCapabilityId: 'revenue.update_prospect_status',
    windowMs: Number.POSITIVE_INFINITY,
    caveat:
      'The same capability can set the status back. It does not restore any ' +
      'side effects the status change triggered downstream.',
  },
  cost: { estimatedMs: 1_000, timeoutMs: 15_000 },
  verification: {
    description: 'The prospect re-reads with the requested status.',
    observation: dbObservation('sql:revenue_prospects:prospect_id={prospectId}', [
      'prospect_id',
      'status',
    ]),
    conditions: [
      { field: 'found', operator: 'eq', expected: true },
      { field: 'status', operator: 'eq', expected: '{newStatus}' },
    ],
    onFailure: 'replan',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
  contract: {
    signature: {
      params: [
        {
          name: 'prospectId',
          type: 'string',
          required: true,
          description: 'Prospect to update',
          resourceRef: 'database',
        },
        { name: 'newStatus', type: 'string', required: true, description: 'Target status' },
      ],
      returns: '{ prospectId, status }',
    },
  },
});

export const REVENUE_CREATE_OPPORTUNITY = defineContract({
  identity: {
    id: 'revenue.create_opportunity',
    version: '1.0.0',
    owner: OWNER,
    provider: 'revenue_pipeline',
    description: 'Create a revenue opportunity',
  },
  effects: [dbEffect('revenue_opportunities', 'create')],
  reversibility: {
    kind: 'none',
    windowMs: 0,
    caveat: 'No opportunity-delete capability is registered.',
  },
  cost: { estimatedMs: 3_000, timeoutMs: 30_000 },
  verification: {
    description: 'The opportunity row exists in revenue_opportunities.',
    observation: dbObservation(
      'sql:revenue_opportunities:opportunity_id={opportunityId}|sql:revenue_opportunities:opportunity_id={id}',
      ['opportunity_id'],
    ),
    conditions: [{ field: 'found', operator: 'eq', expected: true }],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
});

export const REVENUE_ACTIVATE_SERVICE = defineContract({
  identity: {
    id: 'revenue.activate_service',
    version: '1.0.0',
    owner: OWNER,
    provider: 'revenue_lifecycle',
    description: 'Activate a purchased service for a client',
  },
  effects: [
    {
      verb: 'update',
      resourceKind: 'service',
      resourcePatterns: [],
      worstCaseScope: 'subsystem',
      crossesTrustBoundary: true,
    },
  ],
  reversibility: {
    kind: 'none',
    windowMs: 0,
    caveat: 'Activation is customer-visible; deactivating is a separate commercial decision.',
  },
  cost: { estimatedMs: 5_000, timeoutMs: 60_000 },
  verification: {
    description: 'The lifecycle subsystem independently confirms the service is active.',
    observation: { source: 'process', target: 'service:{serviceId}', extractFields: [], settleMs: 0 },
    conditions: [{ field: 'verified', operator: 'eq', expected: true }],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
  contract: {
    signature: {
      params: [
        {
          name: 'serviceId',
          type: 'string',
          required: true,
          description: 'Service to activate',
          resourceRef: 'service',
        },
      ],
      returns: '{ serviceId, active: boolean }',
    },
  },
});

export const REVENUE_GET_VERIFIED_REVENUE = defineContract({
  identity: {
    id: 'revenue.get_verified_revenue',
    version: '1.0.0',
    owner: OWNER,
    provider: 'revenue_ledger',
    description: 'Read verified ledger entries',
  },
  effects: [dbEffect('ledger', 'read')],
  reversibility: {
    kind: 'self_healing',
    windowMs: Number.POSITIVE_INFINITY,
    caveat: 'A read changes nothing.',
  },
  cost: { estimatedMs: 1_000, timeoutMs: 15_000 },
  verification: {
    description:
      'An array of ledger entries was returned. WEAK: shape check only — it does not ' +
      'confirm the entries match the ledger.',
    observation: responseObservation(),
    conditions: [{ field: 'isArray', operator: 'eq', expected: true }],
    onFailure: 'fail',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
  contract: { metadata: WEAK },
});

// ---------------------------------------------------------------------------
// World / cognition
// ---------------------------------------------------------------------------

export const WORLD_QUERY = defineContract({
  identity: {
    id: 'world.query',
    version: '1.0.0',
    owner: OWNER,
    provider: 'world_model',
    description: 'Answer a question from the world model',
  },
  effects: [dbEffect('world_state', 'read')],
  reversibility: {
    kind: 'self_healing',
    windowMs: Number.POSITIVE_INFINITY,
    caveat: 'A read changes nothing.',
  },
  cost: { estimatedMs: 1_500, timeoutMs: 15_000 },
  verification: {
    description:
      'A non-empty answer string came back. The response IS the outcome here — there ' +
      'is nowhere else to look — so api_response is the honest source, not a shortcut.',
    observation: responseObservation(),
    conditions: [
      { field: 'type', operator: 'eq', expected: 'string' },
      { field: 'length', operator: 'gt', expected: 0 },
    ],
    onFailure: 'replan',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
});

export const COGNITIVE_OBSERVE = defineContract({
  identity: {
    id: 'cognitive.observe',
    version: '1.0.0',
    owner: OWNER,
    provider: 'cognitive_core',
    description: 'Take a perception snapshot of the system',
  },
  effects: [
    {
      verb: 'read',
      resourceKind: 'any',
      resourcePatterns: ['*'],
      worstCaseScope: 'none',
      crossesTrustBoundary: false,
    },
  ],
  reversibility: {
    kind: 'self_healing',
    windowMs: Number.POSITIVE_INFINITY,
    caveat: 'Observation changes nothing.',
  },
  cost: { estimatedMs: 2_000, timeoutMs: 20_000 },
  verification: {
    description: 'A perception result came back.',
    observation: responseObservation(),
    conditions: [{ field: 'present', operator: 'eq', expected: true }],
    onFailure: 'retry',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
});

// ---------------------------------------------------------------------------

/**
 * Every capability whose verification has been migrated out of the planner.
 * A capability absent from this list still falls through to the legacy chain
 * in `CognitiveCore.verifyAction()` — see `contractCoverage()` for the count.
 */
export const COGNITIVE_CONTRACTS: CapabilityContract[] = [
  GOAL_ADVANCE,
  GOAL_COMPLETE,
  TOOL_CREATE_TASK,
  TOOL_CANCEL_TASK,
  RECOVERY_GOVERNED,
  RECOVERY_AUTO,
  COMM_SEND_MESSAGE,
  REVENUE_RUN_CYCLE,
  REVENUE_IDENTIFY_PROSPECT,
  REVENUE_UPDATE_PROSPECT_STATUS,
  REVENUE_CREATE_OPPORTUNITY,
  REVENUE_ACTIVATE_SERVICE,
  REVENUE_GET_VERIFIED_REVENUE,
  WORLD_QUERY,
  COGNITIVE_OBSERVE,
];

/** Capability ids whose verification only inspects the executor's own output. */
export function weaklyVerified(): string[] {
  return COGNITIVE_CONTRACTS.filter(
    (c) => c.verification.observation.source === 'api_response',
  ).map((c) => c.identity.id);
}
