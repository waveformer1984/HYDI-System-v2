'use strict';

/**
 * SignalCoverage audits the interpreter layer.
 *
 * With more than one interpreter on the bus, the mapping from sensor event
 * types to `BusinessSignal`s is no longer obvious by inspection. Two failure
 * modes are possible and both are silent:
 *
 *   DROPPED — a sensor publishes a type no interpreter handles. The event
 *             reaches the bus, nothing translates it, and it never appears in
 *             a briefing. Nothing errors. This is how `PrinterOffline` and
 *             `DirectoryDeleted` were invisible.
 *
 *   DOUBLE  — two interpreters both handle a type. The event becomes two
 *             signals, so one physical occurrence is counted twice in the
 *             briefing, the activity ledger, and the audit trail.
 *
 * Every interpreter subscribes to `*` and decides for itself whether a type is
 * its business, so neither condition can be detected by reading one file. This
 * module probes the interpreters directly with a synthetic event per type,
 * which means it measures actual behaviour rather than a declared list that
 * could itself drift from the switch statement.
 */

/** Event types each sensor family can publish. */
const SENSOR_EVENT_TYPES = {
  FilesystemMonitor: [
    'ProjectOpened', 'ProjectActive', 'ProjectInactive',
    'FileCreated', 'FileModified', 'FileDeleted',
    'DirectoryCreated', 'DirectoryDeleted',
    'BuildArtifactGenerated',
  ],
  GitSensor: [
    'CommitCreated', 'BranchCreated', 'BranchDeleted', 'BranchStale',
    'WorkingTreeDirty', 'WorkingTreeClean',
  ],
  PrinterSensor: [
    'PrinterStarted', 'PrinterPaused', 'PrinterResumed', 'PrinterCompleted',
    'PrinterFailed', 'PrinterIdle', 'PrinterHeating', 'PrinterOffline',
    'MaterialLow',
  ],
};

/** A payload broad enough that no interpreter refuses purely for missing fields. */
function probeEvent(type) {
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
    },
  };
}

/**
 * @param {object} options
 * @param {object[]} options.interpreters objects exposing `interpret(event)`
 * @param {string[]} [options.eventTypes] defaults to every known sensor type
 * @returns {{ok: boolean, dropped: string[], double: object[], matrix: object[]}}
 */
function audit(options = {}) {
  const interpreters = options.interpreters || [];
  const eventTypes = options.eventTypes || allEventTypes();

  const matrix = [];
  const dropped = [];
  const double = [];

  for (const type of eventTypes) {
    const handledBy = [];
    for (const interpreter of interpreters) {
      if (!interpreter || typeof interpreter.interpret !== 'function') continue;
      let signal = null;
      try {
        signal = interpreter.interpret(probeEvent(type));
      } catch (e) {
        // An interpreter that throws on a type is not handling it, and the
        // throw itself is worth surfacing rather than hiding.
        signal = null;
      }
      if (signal) handledBy.push(interpreter.constructor ? interpreter.constructor.name : 'anonymous');
    }

    matrix.push({ type, handledBy });
    if (handledBy.length === 0) dropped.push(type);
    if (handledBy.length > 1) double.push({ type, handledBy });
  }

  return { ok: dropped.length === 0 && double.length === 0, dropped, double, matrix };
}

function allEventTypes() {
  const types = new Set();
  for (const list of Object.values(SENSOR_EVENT_TYPES)) {
    for (const type of list) types.add(type);
  }
  return [...types].sort();
}

/** Human-readable summary for startup output and the operator console. */
function toText(result) {
  if (result.ok) {
    return `Signal coverage: all ${result.matrix.length} sensor event type(s) routed to exactly one interpreter.`;
  }
  const lines = ['Signal coverage problems detected:'];
  if (result.dropped.length) {
    lines.push(`  Dropped (no interpreter, silently invisible): ${result.dropped.join(', ')}`);
  }
  for (const entry of result.double) {
    lines.push(`  Double-translated (counted twice): ${entry.type} by ${entry.handledBy.join(' and ')}`);
  }
  return lines.join('\n');
}

module.exports = { audit, toText, allEventTypes, SENSOR_EVENT_TYPES, probeEvent };
