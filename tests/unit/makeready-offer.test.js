'use strict';

const fs = require('fs');
const path = require('path');
const {
  offerPricingLabels,
  validateDemoLead,
  loadPlatformOffer,
  getOfferPageProps,
  DEMO_SLUG,
} = require('../../lib/makeready-bot/offer');
const { isPublicPath } = require('../../lib/security/ingressGate');
const { rateLimit, getClientIp, __reset } = require('../../lib/rate-limit');

const mockLeadInsert = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'makeready_leads') {
        return { insert: mockLeadInsert };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

describe('makeready offer (step 3)', () => {
  let handler;
  const offerPath = path.join(process.cwd(), 'config/makeready/platform-offer.json');
  let offerBackup;

  beforeAll(() => {
    handler = require('../../pages/api/makeready-bot/[[...slug]].js').default;
  });

  beforeEach(() => {
    __reset();
    mockLeadInsert.mockReset();
    mockLeadInsert.mockResolvedValue({ error: null });
    offerBackup = fs.existsSync(offerPath) ? fs.readFileSync(offerPath, 'utf8') : null;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    if (offerBackup != null) fs.writeFileSync(offerPath, offerBackup);
    else if (fs.existsSync(offerPath)) fs.unlinkSync(offerPath);
  });

  test('missing platform prices → Contact for pricing only', () => {
    fs.writeFileSync(
      offerPath,
      JSON.stringify({ setup_cents: null, monthly_cents: null, stripe_payment_link: '' }),
    );
    const labels = offerPricingLabels(loadPlatformOffer());
    expect(labels.showContactOnly).toBe(true);
    expect(labels.setup).toBeNull();
    expect(labels.monthly).toBeNull();
    expect(labels.showBuyButton).toBe(false);
  });

  test('getOfferPageProps loads fictional demo config', () => {
    const props = getOfferPageProps();
    expect(props.demo.slug).toBe(DEMO_SLUG);
    expect(props.demo.demo).toBe(true);
    expect(props.pricing.showContactOnly).toBe(true);
  });

  test('offer page source renders demo banner and widget', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'pages/makeready-bot.tsx'), 'utf8');
    expect(src).toMatch(/DEMO/);
    expect(src).toMatch(/Contact for pricing/);
    expect(src).toMatch(/makeready-bot\/widget\.js/);
    expect(src).not.toMatch(/testimonial|★★★|5-star/i);
  });

  test('ingress allowlists /makeready-bot page exactly', () => {
    expect(isPublicPath('/makeready-bot', {})).toBe(true);
    expect(isPublicPath('/api/makeready-bot/lead', {})).toBe(true);
  });

  test('lead API saves row when persistence available', async () => {
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
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
        query: { slug: ['lead'] },
        body: {
          contact_name: 'Alex Owner',
          email: 'alex@example.com',
          company_name: 'Example Cleaning',
        },
      },
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(mockLeadInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_name: 'Alex Owner',
        email: 'alex@example.com',
        source: 'makeready-bot-offer',
      }),
    );
  });

  test('lead route rate limits by last-hop IP', () => {
    const req = {
      headers: { 'x-forwarded-for': 'spoof, 10.0.0.99' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    expect(getClientIp(req, { clientIpFrom: 'last-hop' })).toBe('10.0.0.99');
    let blocked = false;
    const res = {
      status: (code) => ({
        json: () => {
          if (code === 429) blocked = true;
        },
      }),
      setHeader: () => {},
    };
    const opts = { name: 'makeready-bot:lead', windowMs: 60_000, max: 2, clientIpFrom: 'last-hop' };
    for (let i = 0; i < 4; i += 1) {
      req.headers['x-forwarded-for'] = `other-${i}, 10.0.0.99`;
      rateLimit(req, res, opts);
    }
    expect(blocked).toBe(true);
  });

  test('validateDemoLead rejects invalid email', () => {
    expect(validateDemoLead({ contact_name: 'A', email: 'not-an-email' }).ok).toBe(false);
  });
});