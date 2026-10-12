'use strict';

/**
 * Allowlisted typed ops actions for the mobile command gateway.
 * No arbitrary shell — each action maps to a fixed runner in action-runners.js.
 */

const ACTIONS = Object.freeze({
  'health.check': {
    permission: 'status:view',
    confirmRequired: false,
    summary: 'Probe heidi-web, protoforge-core, Ollama and Ursula (read-only).',
  },
  'service.status': {
    permission: 'status:view',
    confirmRequired: false,
    summary: 'Fetch the unified subsystem + worker snapshot (same data as GET /api/status/system).',
  },
  'git.inspect': {
    permission: 'ops:diagnostics',
    confirmRequired: false,
    summary: 'Read-only git identity: branch, HEAD, short status (no diffs with secrets).',
  },
  'tests.run': {
    permission: 'ops:run_tests',
    confirmRequired: true,
    summary: 'Run one allowlisted Jest suite on the HYDI host (bounded time and output).',
  },
});

/** Jest entrypoints phones may request — keys are suite names in the POST body. */
const TEST_SUITES = Object.freeze({
  'heidi-mobile': ['tests/unit/heidi-mobile-api.test.js', 'tests/unit/heidi-mobile-security.test.js'],
  'mobile-ops': ['tests/unit/mobile-ops-run-api.test.js', 'tests/unit/mobile-ops-action-runners.test.js'],
});

function isKnownAction(action) {
  return typeof action === 'string' && Object.prototype.hasOwnProperty.call(ACTIONS, action);
}

module.exports = { ACTIONS, TEST_SUITES, isKnownAction };
