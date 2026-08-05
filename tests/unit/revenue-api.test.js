const { RevenueAPI } = require('../../api/revenue');

describe('RevenueAPI', () => {
  let api;
  let res;

  function mockResponse() {
    return {
      statusCode: null,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(data) {
        if (this.statusCode == null) this.statusCode = 200;
        this.payload = data;
        return this;
      },
      end() { return this; }
    };
  }

  function mockBuilder(defaultSingle = null, defaultList = []) {
    const b = {
      from() { return b; },
      select() { return b; },
      order() { return b; },
      limit() { return b; },
      eq() { return b; },
      gte() { return b; },
      insert(row) { return mockBuilder(row, defaultList); },
      single() {
        return Promise.resolve({
          data: defaultSingle || {
            id: 'quote_1',
            currency: 'usd',
            total: 100,
            project_type: 'prototyping',
            quantity: 2,
            complexity: 'medium'
          },
          error: null
        });
      },
      then(resolve) {
        return resolve({ data: defaultList, error: null, count: 0 });
      }
    };
    return b;
  }

  function mockSupabase() {
    return {
      from() {
        return mockBuilder(null, []);
      }
    };
  }

  beforeEach(() => {
    api = new RevenueAPI({ supabase: mockSupabase() });
    res = mockResponse();
  });

  describe('getLeads', () => {
    it('caps an over-large limit', async () => {
      const req = { query: { limit: '500' } };
      await api.getLeads(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.payload.leads).toEqual([]);
    });

    it('ignores an invalid status', async () => {
      const req = { query: { status: 'hacked' } };
      await api.getLeads(req, res);
      expect(res.statusCode).toBe(200);
    });
  });

  describe('createLead', () => {
    it('requires a company', async () => {
      const req = { body: { email: 'x@example.com' } };
      await api.createLead(req, res);
      expect(res.statusCode).toBe(400);
      expect(res.payload.details.some((d) => d.includes('company'))).toBe(true);
    });

    it('validates email format', async () => {
      const req = { body: { company: 'Acme', email: 'not-an-email' } };
      await api.createLead(req, res);
      expect(res.statusCode).toBe(400);
    });

    it('creates a lead when valid', async () => {
      const req = { body: { company: 'Acme', email: 'a@example.com' } };
      await api.createLead(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.payload.lead.company).toBe('Acme');
    });
  });

  describe('createQuote', () => {
    it('rejects an unknown project type', async () => {
      const req = { body: { projectType: 'fake', quantity: 1, complexity: 'low', rushOrder: false } };
      await api.createQuote(req, res);
      expect(res.statusCode).toBe(400);
    });

    it('rejects an out-of-range quantity', async () => {
      const req = { body: { projectType: 'prototyping', quantity: -1, complexity: 'low', rushOrder: false } };
      await api.createQuote(req, res);
      expect(res.statusCode).toBe(400);
    });

    it('creates a quote when valid', async () => {
      const req = { body: { projectType: 'prototyping', quantity: 2, complexity: 'medium', rushOrder: false } };
      await api.createQuote(req, res);
      expect(res.statusCode).toBe(201);
      expect(res.payload.quote.project_type).toBe('prototyping');
    });
  });

  describe('createCheckout', () => {
    it('rejects missing quoteId', async () => {
      const req = { body: { customerEmail: 'a@example.com' } };
      await api.createCheckout(req, res);
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid customer email', async () => {
      const req = { body: { quoteId: 'q1', customerEmail: 'bad' } };
      await api.createCheckout(req, res);
      expect(res.statusCode).toBe(400);
    });
  });

  describe('getRevenueReport', () => {
    it('rejects an unknown period', async () => {
      const req = { query: { period: 'year' } };
      await api.getRevenueReport(req, res);
      expect(res.statusCode).toBe(400);
    });

    it('succeeds for a valid period', async () => {
      const req = { query: { period: 'today' } };
      await api.getRevenueReport(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.payload.report.period).toBe('today');
    });
  });
});
