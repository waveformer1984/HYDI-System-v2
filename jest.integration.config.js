'use strict';

/**
 * Separate config for Supabase integration tests.
 * These tests require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set.
 *
 * Run with:
 *   npx jest --config jest.integration.config.js
 *
 * Or in CI:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx jest --config jest.integration.config.js
 */

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/hdi-adversarial.test.js',
    '**/tests/hdi-everything-wrong.test.js',
  ],
  testTimeout: 60000,
  forceExit: true,
  verbose: true,
};
