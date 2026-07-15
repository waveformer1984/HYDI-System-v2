'use strict';

/**
 * Canonical event type registry.
 * All inter-service messages use a type from this list.
 * Add new types here — never as bare string literals in service code.
 */
const EventTypes = Object.freeze({
  // ── Task lifecycle ────────────────────────────────────────────────────────
  TASK_CREATED:    'task.created',
  TASK_ASSIGNED:   'task.assigned',
  TASK_STARTED:    'task.started',
  TASK_COMPLETED:  'task.completed',
  TASK_FAILED:     'task.failed',
  TASK_CANCELLED:  'task.cancelled',
  TASK_RETRIED:    'task.retried',

  // ── AI inference ──────────────────────────────────────────────────────────
  INFERENCE_REQUESTED:  'inference.requested',
  INFERENCE_STREAMING:  'inference.streaming',
  INFERENCE_COMPLETED:  'inference.completed',
  INFERENCE_FAILED:     'inference.failed',
  INFERENCE_CANCELLED:  'inference.cancelled',

  // ── Memory ────────────────────────────────────────────────────────────────
  MEMORY_STORED:           'memory.stored',
  MEMORY_RETRIEVED:        'memory.retrieved',
  MEMORY_EVICTED:          'memory.evicted',
  REFLECTION_STARTED:      'memory.reflection.started',
  REFLECTION_COMPLETED:    'memory.reflection.completed',
  DRIFT_UPDATED:           'memory.drift.updated',

  // ── System health ─────────────────────────────────────────────────────────
  SERVICE_HEALTHY:         'system.service.healthy',
  SERVICE_DEGRADED:        'system.service.degraded',
  SERVICE_FAILED:          'system.service.failed',
  SERVICE_RECOVERED:       'system.service.recovered',
  RESOURCE_WARNING:        'system.resource.warning',    // RAM >85% or temp >80°C
  RESOURCE_CRITICAL:       'system.resource.critical',   // RAM >92% or temp >88°C
  RESOURCE_EMERGENCY:      'system.resource.emergency',  // temp >92°C — freeze workers
  WORKER_POOL_THROTTLED:   'system.worker.throttled',
  WORKER_POOL_RESUMED:     'system.worker.resumed',

  // ── Revenue ───────────────────────────────────────────────────────────────
  REVENUE_EVENT:           'revenue.event',
  CONVERSION_TRACKED:      'revenue.conversion.tracked',
  GOAL_REACHED:            'revenue.goal.reached',
});

/**
 * Originating service identifiers.
 * Use in HYDIEvent.source — never raw strings.
 */
const Sources = Object.freeze({
  HEIDI_CORE:   'heidi-core',
  PROCESSOR:    'hydi-processor',
  PROTOFORGE:   'hydi-protoforge',
  URSULA:       'hydi-ursula',
  MEMORY:       'heidi-memory',
  ORCHESTRATOR: 'hydi-orchestrator',
  MONITOR:      'hydi-monitor',
});

/**
 * Build a fully-formed HYDIEvent.
 *
 * @param {string} type         - One of EventTypes
 * @param {string} source       - One of Sources
 * @param {Object} payload      - Event data
 * @param {Object} [options]
 * @param {string} [options.correlationId]
 * @param {string} [options.userId]
 * @returns {import('./HYDIEvent').HYDIEvent}
 */
function createEvent(type, source, payload, options = {}) {
  return {
    id:            `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type,
    source,
    timestamp:     Date.now(),
    correlationId: options.correlationId || null,
    userId:        options.userId        || null,
    payload,
    version:       '1.0',
  };
}

/**
 * Validate a raw object against the HYDIEvent contract.
 * @param {Object} event
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object') return { valid: false, errors: ['event must be an object'] };
  if (!event.id)                   errors.push('missing id');
  if (!event.type)                 errors.push('missing type');
  if (!event.source)               errors.push('missing source');
  if (typeof event.timestamp !== 'number') errors.push('timestamp must be a number');
  if (event.payload === undefined) errors.push('missing payload');
  if (event.version !== '1.0')     errors.push(`unknown schema version: ${event.version}`);
  return { valid: errors.length === 0, errors };
}

/**
 * Assert valid or throw — use at service ingress points.
 * @param {Object} event
 */
function assertEvent(event) {
  const { valid, errors } = validateEvent(event);
  if (!valid) throw new Error(`Invalid HYDIEvent: ${errors.join(', ')}`);
}

module.exports = { EventTypes, Sources, createEvent, validateEvent, assertEvent };
