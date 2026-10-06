'use strict';

/**
 * Human Actions — HYDI's canonical durable primitive for boundaries only
 * a human can cross.
 *
 *   detect  → durable action (dedupe by blockerKey)
 *   link    → goal/mission enters WAITING_ON_HUMAN (escalated + linkage)
 *   verify  → independent check of the external world — never trust
 *             "I did it"
 *   resolve → verified actions release linked goals back to runnable
 *
 * This module is the write/verify side; lib/heidi/HumanActionQueue.ts
 * folds the same records into the normalized read model used by the COO
 * briefing, /api/coo, and the workspace.
 */

const { HumanActionService, OPEN_STATUSES, TERMINAL_STATUSES } = require('./service');
const { detectKnownBlockers, syncHumanActions, RULES, REZONATE_TESTNET_SPEC } = require('./detector');
const { runVerifier, VERIFIERS, envNamePresent, envValue } = require('./verifiers');
const { attachBlockerToGoal, resumeSatisfiedGoals, scanEscalatedGoals } = require('./mission-link');
const { tryHumanActionAnswer, looksLikeHumanActionQuestion } = require('./heidi-answer');
const { STATUSES } = require('./store');

module.exports = {
  HumanActionService,
  OPEN_STATUSES,
  TERMINAL_STATUSES,
  STATUSES,
  detectKnownBlockers,
  syncHumanActions,
  RULES,
  REZONATE_TESTNET_SPEC,
  runVerifier,
  VERIFIERS,
  envNamePresent,
  envValue,
  attachBlockerToGoal,
  resumeSatisfiedGoals,
  scanEscalatedGoals,
  tryHumanActionAnswer,
  looksLikeHumanActionQuestion,
};
