'use strict';

const BusinessEventRegistry = require('./BusinessEventRegistry');

/**
 * SignalCoverage audits the event contract using the BusinessEventRegistry as
 * the single source of truth.
 *
 * Every sensor registers the event types it emits.
 * Every interpreter declares the event types it handles.
 * This module compares the two, reporting:
 *   DROPPED  — a registered event has no interpreter and is not ignored
 *   DOUBLE   — a registered event has more than one interpreter
 *   ORPHAN   — an interpreter handles an event that no sensor registered
 *   UNKNOWN  — an unregistered event was emitted at runtime
 *
 * No regex over source code. No hand-maintained SENSOR_EVENT_TYPES inventory.
 */

/**
 * @param {object} options
 * @param {BusinessEventRegistry} [options.registry] canonical event registry
 * @returns {{ok: boolean, dropped: string[], double: object[], orphan: string[], unknown: string[], matrix: object[]}}
 */
function audit(options = {}) {
  const registry = options.registry || new BusinessEventRegistry();

  if (options.interpreters) {
    // Legacy probing path: callers that still pass interpreters can be migrated
    // by giving them a registry. This path treats the supplied eventTypes as the
    // sensor inventory, probes each interpreter, and validates the contract.
    for (const type of options.eventTypes || []) {
      registry.register(type, 'SignalCoverage');
    }
    for (const interpreter of options.interpreters) {
      if (!interpreter || typeof interpreter.interpret !== 'function') continue;
      const name = interpreter.constructor ? interpreter.constructor.name : 'anonymous';
      for (const type of options.eventTypes || []) {
        let signal = null;
        try {
          signal = interpreter.interpret(makeProbeEvent(type));
        } catch (e) {
          signal = null;
        }
        if (signal) {
          registry.declareHandled(type, name);
        }
      }
    }
  }

  const validation = registry.validate();
  const handlers = new Map();
  for (const [type, set] of registry.interpreters) {
    handlers.set(type, [...set]);
  }

  const matrix = registry.listEventTypes().map((type) => ({
    type,
    handledBy: handlers.get(type) || [],
    ignored: registry.isIgnored(type),
    emitted: registry.emitted.get(type) || 0,
    interpreted: registry.interpreted.get(type) || 0,
  }));

  const warnings = (validation.warnings || []).map((e) => e.type);

  return {
    ok: validation.ok,
    dropped: validation.errors
      .filter((e) => e.error === 'registered event has no interpreter and is not ignored')
      .map((e) => e.type),
    double: validation.errors
      .filter((e) => e.error === 'registered event has multiple interpreters')
      .map((e) => ({ type: e.type, handledBy: e.interpreters })),
    orphan: (validation.warnings || [])
      .filter((e) => e.error === 'interpreter handles an unregistered event')
      .map((e) => e.type),
    unknown: validation.errors
      .filter((e) => e.error === 'unknown event emitted at runtime')
      .map((e) => e.type),
    warnings,
    matrix,
  };
}

function makeProbeEvent(type) {
  return {
    id: `probe_${type}`,
    at: Date.now(),
    type,
    source: 'SignalCoverage',
    payload: {
      project: 'CoverageProbe',
      relPath: 'probe/file.txt',
      equipmentId: 'probe-equipment',
      equipmentName: 'Probe Machine',
      equipmentType: 'printer',
      branch: 'probe',
      author: 'probe',
      subject: 'probe',
      material: 'probe-material',
      amount: 100,
      currency: 'USD',
    },
  };
}

/** Human-readable summary for startup output and the operator console. */
function toText(result) {
  const warningLines = [];
  if (result.orphan && result.orphan.length) {
    warningLines.push(`  Orphan (interpreter handles unregistered event): ${result.orphan.join(', ')}`);
  }
  if (result.warnings && result.warnings.length) {
    for (const w of result.warnings) {
      if (result.orphan && result.orphan.includes(w)) continue;
      warningLines.push(`  ${w}`);
    }
  }

  if (result.ok && warningLines.length === 0) {
    return `Signal coverage: all ${result.matrix.length} registered event type(s) have a valid contract (exactly one interpreter or intentionally ignored).`;
  }

  if (result.ok) {
    return `Signal coverage: valid with warnings.\n${warningLines.join('\n')}`;
  }

  const lines = ['Signal coverage problems detected:'];
  if (result.dropped && result.dropped.length) {
    lines.push(`  Dropped (no interpreter, silently invisible): ${result.dropped.join(', ')}`);
  }
  if (result.double && result.double.length) {
    for (const entry of result.double) {
      lines.push(`  Double-translated (counted twice): ${entry.type} by ${entry.handledBy.join(' and ')}`);
    }
  }
  if (result.unknown && result.unknown.length) {
    lines.push(`  Unknown (emitted event not registered): ${result.unknown.join(', ')}`);
  }
  if (warningLines.length) lines.push('', 'Warnings:', ...warningLines);
  return lines.join('\n');
}

module.exports = { audit, toText };
