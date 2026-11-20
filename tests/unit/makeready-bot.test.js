'use strict';

const nodemailer = require('nodemailer');
const {
  loadConfig,
  computeEstimate,
  redactAccessCodes,
  buildRowsWithConfig,
  newRequestId,
  chatReply,
  sendOwnerEmail,
} = require('../../lib/makeready-bot');
const { rateLimit, getClientIp, __reset } = require('../../lib/rate-limit');
const { isPublicPath, classify } = require('../../lib/security/ingressGate');

jest.mock('../../api/local-model', () => ({
  LocalModelClient: jest.fn().mockImplementation(() => ({
    isAvailable: jest.fn().mockResolvedValue(false),
    generate: jest.fn(),
    model: 'test-model',
  })),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test' }),
  })),
}));

const mockInsert = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: mockInsert,
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          gte: jest.fn(async () => ({ count: 0, error: null })),
        })),
      })),
    })),
  })),
}));

describe('makeready-bot', () => {
  let config;
  let handler;

  beforeAll(() => {
    config = loadConfig('demo-makeready-co');
    handler = require('../../pages/api/makeready-bot/[[...slug]].js').default;
  });

  beforeEach(() => {
    __reset();
    mockInsert.mockReset();
    mockInsert.mockReturnValue({
      select: jest.fn().mockResolvedValue({ data: [{ id: 'uuid-1' }], error: null }),
    });
    nodemailer.createTransport.mockClear();
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PORT;
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

  test('submit build rejects unknown phase before rows', () => {
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
        phases: ['nonexistent_phase'],
        sq_ft: 1800,
        stories: 1,
        target_date: '2026-12-01',
        closing_date: '2026-12-15',
        notes: 'standard',
      },
    ];
    const built = buildRowsWithConfig('demo-makeready-co', config, shared, lots, requestId);
    expect(built.ok).toBe(false);
    expect(built.error).toBe('missing_rate');
    expect(built.lot_index).toBe(0);
    expect(built.phase).toBe('nonexistent_phase');
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

  test.each([
    ['lockbox code is 4455'],
    ['gate code is 1234'],
    ['door code = 9999'],
    ['keypad is 2020'],
    ['access code: 77'],
    ['lockbox 4455'],
  ])('access-code redaction: %s', (input) => {
    const { text, redacted } = redactAccessCodes(input);
    expect(redacted).toBe(true);
    expect(text).not.toMatch(/\d/);
    expect(text).toContain('[REDACTED]');
  });

  test('benign text passes redaction unchanged', () => {
    const samples = ['Park by the front door', 'The gate is on the north side'];
    for (const sample of samples) {
      const { text, redacted } = redactAccessCodes(sample);
      expect(redacted).toBe(false);
      expect(text).toBe(sample);
    }
  });

  test('LLM-down returns form mode fallback', async () => {
    const out = await chatReply(config, 'Do you offer final clean?');
    expect(out.mode).toBe('form');
    expect(out.reply).toMatch(/form mode/i);
  });

  test('widget static path is public; legacy /public/makeready-bot prefix removed', () => {
    expect(isPublicPath('/makeready-bot/widget.js', {})).toBe(true);
    const gateSource = require('fs').readFileSync(
      require('path').join(process.cwd(), 'lib/security/ingressGate.js'),
      'utf8',
    );
    expect(gateSource).not.toMatch(/\/public\/makeready-bot\//);
    expect(gateSource).toMatch(/\/makeready-bot\//);
  });

  test('health ignores path slug segment; defaults company config', async () => {
    const res = {
      statusCode: null,
      body: null,
      setHeader: jest.fn(),
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    await handler(
      {
        method: 'GET',
        headers: { host: '8.8.8.8:3000', 'x-forwarded-for': '8.8.8.8' },
        query: { slug: ['health'] },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.slug).toBe('demo-makeready-co');
    expect(res.body.config_loaded).toBe(true);
  });

  test('public health omits requests_last_7d', async () => {
    const res = {
      statusCode: null,
      body: null,
      setHeader: jest.fn(),
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    await handler(
      {
        method: 'GET',
        headers: { host: 'tunnel.example', 'x-forwarded-for': '173.174.244.48' },
        query: { slug: ['health'], company: 'demo-makeready-co' },
      },
      res,
    );
    expect(classify({ host: 'tunnel.example', 'x-forwarded-for': '173.174.244.48' }).internal).toBe(false);
    expect(res.body).not.toHaveProperty('requests_last_7d');
  });

  test('submit with unknown phase returns 400 and does not insert', async () => {
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    const res = {
      statusCode: null,
      body: null,
      setHeader: jest.fn(),
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    await handler(
      {
        method: 'POST',
        headers: {},
        query: { slug: ['submit'] },
        body: {
          company: 'demo-makeready-co',
          builder_company: 'Demo Builder',
          contact_name: 'Pat',
          phone: '2105550100',
          email: 'pat@example.com',
          community: 'Demo Hills',
          lot_number: '1',
          address: '1 Demo Ln',
          phases: ['nonexistent_phase'],
          sq_ft: 1800,
          stories: 1,
          target_date: '2026-12-01',
          closing_date: '2026-12-15',
        },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('missing_rate');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('sendOwnerEmail uses SMTP_PASS and secure on port 465', async () => {
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret-pass';
    process.env.SMTP_PORT = '465';
    const cfg = { ...config, owner_email: 'owner@example.com' };
    const rows = [
      {
        lot_number: '1',
        address: '1 Demo Ln',
        estimate_cents: 42500,
        builder_company: 'Demo',
        contact_name: 'Pat',
        phone: '2105550100',
        email: 'pat@example.com',
      },
    ];
    const out = await sendOwnerEmail(cfg, 'mr_test', rows);
    expect(out.sent).toBe(true);
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, port: 465, auth: { user: 'user@example.com', pass: 'secret-pass' } }),
    );
  });

  test('sendOwnerEmail falls back to SMTP_PASSWORD and secure false on 587', async () => {
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASSWORD = 'legacy-pass';
    process.env.SMTP_PORT = '587';
    const cfg = { ...config, owner_email: 'owner@example.com' };
  const rows = [
    {
      lot_number: '1',
      address: '1 Demo Ln',
      estimate_cents: 10000,
      builder_company: 'Demo',
      contact_name: 'Pat',
      phone: '2105550100',
      email: 'pat@example.com',
    },
  ];
    await sendOwnerEmail(cfg, 'mr_test', rows);
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: false,
        port: 587,
        auth: expect.objectContaining({ pass: 'legacy-pass' }),
      }),
    );
  });

  test('null estimate in owner email renders price confirmed by owner', async () => {
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret-pass';
    const cfg = { ...config, owner_email: 'owner@example.com' };
    const rows = [
      {
        lot_number: '9',
        address: '9 Demo Ln',
        estimate_cents: null,
        builder_company: 'Demo',
        contact_name: 'Pat',
        phone: '2105550100',
        email: 'pat@example.com',
      },
    ];
    await sendOwnerEmail(cfg, 'mr_test', rows);
    const transport = nodemailer.createTransport.mock.results.at(-1).value;
    const mailArg = transport.sendMail.mock.calls[0][0];
    expect(mailArg.text).toMatch(/price confirmed by owner/);
    expect(mailArg.text).not.toMatch(/0\.00 USD/);
  });

  test('rate limit last-hop ignores spoofed first X-Forwarded-For hop', () => {
    const req = {
      headers: { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    expect(getClientIp(req, { clientIpFrom: 'last-hop' })).toBe('9.9.9.9');
    let blocked = false;
    const res = {
      status: (code) => ({
        json: () => {
          if (code === 429) blocked = true;
        },
      }),
      setHeader: () => {},
    };
    const opts = { name: 'makeready-bot:submit-last-hop', windowMs: 60_000, max: 2, clientIpFrom: 'last-hop' };
    for (let i = 0; i < 3; i += 1) {
      req.headers['x-forwarded-for'] = `spoof-${i}, 9.9.9.9`;
      rateLimit(req, res, opts);
    }
    rateLimit(req, res, opts);
    expect(blocked).toBe(true);
  });

  test('rate limit blocks excess requests', () => {
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