'use strict';

/**
 * Maps heidi-core mission lifecycle states to execution-fabric task states.
 * Single reference for mobile, agents, and docs — does not execute or migrate data.
 */

const { publicStateAlias } = require('./constants');

/** @type {Record<string, string>} */
const MISSION_TO_FABRIC = Object.freeze({
  queued: 'QUEUED',
  planning: 'PLANNING',
  awaiting_approval: 'AWAITING_APPROVAL',
  running: 'RUNNING',
  verifying: 'VERIFYING',
  completed: 'COMPLETED',
  failed: 'FAILED',
  cancelled: 'CANCELLED',
  blocked: 'BLOCKED',
});

/** @type {Record<string, string>} */
const FABRIC_TO_MISSION = Object.freeze({
  QUEUED: 'queued',
  PLANNING: 'planning',
  AWAITING_APPROVAL: 'awaiting_approval',
  NEEDS_HUMAN: 'awaiting_approval',
  RUNNING: 'running',
  VERIFYING: 'verifying',
  PAUSED: 'blocked',
  RECOVERING: 'running',
  BLOCKED: 'blocked',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

function missionStateToFabric(missionStatus) {
  const key = String(missionStatus || '').toLowerCase();
  return MISSION_TO_FABRIC[key] || 'QUEUED';
}

function fabricStateToMission(fabricState) {
  return FABRIC_TO_MISSION[fabricState] || 'queued';
}

function describeUnifiedLifecycle(entity) {
  const fabric = entity.fabric_state || entity.state || missionStateToFabric(entity.status);
  return {
    fabric_state: fabric,
    fabric_public: publicStateAlias(fabric),
    mission_state: fabricStateToMission(fabric),
    source: entity.source || 'unknown',
  };
}

module.exports = {
  MISSION_TO_FABRIC,
  FABRIC_TO_MISSION,
  missionStateToFabric,
  fabricStateToMission,
  describeUnifiedLifecycle,
};