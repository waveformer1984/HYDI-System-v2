'use strict';

// Phase 12 — TIER 2: local-service tests.
//
// These 14 suites were measured (not guessed) to require a live local Postgres
// and/or the local Supabase REST stack: they pass in a normal run and fail when
// every external endpoint is redirected to a closed port.
//
// They are NOT weaker tests and nothing about them was changed. They were
// simply mislabelled as hermetic unit tests, which made `npm test` -- and
// therefore the pre-push gate -- silently require Docker to be running.
//
// Membership comes from tests/TEST_TIERS.json, the single source of truth that
// jest.config.js reads to exclude these same files.
const base = require('./jest.config');
const TIER2 = require('./tests/TEST_TIERS.json').tiers.tier2_local_service.members;

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  testMatch: TIER2.map((f) => `<rootDir>/${f}`),
  // Inherit nothing from the tier-1 exclusions; these files ARE the target.
  testPathIgnorePatterns: ['/node_modules/'],
  // Explicitly WITHOUT tests/tier1-hermetic-guard.js: Tier 2 is defined by
  // needing real local services, so blocking them here would be incoherent.
  setupFilesAfterEnv: ['./jest.setup.js'],
  // Several open real connections. Serialised so they do not contend for the
  // same rows, and given room for connection setup.
  maxWorkers: 1,
  testTimeout: 60000,
};
