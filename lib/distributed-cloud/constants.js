'use strict';

const TASK_TYPES = Object.freeze({
  LIGHTWEIGHT: 'lightweight',
  FREELANCE_DISCOVER: 'freelance.discover',
  FREELANCE_PROPOSAL_DRAFT: 'freelance.proposal_draft',
  MODEL_INFERENCE: 'model.inference',
  CODE_TASK: 'code.task',
});

const TASK_STATES = Object.freeze({
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  RUNNING: 'running',
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const TRUST_LEVELS = Object.freeze({
  CLOUD_LIGHT: 'cloud_light',
  HOME_TRUSTED: 'home_trusted',
  MOBILE_OPERATOR: 'mobile_operator',
});

const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_HEARTBEAT_STALE_MS = 120_000;

module.exports = {
  TASK_TYPES,
  TASK_STATES,
  TRUST_LEVELS,
  DEFAULT_LEASE_MS,
  DEFAULT_HEARTBEAT_STALE_MS,
};