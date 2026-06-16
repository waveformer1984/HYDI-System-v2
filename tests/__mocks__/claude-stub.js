'use strict';

// Lightweight stub for lib/claude.ts used in unit tests.
// Tests that need specific behaviour should override these with jest.fn().

module.exports = {
  callAgent: jest.fn().mockResolvedValue('Claude response'),
  isClaudeAvailable: jest.fn().mockResolvedValue(true),
};
