'use strict';

jest.mock('https');

const https = require('https');
const SelfHealingService = require('../../src/healing/SelfHealingService');

describe('SelfHealingService', () => {
  let service;
  const savedApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    service = new SelfHealingService();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (service) service.destroy();
    // Restore original key state
    if (savedApiKey !== undefined) process.env.ANTHROPIC_API_KEY = savedApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
    jest.clearAllMocks();
  });

  // ── diagnoseAndCorrect ──────────────────────────────────────────────────

  describe('diagnoseAndCorrect', () => {
    test('returns null when ANTHROPIC_API_KEY is not set', async () => {
      const result = await service.diagnoseAndCorrect({ type: 'crash', message: 'oom' });
      expect(result).toBeNull();
    });

    test('returns null when Claude API returns a non-200 status', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
      const mockRes = { statusCode: 429, resume: jest.fn(), on: jest.fn() };
      https.request.mockImplementation((_opts, cb) => { cb(mockRes); return mockReq; });

      const result = await service.diagnoseAndCorrect({ type: 'crash' });
      expect(result).toBeNull();
    });

    test('returns parsed body on 200', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
      const payload = JSON.stringify({ content: [{ text: 'restart the service' }] });
      const mockRes = {
        statusCode: 200,
        on: jest.fn((event, cb) => {
          if (event === 'data') cb(payload);
          if (event === 'end') cb();
        }),
      };
      https.request.mockImplementation((_opts, cb) => { cb(mockRes); return mockReq; });

      const result = await service.diagnoseAndCorrect({ type: 'crash' });
      expect(result).not.toBeNull();
      expect(result.content[0].text).toBe('restart the service');
    });
  });

  // ── healFromCrash ────────────────────────────────────────────────────────

  describe('healFromCrash', () => {
    test('returns null when ANTHROPIC_API_KEY is not set', async () => {
      const result = await service.healFromCrash(new Error('out of memory'));
      expect(result).toBeNull();
    });

    test('returns null when Claude API returns a non-200 status', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
      const mockRes = { statusCode: 500, resume: jest.fn(), on: jest.fn() };
      https.request.mockImplementation((_opts, cb) => { cb(mockRes); return mockReq; });

      const result = await service.healFromCrash(new Error('crashed'));
      expect(result).toBeNull();
    });
  });

  // ── destroy ──────────────────────────────────────────────────────────────

  describe('destroy', () => {
    test('sets _destroyed flag', () => {
      service.destroy();
      expect(service._destroyed).toBe(true);
    });

    test('returns null from diagnoseAndCorrect after destroy', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      service.destroy();
      const result = await service.diagnoseAndCorrect({ type: 'crash' });
      expect(result).toBeNull();
    });
  });
});
