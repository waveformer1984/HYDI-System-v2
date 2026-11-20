'use strict';

const path = require('path');
const {
  loadConfig,
  computeEstimate,
  redactAccessCodes,
  buildRowsWithConfig,
  newRequestId,
  chatReply,
} = require('../../lib/makeready-bot');
const { rateLimit } = require('../../lib/rate-limit');

jest.mock('../../api/local-model', () => ({
  LocalModelClient: jest.fn().mockImplementation(() => ({
    isAvailable: jest.fn().mockResolvedValue(false),
    generate: jest.fn(),
    model: 'test-model',
  })),
}));

describe('makeready-bot', () => {
  let config;

  beforeAll(() => {
    config = loadConfig('demo-makeready-co');
  });

  test('config-only context loads services from file', () => {
    expect(config.services).toContain('Final clean (pre-closing detail)');
    expect(config.price_points.phases.final_clean.per_sqft).toBe(0.32);
  });

  test('estimate math uses per-sq-ft, story multiplier, minimum', () => {
    const est = computeEstimate(config, {
      phases: ['final_clean'],
      sq_ft: 1000,
      stories: 2,
    });
    expect(est.ok).toBe(true);
    expect(est.estimate_usd).toBeGreaterThanOrEqual(425);
    expect(est.label).toBe('estimate, final quote confirmed by owner');
  });

  test('missing rate does not invent pricing', () => {
    const est = computeEstimate(config, {
      phases: ['nonexistent_phase'],
      sq_ft: 2000,
      stories: 1,
    });
    expect(est.ok).toBe(false);
    expect(est.error).toBe('missing_rate');
  });

  test('multi-lot submission shares request_id', () => {
    const requestId = newRequestId();
    const shared = {
      builder_company: 'Demo Builder',
      contact_name: 'Pat',
      phone: '2105550100',
      email: 'pat@example.com',
      community: 'Demo Hills',
      po_number: null,
    };
    const lots = [
      {
        lot_number: '12',
        address: '100 Demo Ln',
        phases: ['rough_clean'],
        sq_ft: 1800,
        stories: 1,
        target_date: '2026-12-01',
        closing_date: '2026-12-15',
        notes: 'standard',
      },
      {
        lot_number: '13',
        address: '102 Demo Ln',
        phases: ['final_clean'],
        sq_ft: 1900,
        stories: 2,
        target_date: '2026-12-02',
        closing_date: '2026-12-16',
        notes: 'standard',
      },
    ];
    const built = buildRowsWithConfig('demo-makeready-co', config, shared, lots, requestId);
    expect(built.ok).toBe(true);
    expect(built.rows).toHaveLength(2);
    expect(built.rows[0].request_id).toBe(requestId);
    expect(built.rows[1].request_id).toBe(requestId);
  });

  test('access-code redaction before save', () => {
    const { text, redacted } = redactAccessCodes('Please clean; lockbox code 4455 on the gate');
    expect(redacted).toBe(true);
    expect(text).not.toMatch(/4455/);
    expect(text).toContain('[REDACTED]');
  });

  test('LLM-down returns form mode fallback', async () => {
    const out = await chatReply(config, 'Do you offer final clean?');
    expect(out.mode).toBe('form');
    expect(out.reply).toMatch(/form mode/i);
  });

  test('rate limit blocks excess requests', () => {
    require('../../lib/rate-limit').__reset();
    const req = { headers: {}, socket: { remoteAddress: '127.0.0.2' } };
    let blocked = false;
    const res = {
      status: (code) => ({
        json: () => {
          if (code === 429) blocked = true;
        },
      }),
      setHeader: () => {},
    };
    for (let i = 0; i < 12; i += 1) {
      const ok = rateLimit(req, res, { name: 'makeready-bot:submit-test', windowMs: 60_000, max: 10 });
      if (!ok) blocked = true;
    }
    expect(blocked).toBe(true);
  });
});