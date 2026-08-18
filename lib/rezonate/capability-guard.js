'use strict';

/**
 * Capability guard for Heidi → Rezonate task types.
 *
 * Maps REZONATE_* task types to the canonical Rezonate capability contract
 * (protoforge-applications/rezonate/capability-contract.json) and to Heidi's
 * own verified routing matrix. The guard never invents capabilities: if a task
 * is not listed here, it is reported as unsupported.
 *
 * States follow the contract state_enum:
 *   VERIFIED  — canonical implementation exists and is tested; Heidi routes to it.
 *   FUNCTIONAL — canonical implementation exists; not yet verified through Heidi.
 *   PLANNED   — declared in a roadmap but no implementation in the canonical repository.
 *   SCAFFOLD  — declared task type or stub only; no canonical execution path.
 *   MISSING   — not exposed by the canonical ResonateRepository at all.
 *   FORBIDDEN — disallowed by policy (financial, legal, destructive, external, etc.).
 */

const fs = require('fs');
const path = require('path');

const CONTRACT_PATH = path.join(
  __dirname,
  '..',
  '..',
  'protoforge-applications',
  'rezonate',
  'capability-contract.json'
);

let _contract = null;

function loadContract() {
  if (!_contract) {
    _contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
  }
  return _contract;
}

// Task-type → canonical capability contract id (where one exists) and Heidi state.
// The canonical repository is the source of truth for whether an operation exists.
const TASK_CAPABILITY_MAP = Object.freeze({
  REZONATE_CREATE_PROJECT: { contractId: 'studio_project_management', heidiState: 'VERIFIED' },
  REZONATE_LIST_PROJECTS: { contractId: 'studio_project_management', heidiState: 'VERIFIED' },
  REZONATE_GET_PROJECT: { contractId: 'studio_project_management', heidiState: 'VERIFIED' },
  REZONATE_CREATE_TRACK: { contractId: 'studio_project_management', heidiState: 'VERIFIED' },
  REZONATE_LIST_TRACKS: { contractId: 'studio_project_management', heidiState: 'VERIFIED' },

  // Canonical repository methods exist, but Heidi does not yet route/verify them.
  REZONATE_GET_JOB: { contractId: 'studio_project_management', heidiState: 'FUNCTIONAL' },
  REZONATE_CREATE_JOB: { contractId: 'studio_project_management', heidiState: 'FUNCTIONAL' },
  REZONATE_START_JOB: { contractId: 'studio_project_management', heidiState: 'FUNCTIONAL' },

  // No matching canonical repository method.
  REZONATE_GET_TRACK: { contractId: null, heidiState: 'MISSING' },
  REZONATE_UPDATE_PROJECT: { contractId: null, heidiState: 'MISSING' },
  REZONATE_UPDATE_TRACK: { contractId: null, heidiState: 'MISSING' },

  // Declared in the routing matrix but not wired; no canonical implementation found.
  REZONATE_EXPORT_PROJECT: { contractId: 'daw_export', heidiState: 'SCAFFOLD' },

  // Policy-forbidden domains.
  REZONATE_NFT: { contractId: null, heidiState: 'FORBIDDEN' },
  REZONATE_MARKETPLACE: { contractId: null, heidiState: 'FORBIDDEN' },
  REZONATE_MASTERING: { contractId: 'studio_mixing', heidiState: 'FORBIDDEN' },
  REZONATE_BLOCKCHAIN: { contractId: null, heidiState: 'FORBIDDEN' },
  REZONATE_DELETE: { contractId: null, heidiState: 'FORBIDDEN' },
});

// Plain-text phrases that imply an unsupported/forbidden capability.
// These are checked by the intent normalizer *before* execution.
const CAPABILITY_PHRASES = Object.freeze({
  'get track': { taskType: 'REZONATE_GET_TRACK', heidiState: 'MISSING', reason: 'GET_TRACK is not implemented in the canonical Rezonate repository' },
  'update project': { taskType: 'REZONATE_UPDATE_PROJECT', heidiState: 'MISSING', reason: 'UPDATE_PROJECT is not implemented in the canonical Rezonate repository' },
  'update track': { taskType: 'REZONATE_UPDATE_TRACK', heidiState: 'MISSING', reason: 'UPDATE_TRACK is not implemented in the canonical Rezonate repository' },
  'export project': { taskType: 'REZONATE_EXPORT_PROJECT', heidiState: 'SCAFFOLD', reason: 'EXPORT_PROJECT is not wired through Heidi' },
  'nft': { taskType: 'REZONATE_NFT', heidiState: 'FORBIDDEN', reason: 'NFT operations are not permitted' },
  'marketplace': { taskType: 'REZONATE_MARKETPLACE', heidiState: 'FORBIDDEN', reason: 'Marketplace operations are not permitted' },
  'mastering': { taskType: 'REZONATE_MASTERING', heidiState: 'FORBIDDEN', reason: 'Mastering operations are not permitted' },
  'blockchain': { taskType: 'REZONATE_BLOCKCHAIN', heidiState: 'FORBIDDEN', reason: 'Blockchain operations are not permitted' },
  'delete project': { taskType: 'REZONATE_DELETE', heidiState: 'FORBIDDEN', reason: 'Delete operations are not permitted' },
  'delete track': { taskType: 'REZONATE_DELETE', heidiState: 'FORBIDDEN', reason: 'Delete operations are not permitted' },
});

function getContractState(contractId) {
  const contract = loadContract();
  const entry = contract.capabilities.find((c) => c.id === contractId);
  if (!entry) return 'UNKNOWN';
  return entry.state;
}

function getTaskCapabilityState(taskType) {
  const mapped = TASK_CAPABILITY_MAP[taskType];
  if (!mapped) {
    return { taskType, state: 'UNKNOWN', heidiState: 'UNKNOWN', contractId: null, reason: 'Task type is not recognized' };
  }

  const contractState = mapped.contractId ? getContractState(mapped.contractId) : 'UNKNOWN';

  if (mapped.heidiState === 'FORBIDDEN') {
    return { taskType, state: contractState, heidiState: 'FORBIDDEN', contractId: mapped.contractId, reason: 'Operation is disallowed by policy' };
  }

  if (mapped.heidiState === 'MISSING') {
    return { taskType, state: contractState, heidiState: 'MISSING', contractId: mapped.contractId, reason: 'Operation does not exist in the canonical Rezonate repository' };
  }

  if (mapped.heidiState === 'PLANNED' || mapped.heidiState === 'SCAFFOLD') {
    return { taskType, state: contractState, heidiState: mapped.heidiState, contractId: mapped.contractId, reason: 'Operation is not yet operational through Heidi' };
  }

  return { taskType, state: contractState, heidiState: mapped.heidiState, contractId: mapped.contractId, reason: null };
}

function classifyUserMessage(message) {
  const lower = message.toLowerCase();
  for (const [phrase, meta] of Object.entries(CAPABILITY_PHRASES)) {
    if (lower.includes(phrase)) {
      return {
        ok: false,
        taskType: meta.taskType,
        reason: meta.reason,
        state: meta.heidiState,
      };
    }
  }
  return null;
}

module.exports = {
  getTaskCapabilityState,
  classifyUserMessage,
  TASK_CAPABILITY_MAP,
  CAPABILITY_PHRASES,
};
