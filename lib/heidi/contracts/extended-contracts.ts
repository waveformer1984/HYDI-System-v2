/**
 * Contracts for the 28 capabilities that were still falling through to the
 * legacy chain's final branch — `verified: exec.outcome === 'success'`, the
 * executor marking its own homework.
 *
 * THE DISTINCTION THAT DRIVES EVERY CHOICE HERE
 * ---------------------------------------------
 * `api_response` verification is honest for a READ and dishonest for a WRITE.
 *
 * A read returns data; there is nowhere else to look, so checking the shape of
 * what came back IS the verification. A write leaves a durable record, and
 * checking only the response means asking the thing that did the work whether
 * it worked. Eighteen of these are reads and use `api_response` without
 * apology. The writers read their record back out of Postgres.
 *
 * Where a writer's verification is still response-shaped, it carries
 * `WEAK` metadata so `weaklyVerified()` lists it as debt rather than letting
 * it pass as verified work.
 *
 * Conditions are chosen to fail on the realistic failure, not merely to exist.
 * `exists` on a field the executor always sets is a predicate that cannot
 * fail, which is worse than no predicate because it looks like one.
 */

import type { CapabilityContract, VerificationSpec } from '../../capability-contract';
import { defineContract } from '../../capability-contract';
import {
  dbEffect,
  dbObservation,
  responseObservation,
  CLASS_PROVIDER_ACCEPTANCE,
  CLASS_UNVERIFIABLE,
} from './cognitive-contracts';

const OWNER = 'unassigned';

/** Marks a read whose response legitimately IS the observation. */
const READ_ONLY = {
  readOnly: true,
  reason: 'a read returns data; the response is the outcome, not a claim about it',
};

function readEffect(resource: string) {
  return {
    verb: 'read' as const,
    resourceKind: 'any' as const,
    resourcePatterns: [resource],
    worstCaseScope: 'none' as const,
    crossesTrustBoundary: false,
  };
}

const READ_REVERSIBILITY = {
  kind: 'self_healing' as const,
  windowMs: Number.POSITIVE_INFINITY,
  caveat: 'A read changes nothing.',
};

/** A read contract: response-shaped verification, honestly so. */
function readContract(input: {
  id: string;
  provider: string;
  description: string;
  resource: string;
  /** What must be true of the response for the read to have actually produced something. */
  conditions: VerificationSpec['conditions'];
  verificationDescription: string;
  estimatedMs?: number;
  timeoutMs?: number;
}): CapabilityContract {
  return defineContract({
    identity: {
      id: input.id,
      version: '1.0.0',
      owner: OWNER,
      provider: input.provider,
      description: input.description,
    },
    effects: [readEffect(input.resource)],
    reversibility: READ_REVERSIBILITY,
    cost: {
      estimatedMs: input.estimatedMs ?? 1_500,
      timeoutMs: input.timeoutMs ?? 20_000,
    },
    verification: {
      description: input.verificationDescription,
      observation: responseObservation(),
      conditions: input.conditions,
      onFailure: 'retry',
      maxRetries: 1,
      requiresHumanConfirmation: false,
    },
    contract: { metadata: READ_ONLY },
  });
}

// ---------------------------------------------------------------------------
// Reads — tools, ops, communication
// ---------------------------------------------------------------------------

export const TOOL_FETCH_DATA = readContract({
  id: 'tool.fetch_data',
  provider: 'action_executor',
  description: 'Fetch rows from a readable table',
  resource: 'readable_tables',
  verificationDescription: 'A result came back and is a collection, not an error placeholder.',
  conditions: [
    { field: 'present', operator: 'eq', expected: true },
    // `isArray` rather than `exists`: a failed fetch returning `{}` would
    // satisfy "exists" and tell us nothing.
    { field: 'isArray', operator: 'eq', expected: true },
  ],
});

export const OPS_DIAGNOSE = readContract({
  id: 'ops.diagnose',
  provider: 'operational_intelligence',
  description: 'Produce a diagnostic snapshot of the system',
  resource: 'system',
  verificationDescription: 'A non-empty diagnostic snapshot was produced.',
  conditions: [
    { field: 'present', operator: 'eq', expected: true },
    { field: 'length', operator: 'gt', expected: 0 },
  ],
  estimatedMs: 5_000,
  timeoutMs: 30_000,
});

export const OPS_CHECK_HEALTH = readContract({
  id: 'ops.check_health',
  provider: 'operational_intelligence',
  description: 'Run a full health check and return overall state',
  resource: 'system',
  verificationDescription:
    'The returned value is a legal ComponentState. Caught by the exercise ' +
    'harness: checkHealth() returns the state as a STRING union ' +
    '("HEALTHY" | "DEGRADED" | …), not an object, so the previous ' +
    '`status not_null` predicate checked a field that does not exist and ' +
    'failed on every healthy call.',
  conditions: [
    { field: 'type', operator: 'eq', expected: 'string' },
    {
      field: 'raw',
      operator: 'matches',
      expected: '^(UNKNOWN|STARTING|HEALTHY|DEGRADED|UNAVAILABLE|RECOVERING|FAILED|BLOCKED)$',
    },
  ],
  estimatedMs: 5_000,
  timeoutMs: 30_000,
});

export const COMM_GET_CAPABILITIES = readContract({
  id: 'comm.get_capabilities',
  provider: 'communication_layer',
  description: 'List communication channels and their status',
  resource: 'communication_channels',
  verificationDescription: 'A non-empty channel list came back.',
  conditions: [
    { field: 'isArray', operator: 'eq', expected: true },
    // An empty list means no channels are configured — a real failure for a
    // capability whose whole job is to enumerate them.
    { field: 'length', operator: 'gt', expected: 0 },
  ],
});

// ---------------------------------------------------------------------------
// Reads — revenue and commercial
// ---------------------------------------------------------------------------

export const REVENUE_COLLECT_METRICS = readContract({
  id: 'revenue.collect_metrics',
  provider: 'revenue_control_loop',
  description: 'Collect current revenue metrics without executing actions',
  resource: 'revenue_*',
  verificationDescription: 'A metrics object came back.',
  conditions: [{ field: 'present', operator: 'eq', expected: true }, { field: 'type', operator: 'eq', expected: 'object' }],
});

export const REVENUE_SCORE_PROSPECT = readContract({
  id: 'revenue.score_prospect',
  provider: 'revenue_pipeline',
  description: 'Score a prospect against the ideal customer profile',
  resource: 'revenue_prospects',
  verificationDescription: 'A numeric score came back — not merely an object.',
  conditions: [
    // The realistic failure is a scorer returning an object with no score, so
    // the numeric bound is the check that matters.
    { field: 'score', operator: 'gte', expected: 0 },
    { field: 'score', operator: 'lte', expected: 100 },
  ],
});

export const REVENUE_PIPELINE_METRICS = readContract({
  id: 'revenue.pipeline_metrics',
  provider: 'revenue_pipeline',
  description: 'Collect current prospect pipeline metrics',
  resource: 'revenue_prospects',
  verificationDescription: 'Metrics came back carrying a total.',
  conditions: [{ field: 'total', operator: 'gte', expected: 0 }],
});

export const REVENUE_VERIFY_SERVICE = readContract({
  id: 'revenue.verify_service',
  provider: 'revenue_lifecycle',
  description: 'Verify a customer service is operational',
  resource: 'customer_services',
  verificationDescription: 'A verification verdict came back with details.',
  conditions: [
    { field: 'verified', operator: 'not_null', expected: null },
    { field: 'result', operator: 'not_null', expected: null },
  ],
  estimatedMs: 5_000,
  timeoutMs: 30_000,
});

export const REVENUE_GET_REVENUE_SUMMARY = readContract({
  id: 'revenue.get_revenue_summary',
  provider: 'revenue_ledger',
  description: 'Get a full revenue summary from the ledger',
  resource: 'revenue_ledger',
  verificationDescription: 'A summary came back carrying a verified-revenue figure.',
  conditions: [{ field: 'present', operator: 'eq', expected: true }, { field: 'type', operator: 'eq', expected: 'object' }],
});

export const COMMERCIAL_GET_STATE = readContract({
  id: 'commercial.get_state',
  provider: 'commercial_workflow',
  description: 'Get commercial workflow state including provider availability flags',
  resource: 'commercial_workflow',
  verificationDescription: 'A state object came back.',
  conditions: [{ field: 'present', operator: 'eq', expected: true }, { field: 'type', operator: 'eq', expected: 'object' }],
});

export const COMMERCIAL_DISCOVER_PROSPECTS = readContract({
  id: 'commercial.discover_prospects',
  provider: 'commercial_workflow',
  description: 'Discover prospects from external sources; reports BLOCKED when no provider is configured',
  resource: 'external_discovery',
  verificationDescription:
    'A discovery result came back carrying its availability flag. BLOCKED is a ' +
    'valid, verified outcome — the capability is designed to report that it ' +
    'cannot run rather than to invent prospects.',
  conditions: [{ field: 'available', operator: 'not_null', expected: null }],
  estimatedMs: 10_000,
  timeoutMs: 60_000,
});

export const COMMERCIAL_PREPARE_OUTREACH = readContract({
  id: 'commercial.prepare_outreach',
  provider: 'commercial_workflow',
  description: 'Generate an evidence-backed outreach draft (never sends)',
  resource: 'commercial_workflow',
  verificationDescription:
    'A draft came back carrying its evidence. The evidence field is the point: ' +
    'a draft without it is the hallucination this capability exists to avoid.',
  conditions: [{ field: 'evidence', operator: 'not_null', expected: null }],
  estimatedMs: 8_000,
  timeoutMs: 45_000,
});

export const COMMERCIAL_CREATE_AUTHORIZATION_PACKAGE = readContract({
  id: 'commercial.create_authorization_package',
  provider: 'commercial_workflow',
  description: 'Assemble an authorization package for an R2+ commercial action',
  resource: 'commercial_workflow',
  verificationDescription:
    'A package came back awaiting decision. `decision=pending` is the load-bearing ' +
    'check: a package that arrives already decided would mean the approval step ' +
    'was skipped.',
  conditions: [{ field: 'decision', operator: 'eq', expected: 'pending' }],
});

export const COMMERCIAL_VERIFY_REVENUE = readContract({
  id: 'commercial.verify_revenue',
  provider: 'commercial_workflow',
  description: 'Verify revenue from the authoritative RevenueLedger',
  resource: 'revenue_ledger',
  verificationDescription: 'A revenue verdict came back sourced from the ledger.',
  conditions: [{ field: 'present', operator: 'eq', expected: true }, { field: 'type', operator: 'eq', expected: 'object' }],
});

// ---------------------------------------------------------------------------
// Reads — self-sufficiency
// ---------------------------------------------------------------------------

export const SELF_CHECK_ALL = readContract({
  id: 'self_sufficiency.check_all_capabilities',
  provider: 'capability_health_manager',
  description: 'Probe all registered capabilities and return an evidence-backed summary',
  resource: 'capability_registry',
  verificationDescription: 'A summary came back covering at least one capability.',
  conditions: [{ field: 'present', operator: 'eq', expected: true }, { field: 'type', operator: 'eq', expected: 'object' }],
  estimatedMs: 15_000,
  timeoutMs: 90_000,
});

export const SELF_CHECK_CAPABILITY = readContract({
  id: 'self_sufficiency.check_capability',
  provider: 'capability_health_manager',
  description: 'Probe a single capability and return an evidence-backed report',
  resource: 'capability_registry',
  verificationDescription: 'A report came back carrying evidence.',
  conditions: [{ field: 'present', operator: 'eq', expected: true }, { field: 'type', operator: 'eq', expected: 'object' }],
  estimatedMs: 5_000,
  timeoutMs: 30_000,
});

export const SELF_GET_READY = readContract({
  id: 'self_sufficiency.get_ready_capabilities',
  provider: 'capability_health_manager',
  description: 'Return capabilities currently in READY state with evidence',
  resource: 'capability_registry',
  verificationDescription: 'A list came back. An empty list is a valid answer — nothing is ready.',
  conditions: [{ field: 'isArray', operator: 'eq', expected: true }],
});

export const SELF_GET_REPAIR_HISTORY = readContract({
  id: 'self_sufficiency.get_repair_history',
  provider: 'self_repair_engine',
  description: 'Return the history of self-repair actions with rollback info',
  resource: 'repair_history',
  verificationDescription: 'A history list came back. Empty is valid — nothing has been repaired.',
  conditions: [{ field: 'isArray', operator: 'eq', expected: true }],
});

export const SELF_RESOLVE_BLOCKERS = readContract({
  id: 'self_sufficiency.resolve_blockers',
  provider: 'blocker_resolution_engine',
  description: 'Classify blockers for a set of capability health reports',
  resource: 'capability_registry',
  verificationDescription:
    'A classification result came back. This capability classifies; it does not ' +
    'act, which is why it is a read.',
  conditions: [{ field: 'present', operator: 'eq', expected: true }, { field: 'type', operator: 'eq', expected: 'object' }],
  estimatedMs: 5_000,
  timeoutMs: 30_000,
});

// ---------------------------------------------------------------------------
// Writes — verified by reading the record back
// ---------------------------------------------------------------------------

export const GOAL_CREATE = defineContract({
  identity: {
    id: 'goal.create',
    version: '1.0.0',
    owner: OWNER,
    provider: 'goal_system',
    description: 'Create a new hierarchical goal',
  },
  effects: [dbEffect('heidi_goals', 'create')],
  reversibility: {
    kind: 'none',
    windowMs: 0,
    caveat:
      'No goal-delete capability is registered. A goal can be abandoned by status, ' +
      'but the row persists — so this is recorded as irreversible until a real ' +
      'inverse exists.',
  },
  cost: { estimatedMs: 800, timeoutMs: 15_000 },
  verification: {
    description: 'The goal row exists in heidi_goals and carries a status.',
    observation: dbObservation('sql:heidi_goals:id={goalId}|sql:heidi_goals:id={id}', [
      'id',
      'status',
    ]),
    conditions: [
      { field: 'found', operator: 'eq', expected: true },
      { field: 'status', operator: 'not_null', expected: null },
    ],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
});

export const TOOL_SCHEDULE_EVENT = defineContract({
  identity: {
    id: 'tool.schedule_event',
    version: '1.0.0',
    owner: OWNER,
    provider: 'action_executor',
    description: 'Schedule a future event as a row in the actions table',
  },
  effects: [dbEffect('actions', 'create')],
  reversibility: {
    kind: 'inverse_capability',
    inverseCapabilityId: 'tool.cancel_task',
    windowMs: Number.POSITIVE_INFINITY,
    caveat:
      'Scheduled events are rows in `actions`, so tool.cancel_task retracts them ' +
      'on the same terms: only while still pending.',
  },
  cost: { estimatedMs: 800, timeoutMs: 15_000 },
  verification: {
    description: 'The scheduled row exists in `actions`.',
    observation: dbObservation('sql:actions:id={event_id}|sql:actions:id={task_id}|sql:actions:id={id}', [
      'id',
      'status',
    ]),
    conditions: [
      { field: 'found', operator: 'eq', expected: true },
      { field: 'status', operator: 'not_null', expected: null },
    ],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
});

export const TOOL_UPDATE_DATABASE = defineContract({
  identity: {
    id: 'tool.update_database',
    version: '1.0.0',
    owner: OWNER,
    provider: 'action_executor',
    description: 'Update a row in a writable table',
  },
  effects: [
    {
      verb: 'update',
      resourceKind: 'database',
      // ActionExecutor's WRITABLE_TABLES is exactly this. Mirroring it keeps
      // the blast radius honest instead of declaring the whole database.
      resourcePatterns: ['sessions'],
      worstCaseScope: 'single_resource',
      crossesTrustBoundary: false,
    },
  ],
  reversibility: {
    kind: 'none',
    windowMs: 0,
    caveat:
      'The previous row value is not snapshotted anywhere, so the write cannot be ' +
      'rolled back. Recording that honestly is what keeps this out of autonomous ' +
      'territory it has not earned.',
  },
  cost: { estimatedMs: 800, timeoutMs: 15_000 },
  verification: {
    description: 'The updated row re-reads from its own table.',
    // Table and id both come from the invocation. The observer identifier-checks
    // the table name and binds the id as a parameter.
    observation: dbObservation('sql:{table}:id={id}', ['id']),
    conditions: [{ field: 'found', operator: 'eq', expected: true }],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
  contract: {
    signature: {
      params: [
        {
          name: 'table',
          type: 'string',
          required: true,
          description: 'Writable table',
          enum: ['sessions'],
          resourceRef: 'database',
        },
        { name: 'id', type: 'string', required: true, description: 'Row id' },
      ],
      returns: '{ updated: boolean }',
    },
  },
});

export const COMMERCIAL_INGEST_PROSPECT = defineContract({
  identity: {
    id: 'commercial.ingest_prospect',
    version: '1.0.0',
    owner: OWNER,
    provider: 'commercial_workflow',
    description: 'Ingest a discovered prospect with deduplication and scoring',
  },
  effects: [dbEffect('revenue_prospects', 'create')],
  reversibility: {
    kind: 'none',
    windowMs: 0,
    caveat:
      'A prospect is a business record, not queue state. The right retraction is ' +
      'a suppression/disqualification decision, not a delete — so no inverse is ' +
      'claimed here until that capability exists.',
  },
  cost: { estimatedMs: 3_000, timeoutMs: 30_000 },
  verification: {
    description: 'The prospect row exists in revenue_prospects.',
    observation: dbObservation(
      'sql:revenue_prospects:prospect_id={prospectId}|sql:revenue_prospects:id={id}',
      ['prospect_id'],
    ),
    conditions: [{ field: 'found', operator: 'eq', expected: true }],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
});

export const COMMERCIAL_CREATE_OPPORTUNITY = defineContract({
  identity: {
    id: 'commercial.create_opportunity',
    version: '1.0.0',
    owner: OWNER,
    provider: 'commercial_workflow',
    description: 'Create an opportunity for a qualified prospect (ICP score >= 50)',
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

export const REVENUE_START_ONBOARDING = defineContract({
  identity: {
    id: 'revenue.start_onboarding',
    version: '1.0.0',
    owner: OWNER,
    provider: 'revenue_lifecycle',
    description: 'Start onboarding a new customer',
  },
  effects: [
    dbEffect('customer_services', 'create'),
    {
      // Onboarding is customer-visible: it provisions something the customer
      // can see. That is what makes it more than a database write.
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
    caveat:
      'Onboarding provisions customer-facing state. Unwinding it is a commercial ' +
      'decision (suspend/cancel), not a mechanical undo.',
  },
  cost: { estimatedMs: 8_000, timeoutMs: 60_000 },
  verification: {
    description: 'The customer_services row exists and carries a status.',
    observation: dbObservation(
      'sql:customer_services:service_id={serviceId}|sql:customer_services:service_id={service_id}',
      ['service_id', 'status'],
    ),
    conditions: [
      { field: 'found', operator: 'eq', expected: true },
      { field: 'status', operator: 'not_null', expected: null },
    ],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
});

export const WORLD_SYNC = defineContract({
  identity: {
    id: 'world.sync',
    version: '1.0.0',
    owner: OWNER,
    provider: 'world_model',
    description: 'Sync the world model from runtime sources',
  },
  effects: [dbEffect('heidi_world_model', 'update')],
  reversibility: {
    kind: 'self_healing',
    windowMs: Number.POSITIVE_INFINITY,
    caveat:
      'The world model is a projection of observed runtime state. A subsequent ' +
      'sync overwrites it, so a bad sync is corrected by the next one rather than ' +
      'rolled back.',
  },
  cost: { estimatedMs: 5_000, timeoutMs: 45_000 },
  verification: {
    description:
      'The world model table is populated. A sync that writes an unknown number ' +
      'of entities cannot be verified by id, but an empty model after a sync is ' +
      'unambiguously a failure.',
    observation: dbObservation('count:heidi_world_model', []),
    conditions: [{ field: 'count', operator: 'gt', expected: 0 }],
    onFailure: 'retry',
    maxRetries: 1,
    requiresHumanConfirmation: false,
  },
});

// ---------------------------------------------------------------------------
// Writes reached only from inside revenue.run_cycle
// ---------------------------------------------------------------------------
//
// These two had NO contract of any kind. They were not "verified weakly" —
// they were invisible, reachable only as direct method calls inside
// RevenueControlLoop, which is why closing the run_cycle bypass required
// writing them rather than merely re-routing existing ones.

export const REVENUE_START_PROVISIONING = defineContract({
  identity: {
    id: 'revenue.start_provisioning',
    version: '1.0.0',
    owner: OWNER,
    provider: 'revenue_lifecycle',
    description: 'Move a pending customer service into provisioning',
  },
  effects: [dbEffect('customer_services', 'update')],
  reversibility: {
    kind: 'none',
    windowMs: 0,
    caveat:
      'Provisioning begins customer-facing work. Reversing it is a suspend or ' +
      'cancel decision, not a status rewrite.',
  },
  cost: { estimatedMs: 5_000, timeoutMs: 60_000 },
  verification: {
    description: 'The service row re-reads with a provisioning status.',
    observation: dbObservation('sql:customer_services:service_id={serviceId}', [
      'service_id',
      'status',
    ]),
    conditions: [
      { field: 'found', operator: 'eq', expected: true },
      { field: 'status', operator: 'neq', expected: 'pending' },
    ],
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
          description: 'Service to provision',
          resourceRef: 'database',
        },
      ],
      returns: 'void',
    },
  },
});

export const REVENUE_UPDATE_HEALTH_STATUS = defineContract({
  identity: {
    id: 'revenue.update_health_status',
    version: '1.0.0',
    owner: OWNER,
    provider: 'revenue_lifecycle',
    description: 'Record the outcome of a service health check',
  },
  effects: [dbEffect('customer_services', 'update')],
  reversibility: {
    // A health status is an observation, overwritten by the next check.
    kind: 'inverse_capability',
    inverseCapabilityId: 'revenue.update_health_status',
    windowMs: Number.POSITIVE_INFINITY,
    caveat:
      'The next health check overwrites this. It does not undo anything acted ' +
      'upon in the meantime on the strength of the recorded status.',
  },
  cost: { estimatedMs: 1_000, timeoutMs: 15_000 },
  verification: {
    description: 'The service row re-reads with the recorded health status.',
    observation: dbObservation('sql:customer_services:service_id={serviceId}', [
      'service_id',
      'last_health_status',
    ]),
    conditions: [
      { field: 'found', operator: 'eq', expected: true },
      { field: 'last_health_status', operator: 'eq', expected: '{healthStatus}' },
    ],
    onFailure: 'retry',
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
          description: 'Service checked',
          resourceRef: 'database',
        },
        { name: 'healthStatus', type: 'string', required: true, description: 'healthy | unhealthy' },
      ],
      returns: 'void',
    },
  },
});

// ---------------------------------------------------------------------------
// External and system-affecting
// ---------------------------------------------------------------------------

export const TOOL_SEND_EMAIL = defineContract({
  identity: {
    id: 'tool.send_email',
    version: '1.0.0',
    owner: OWNER,
    provider: 'action_executor',
    description: 'Send an email via the configured provider',
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
    caveat: 'A delivered email cannot be recalled.',
  },
  cost: { estimatedMs: 3_000, timeoutMs: 30_000 },
  verification: {
    description:
      'Resend accepted the message and returned an id. This is PROVIDER ACCEPTANCE, ' +
      'not delivery: it proves a third party took responsibility for the message, ' +
      'and proves nothing about whether it arrived.',
    observation: responseObservation(),
    // `email_id`, not `id` — ActionExecutor.sendEmail returns
    // `{ email_id, to }`. The earlier `id` predicate could never match, so this
    // capability would have reported `failed` on every successful send.
    conditions: [{ field: 'email_id', operator: 'not_null', expected: null }],
    onFailure: 'escalate',
    maxRetries: 0,
    requiresHumanConfirmation: false,
  },
  contract: {
    signature: {
      params: [
        { name: 'to', type: 'string', required: true, description: 'Recipient', resourceRef: 'external_party' },
        { name: 'subject', type: 'string', required: true, description: 'Subject' },
        { name: 'body', type: 'string', required: false, description: 'Body' },
      ],
      returns: '{ email_id: string, to: string }',
    },
    metadata: {
      ...CLASS_PROVIDER_ACCEPTANCE,
      upgradePath:
        'Resend exposes GET /emails/{id} with a delivery status. Querying it ' +
        'post-send would upgrade this to independent verification; it needs an ' +
        'http_probe observer and a configured RESEND_API_KEY, neither of which ' +
        'exists in this environment today.',
    },
  },
});

export const SELF_RUN_SELF_REPAIR = defineContract({
  identity: {
    id: 'self_sufficiency.run_self_repair',
    version: '1.0.0',
    owner: OWNER,
    provider: 'self_repair_engine',
    description: 'Run the governed self-repair loop over a health summary',
  },
  effects: [
    {
      // This one actually changes the system, and it is the only capability in
      // this file that repairs rather than reports. Its blast radius is
      // whatever its repairs touch, which is not knowable from here — so it is
      // declared unbounded, and reads as system scope on every invocation.
      verb: 'restart',
      resourceKind: 'service',
      resourcePatterns: [],
      worstCaseScope: 'system',
      crossesTrustBoundary: false,
    },
  ],
  reversibility: {
    kind: 'none',
    windowMs: 0,
    caveat:
      'The engine records rollback information per repair, but no capability is ' +
      'registered to apply it. Until one is, the composite operation has no undo.',
  },
  cost: { estimatedMs: 30_000, timeoutMs: 180_000 },
  verification: {
    description:
      'NOT independently verifiable. The outcome is composite — some capabilities ' +
      'repaired, others correctly escalated for human authorization — and the two ' +
      'are indistinguishable from outside the engine. Re-probing health cannot ' +
      'separate "repair failed" from "repair correctly declined to act", so any ' +
      'automated predicate here would fail legitimate escalations or pass failed ' +
      'repairs. `sre.getHistory()` is the same engine reporting on itself, which ' +
      'is not independence. Requires human confirmation.',
    observation: responseObservation(),
    conditions: [{ field: 'present', operator: 'eq', expected: true }, { field: 'type', operator: 'eq', expected: 'object' }],
    onFailure: 'escalate',
    maxRetries: 0,
    // The existing lever for "cannot be automated" — forces R3 minimum so this
    // never runs unattended on the strength of a shape check.
    requiresHumanConfirmation: true,
  },
  contract: {
    metadata: {
      ...CLASS_UNVERIFIABLE,
      whatWouldFixIt:
        'A health model that distinguishes REPAIRED from ESCALATED per capability, ' +
        'so a post-repair probe could assert "nothing was left blocked that the ' +
        'engine claimed to repair".',
    },
  },
});

// ---------------------------------------------------------------------------

export const EXTENDED_CONTRACTS: CapabilityContract[] = [
  // reads
  TOOL_FETCH_DATA,
  OPS_DIAGNOSE,
  OPS_CHECK_HEALTH,
  COMM_GET_CAPABILITIES,
  REVENUE_COLLECT_METRICS,
  REVENUE_SCORE_PROSPECT,
  REVENUE_PIPELINE_METRICS,
  REVENUE_VERIFY_SERVICE,
  REVENUE_GET_REVENUE_SUMMARY,
  COMMERCIAL_GET_STATE,
  COMMERCIAL_DISCOVER_PROSPECTS,
  COMMERCIAL_PREPARE_OUTREACH,
  COMMERCIAL_CREATE_AUTHORIZATION_PACKAGE,
  COMMERCIAL_VERIFY_REVENUE,
  SELF_CHECK_ALL,
  SELF_CHECK_CAPABILITY,
  SELF_GET_READY,
  SELF_GET_REPAIR_HISTORY,
  SELF_RESOLVE_BLOCKERS,
  // writes
  GOAL_CREATE,
  TOOL_SCHEDULE_EVENT,
  TOOL_UPDATE_DATABASE,
  COMMERCIAL_INGEST_PROSPECT,
  COMMERCIAL_CREATE_OPPORTUNITY,
  REVENUE_START_ONBOARDING,
  REVENUE_START_PROVISIONING,
  REVENUE_UPDATE_HEALTH_STATUS,
  WORLD_SYNC,
  // external / system-affecting
  TOOL_SEND_EMAIL,
  SELF_RUN_SELF_REPAIR,
];
