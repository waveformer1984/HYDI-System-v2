'use strict';

// Phase 12: this config is TIER 1 -- the hermetic fast gate.
//
// Tier 2 members are excluded here and run by jest.tier2.config.js instead.
// The membership list lives in exactly one place, tests/TEST_TIERS.json, and is
// read by both configs so the two cannot drift apart.
//
// Tier 2 was determined by EXECUTION, not by reading source: the full suite was
// run once normally and once with every external endpoint redirected to a
// closed port. The 14 suites that pass normally and fail with endpoints closed
// are the ones that genuinely need a service. An earlier static estimate of 69
// was discarded after spot checks showed it was mostly false positives.
const TIER2 = require('./tests/TEST_TIERS.json').tiers.tier2_local_service.members;

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',

  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/unit/**/*.test.ts',
    '**/tests/unit/**/*.spec.js',
    '**/__tests__/**/*.test.js',
    '**/tests/migrations/**/*.test.js',
  ],

  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/hdi-adversarial.test.js',
    '/tests/hdi-everything-wrong.test.js',
    // Tier 2 -- reachable via `npm run test:local`, never silently dropped.
    ...TIER2.map((f) => f.replace(/^tests\//, '/tests/').replace(/\./g, '\\.') + '$'),
  ],

  // Use scoped Babel config so Next.js can use SWC for builds
  transform: {
    '^.+\\.(t|j)sx?$': ['babel-jest', { configFile: './babel.jest.config.js' }],
  },

  // The guard is Tier 1 only. jest.tier2.config.js overrides this back to
  // jest.setup.js alone, because Tier 2 legitimately reaches local services.
  setupFilesAfterEnv: ['./jest.setup.js', './tests/tier1-hermetic-guard.js'],

  // Redirect missing external modules to lightweight stubs
  moduleNameMapper: {
    '^.*heidi-core.*ollama-client.*$': '<rootDir>/tests/__mocks__/ollama-client-stub.js',
    '^uuid$': '<rootDir>/tests/__mocks__/uuid-stub.js',
    // TS-ESM convention: source imports "./x.js" that actually lives at "./x.ts"
    // (e.g. api/chat/route.js -> lib/claude.ts). Strip the extension and let
    // Jest's resolver pick .js or .ts, matching Next.js behavior.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  // forceExit: true — EventBus (pao-system/core/event.bus.ts) creates a
  // setInterval(100ms) that prevents Jest from exiting cleanly. forceExit
  // lets Jest terminate after all tests pass without hanging on that timer.
  // The integration test command already uses --forceExit for the same reason.
  //
  // detectOpenHandles: true — kept ON so genuine handle leaks in new code
  // still get flagged. The EventBus setInterval is a known, pre-existing
  // offender that produces warnings but does not block exit because forceExit
  // handles it. If a future change introduces a new leak, this flag ensures
  // it shows up in the output rather than being silently swallowed.
  forceExit: true,
  detectOpenHandles: true,
  testTimeout: 15000,
  clearMocks: true,
  verbose: true,

  // Watchman is not installed in most CI/sandbox environments; when jest can't
  // find it, resolving that absence can stall startup on very large trees.
  // The node-based crawler is slower per-run but starts reliably everywhere.
  watchman: false,
};
