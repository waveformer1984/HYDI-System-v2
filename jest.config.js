'use strict';

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
  ],

  // Use scoped Babel config so Next.js can use SWC for builds
  transform: {
    '^.+\\.(t|j)sx?$': ['babel-jest', { configFile: './babel.jest.config.js' }],
  },

  setupFilesAfterEnv: ['./jest.setup.js'],

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
