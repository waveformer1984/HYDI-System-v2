'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',

  testMatch: [
    '**/tests/unit/**/*.test.js',
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
    '^.+\\.js$': ['babel-jest', { configFile: './babel.jest.config.js' }],
  },

  setupFilesAfterEnv: ['./jest.setup.js'],

  // Redirect missing external modules to lightweight stubs
  moduleNameMapper: {
    '^.*heidi-core.*ollama-client.*$': '<rootDir>/tests/__mocks__/ollama-client-stub.js',
    '^uuid$': '<rootDir>/tests/__mocks__/uuid-stub.js',
  },

  forceExit: true,
  detectOpenHandles: false,
  testTimeout: 15000,
  clearMocks: true,
  verbose: true,
};
