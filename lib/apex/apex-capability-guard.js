'use strict';

/**
 * Capability guard for Heidi → Apex Archive events.
 *
 * Apex Archive is a one-way source of observability events. HYDI/Heidi does not
 * operate the archive directly. This guard prevents Heidi from claiming or
 * performing capabilities that do not exist.
 */

const TASK_CAPABILITY_MAP = Object.freeze({
  APEX_PROJECT_CREATED: { heidiState: 'VERIFIED', reason: null },
  APEX_EPISODE_CREATED: { heidiState: 'VERIFIED', reason: null },
  GET_APEX_PROJECT_STATUS: { heidiState: 'VERIFIED', reason: null },
  GET_APEX_HEALTH: { heidiState: 'VERIFIED', reason: null },
  GET_APEX_REZONATE_STATUS: { heidiState: 'VERIFIED', reason: null },
  APEX_EVENT_RECORDED: { heidiState: 'VERIFIED', reason: null },
  APEX_EPISODE_APPROVED: { heidiState: 'VERIFIED', reason: null },
  APEX_EPISODE_PUBLISHED: { heidiState: 'VERIFIED', reason: null },
  APEX_EPISODE_FAILED: { heidiState: 'VERIFIED', reason: null },
  APEX_EPISODE_ARCHIVED: { heidiState: 'VERIFIED', reason: null },
  APEX_UPLOAD: { heidiState: 'SCAFFOLD', reason: 'YouTube upload() is a scaffold; no real API call is implemented' },
  APEX_PUBLISH: { heidiState: 'FORBIDDEN', reason: 'Autonomous publishing is forbidden; only J may approve publishing' },
});

function getTaskCapabilityState(taskType) {
  const mapped = TASK_CAPABILITY_MAP[taskType];
  if (!mapped) {
    return { taskType, heidiState: 'MISSING', reason: 'Task type is not recognized' };
  }
  return { taskType, heidiState: mapped.heidiState, reason: mapped.reason };
}

module.exports = { getTaskCapabilityState, TASK_CAPABILITY_MAP };
