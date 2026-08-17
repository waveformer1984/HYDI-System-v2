const RevenueAPI = require('../../../api/revenue');
const { requireAuth } = require('../../../lib/auth/requireAuth.js');

const revenueAPI = new RevenueAPI();

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET': {
      // Exposes real revenue/lead figures -- was previously
      // unauthenticated, see ISSUES_FOUND.md.
      const auth = await requireAuth(req, res, revenueAPI.supabase, { permission: 'revenue:view', routeName: 'revenue-dashboard' });
      if (!auth.ok) return;
      return await revenueAPI.getDashboard(req, res);
    }
    case 'POST': {
      // Creates leads/quotes/checkout sessions (createCheckout is real,
      // money-adjacent Stripe activity) -- was previously unauthenticated,
      // see ISSUES_FOUND.md.
      const auth = await requireAuth(req, res, revenueAPI.supabase, { permission: 'revenue:manage', routeName: 'revenue-actions' });
      if (!auth.ok) return;

      // Create lead, quote, etc based on action
      const { action } = req.body;

      switch (action) {
        case 'create_lead':
          return await revenueAPI.createLead(req, res);
        case 'create_quote':
          return await revenueAPI.createQuote(req, res);
        case 'create_checkout':
          return await revenueAPI.createCheckout(req, res);
        default:
          return res.status(400).json({ success: false, error: 'Unknown action' });
      }
    }
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}
