/**
 * HYDI Revenue Engine API
 * REST endpoints for the revenue pipeline: leads, quotes, checkout, reports.
 *
 * NOTE: This module is a business-logic class. The actual HTTP routes live in
 * pages/api/revenue/index.js and are responsible for authentication,
 * authorization, and rate limiting. This layer performs input validation,
 * schema checks, and safe error handling before touching Supabase or Stripe.
 */

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const defaultSupabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const defaultStripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const ALLOWED_STATUSES = new Set(['new', 'contacted', 'qualified', 'converted', 'lost']);
const ALLOWED_PERIODS = new Set(['today', 'week', 'month']);
const ALLOWED_COMPLEXITY = new Set(['low', 'medium', 'high']);
const ALLOWED_PROJECT_TYPES = new Set(['custom_print', 'prototyping', 'architectural_model', 'bulk_printing']);
const MAX_LIMIT = 100;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sanitizeString(value, maxLength = 255) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength).replace(/[\x00-\x1F\x7F]/g, '');
}

function validateLimit(value) {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0 || parsed > MAX_LIMIT) return MAX_LIMIT;
  return parsed;
}

function validateStatus(value) {
  if (!value) return undefined;
  const normalized = String(value).trim();
  return ALLOWED_STATUSES.has(normalized) ? normalized : undefined;
}

function validateQuoteBody(body) {
  const errors = [];

  if (!ALLOWED_PROJECT_TYPES.has(body.projectType)) {
    errors.push(`projectType must be one of: ${[...ALLOWED_PROJECT_TYPES].join(', ')}`);
  }

  const quantity = parseInt(body.quantity, 10);
  if (isNaN(quantity) || quantity < 1 || quantity > 1000000) {
    errors.push('quantity must be an integer between 1 and 1,000,000');
  }

  if (!ALLOWED_COMPLEXITY.has(body.complexity)) {
    errors.push(`complexity must be one of: ${[...ALLOWED_COMPLEXITY].join(', ')}`);
  }

  if (typeof body.rushOrder !== 'boolean') {
    errors.push('rushOrder must be a boolean');
  }

  return { errors, quantity };
}

function validateLeadBody(body) {
  const errors = [];
  const lead = {};

  if (isValidString(body.company)) {
    lead.company = sanitizeString(body.company, 255);
  } else {
    errors.push('company is required and must be a non-empty string');
  }

  if (isValidString(body.contact_name)) {
    lead.contact_name = sanitizeString(body.contact_name, 255);
  } else if (body.contact_name !== undefined) {
    errors.push('contact_name must be a non-empty string');
  }

  if (isValidString(body.email)) {
    const email = body.email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      errors.push('email must be a valid email address');
    } else {
      lead.email = email.slice(0, 255);
    }
  } else if (body.email !== undefined) {
    errors.push('email must be a valid email address');
  }

  if (isValidString(body.phone)) {
    lead.phone = sanitizeString(body.phone, 64);
  } else if (body.phone !== undefined) {
    errors.push('phone must be a non-empty string');
  }

  if (isValidString(body.notes)) {
    lead.notes = sanitizeString(body.notes, 2000);
  }

  return { errors, lead };
}

function validateCheckoutBody(body) {
  const errors = [];

  if (!isValidString(body.quoteId)) {
    errors.push('quoteId is required');
  }

  if (!isValidString(body.customerEmail) || !EMAIL_REGEX.test(body.customerEmail.trim())) {
    errors.push('customerEmail is required and must be a valid email address');
  }

  if (isValidString(body.origin)) {
    const origin = body.origin.trim();
    if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
      errors.push('origin must be a valid http or https URL');
    }
  }

  return errors;
}

class RevenueAPI {
  constructor(options = {}) {
    this.supabase = options.supabase || defaultSupabase;
    this.stripe = options.stripe !== undefined ? options.stripe : defaultStripe;
  }

  _badRequest(res, errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: list
    });
  }

  // Lead management
  async getLeads(req, res) {
    try {
      const rawStatus = req.query && (req.query.status ?? null);
      const rawLimit = req.query && (req.query.limit ?? 50);

      const status = validateStatus(rawStatus);
      const limit = validateLimit(rawLimit);

      let query = this.supabase
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw error;

      res.json({ success: true, leads: data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async createLead(req, res) {
    try {
      const { errors, lead } = validateLeadBody(req.body || {});
      if (errors.length > 0) {
        return this._badRequest(res, errors);
      }

      const payload = {
        id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        ...lead,
        status: 'new',
        created_at: new Date().toISOString()
      };

      const { data, error } = await this.supabase.from('leads').insert(payload).select().single();
      if (error) throw error;

      res.status(201).json({ success: true, lead: data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Outreach
  async getOutreach(req, res) {
    try {
      const { data, error } = await this.supabase
        .from('outreach')
        .select('*, leads(company)')
        .order('sent_at', { ascending: false });
      if (error) throw error;
      res.json({ success: true, outreach: data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Quotes
  async createQuote(req, res) {
    try {
      const body = req.body || {};
      const { errors, quantity } = validateQuoteBody(body);
      if (errors.length > 0) {
        return this._badRequest(res, errors);
      }

      const projectType = body.projectType;
      const complexity = body.complexity;
      const rushOrder = body.rushOrder;

      const pricing = this.calculatePricing(projectType);
      let total = pricing.base + (quantity * pricing.rate);
      if (complexity === 'high') total *= 1.5;
      if (complexity === 'medium') total *= 1.2;
      if (rushOrder) total *= 1.3;

      const quote = {
        id: `quote_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        project_type: projectType,
        quantity,
        complexity,
        rush_order: rushOrder,
        base_price: pricing.base,
        unit_price: pricing.rate,
        total: Math.round(total * 100) / 100,
        currency: 'usd',
        valid_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'active',
        created_at: new Date().toISOString()
      };

      const { data, error } = await this.supabase.from('quotes').insert(quote).select().single();
      if (error) throw error;
      res.status(201).json({ success: true, quote: data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async getQuotes(req, res) {
    try {
      const rawLimit = req.query && (req.query.limit ?? 50);
      const limit = validateLimit(rawLimit);

      const { data, error } = await this.supabase
        .from('quotes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      res.json({ success: true, quotes: data });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Stripe checkout
  async createCheckout(req, res) {
    // Validate input before checking configuration: a malformed request is a
    // 400 regardless of whether Stripe is wired up (also keeps unit tests
    // independent of Stripe config).
    const body = req.body || {};
    const errors = validateCheckoutBody(body);
    if (errors.length > 0) {
      return this._badRequest(res, errors);
    }

    if (!this.stripe) {
      return res.status(503).json({ success: false, error: 'Stripe not configured' });
    }

    try {

      const quoteId = body.quoteId.trim();
      const customerEmail = body.customerEmail.trim().toLowerCase().slice(0, 255);
      const origin = (isValidString(body.origin) ? body.origin.trim() : req.headers.origin) || 'http://localhost:3000';

      const { data: quote, error: quoteError } = await this.supabase
        .from('quotes')
        .select('*')
        .eq('id', quoteId)
        .single();
      if (quoteError || !quote) throw new Error('Quote not found');

      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: quote.currency,
            product_data: {
              name: `3D Printing - ${quote.project_type}`,
              description: `Quantity: ${quote.quantity}, Complexity: ${quote.complexity}`
            },
            unit_amount: Math.round(quote.total * 100)
          },
          quantity: 1
        }],
        mode: 'payment',
        success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/cancel`,
        customer_email: customerEmail
      });

      await this.supabase.from('checkout_sessions').insert({
        id: session.id,
        quote_id: quoteId,
        stripe_session_id: session.id,
        amount: quote.total,
        currency: quote.currency,
        status: 'pending',
        customer_email: customerEmail,
        created_at: new Date().toISOString()
      });

      res.status(201).json({ success: true, sessionId: session.id, url: session.url });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Revenue report
  async getRevenueReport(req, res) {
    try {
      const rawPeriod = (req.query && req.query.period) || 'today';
      const period = sanitizeString(rawPeriod, 20).toLowerCase();

      if (!ALLOWED_PERIODS.has(period)) {
        return this._badRequest(res, `period must be one of: ${[...ALLOWED_PERIODS].join(', ')}`);
      }

      const now = new Date();
      let startDate;

      switch (period) {
        case 'today':
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case 'week':
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
      }

      // Get completed payments
      const { data: payments } = await this.supabase
        .from('checkout_sessions')
        .select('amount, created_at')
        .eq('status', 'completed')
        .gte('created_at', startDate.toISOString());

      const totalRevenue = payments?.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0) || 0;
      const transactionCount = payments?.length || 0;

      // Get leads
      const { data: leads } = await this.supabase
        .from('leads')
        .select('status')
        .gte('created_at', startDate.toISOString());

      const newLeads = leads?.length || 0;
      const convertedLeads = leads?.filter(l => l.status === 'converted')?.length || 0;

      // Get proposals
      const { data: proposals } = await this.supabase
        .from('proposals')
        .select('status')
        .gte('created_at', startDate.toISOString());

      const proposalsSent = proposals?.length || 0;
      const proposalsAccepted = proposals?.filter(p => p.status === 'accepted')?.length || 0;

      res.json({
        success: true,
        report: {
          period,
          revenue: {
            total: totalRevenue,
            transaction_count: transactionCount,
            average_order: transactionCount > 0 ? totalRevenue / transactionCount : 0
          },
          leads: {
            new: newLeads,
            converted: convertedLeads,
            conversion_rate: newLeads > 0 ? (convertedLeads / newLeads * 100).toFixed(1) : 0
          },
          proposals: {
            sent: proposalsSent,
            accepted: proposalsAccepted,
            acceptance_rate: proposalsSent > 0 ? (proposalsAccepted / proposalsSent * 100).toFixed(1) : 0
          },
          generated_at: new Date().toISOString()
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Dashboard data
  async getDashboard(req, res) {
    try {
      const [leadsResult, quotesResult, proposalsResult, revenueResult] = await Promise.all([
        this.supabase.from('leads').select('*', { count: 'exact', head: true }),
        this.supabase.from('quotes').select('*', { count: 'exact', head: true }),
        this.supabase.from('proposals').select('*', { count: 'exact', head: true }),
        this.supabase.from('checkout_sessions').select('amount').eq('status', 'completed')
      ]);

      const totalRevenue = revenueResult.data?.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0) || 0;

      res.json({
        success: true,
        dashboard: {
          total_leads: leadsResult.count || 0,
          total_quotes: quotesResult.count || 0,
          total_proposals: proposalsResult.count || 0,
          total_revenue: totalRevenue,
          active_pipeline: {
            new_leads: leadsResult.count || 0,
            pending_quotes: quotesResult.count || 0,
            pending_proposals: proposalsResult.count || 0
          },
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  calculatePricing(projectType) {
    const baseRates = {
      custom_print: { base: 150, rate: 25, unit: 'per part' },
      prototyping: { base: 300, rate: 50, unit: 'per iteration' },
      architectural_model: { base: 500, rate: 100, unit: 'per model' },
      bulk_printing: { base: 1000, rate: 15, unit: 'per 100 parts' }
    };
    return baseRates[projectType] || baseRates.custom_print;
  }
}

module.exports = { RevenueAPI };
