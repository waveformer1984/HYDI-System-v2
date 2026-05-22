'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',

  // Unit tests live in tests/unit/ — the top-level tests/ files are
  // Supabase integration tests that require live credentials and run separately.
  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/unit/**/*.spec.js',
    '**/__tests__/**/*.test.js',
  ],

  // Ignore the Supabase integration tests in the default jest run.
  // Run them explicitly: npx jest --config jest.integration.config.js
  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/hdi-adversarial.test.js',
    '/tests/hdi-everything-wrong.test.js',
  ],

  // Runs before each test file, after the test framework is installed.
  // Sets BROKER_TRANSPORT=memory so no Redis connection is attempted.
  setupFilesAfterFramework: ['./jest.setup.js'],

  // Belt-and-suspenders: force Jest to exit even if a timer or
  // open handle survives after a test suite completes.
  forceExit: true,

  // Surface open handles in CI so we can track down leaks.
  detectOpenHandles: false,

  testTimeout: 15000,

  // Clean module registry between test files to prevent
  // singleton broker state bleeding across suites.
  clearMocks: true,
  resetModules: false,

  verbose: true,
};
