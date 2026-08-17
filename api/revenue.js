/**
 * HYDI Revenue Engine API
 * REST endpoints for the 5 core money-making systems
 */

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const stripe = (process.env.STRIPE_SECRET_KEY)
  ? (process.env.STRIPE_SECRET_KEY.startsWith('sk_live_') && process.env.ALLOW_LIVE_STRIPE !== 'true'
      ? null // refuse to construct a live client in dev/test without explicit opt-in
      : new Stripe(process.env.STRIPE_SECRET_KEY))
  : null;

class RevenueAPI {
  constructor() {
    this.supabase = supabase;
    this.stripe = stripe;
  }

  // Lead management
  async getLeads(req, res) {
    try {
      const { status, limit = 50 } = req.query;
      let query = this.supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(parseInt(limit));
      if (status) query = query.eq('status', status);
      
      const { data, error } = await query;
      if (error) throw error;
      
      res.json({ success: true, leads: data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async createLead(req, res) {
    try {
      const { action, ...leadFields } = req.body;
      const lead = {
        id: `lead_${Date.now()}`,
        ...leadFields,
        status: 'new',
        created_at: new Date().toISOString()
      };
      
      const { data, error } = await this.supabase.from('leads').insert(lead).select().single();
      if (error) throw error;
      
      res.json({ success: true, lead: data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Outreach
  async getOutreach(req, res) {
    try {
      const { data, error } = await this.supabase.from('outreach').select('*, leads(company)').order('sent_at', { ascending: false });
      if (error) throw error;
      res.json({ success: true, outreach: data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Quotes
  async createQuote(req, res) {
    try {
      const { projectType, quantity, complexity, rushOrder } = req.body;
      const pricing = this.calculatePricing(projectType);
      let total = pricing.base + (quantity * pricing.rate);
      if (complexity === 'high') total *= 1.5;
      if (complexity === 'medium') total *= 1.2;
      if (rushOrder) total *= 1.3;

      const quote = {
        id: `quote_${Date.now()}`,
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
      res.json({ success: true, quote: data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getQuotes(req, res) {
    try {
      const { data, error } = await this.supabase.from('quotes').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      res.json({ success: true, quotes: data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Stripe checkout
  async createCheckout(req, res) {
    if (!this.stripe) {
      return res.status(500).json({ success: false, error: 'Stripe not configured' });
    }

    try {
      const { quoteId, customerEmail } = req.body;
      
      // Get quote
      const { data: quote, error: quoteError } = await this.supabase.from('quotes').select('*').eq('id', quoteId).single();
      if (quoteError || !quote) throw new Error('Quote not found');

      // Create Stripe session
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
        success_url: `${req.headers.origin || 'http://localhost:3000'}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin || 'http://localhost:3000'}/cancel`,
        customer_email: customerEmail
      });

      // Store session
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

      res.json({ success: true, sessionId: session.id, url: session.url });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Revenue report
  async getRevenueReport(req, res) {
    try {
      const { period = 'today' } = req.query;
      const now = new Date();
      let startDate;
      
      switch(period) {
        case 'today':
          startDate = new Date(now.setHours(0,0,0,0));
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
      res.status(500).json({ success: false, error: error.message });
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
      res.status(500).json({ success: false, error: error.message });
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

module.exports = RevenueAPI;
