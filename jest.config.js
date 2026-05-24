'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',

  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/unit/**/*.spec.js',
    '**/__tests__/**/*.test.js',
  ],

  testPathIgnorePatterns: [
    '/node_modules/',
    '/tests/hdi-adversarial.test.js',
    '/tests/hdi-everything-wrong.test.js',
  ],

  // Correct key: setupFilesAfterEnv (not setupFilesAfterFramework)
  setupFilesAfterEnv: ['./jest.setup.js'],

  forceExit: true,
  detectOpenHandles: false,
  testTimeout: 15000,
  clearMocks: true,
  verbose: true,
};
