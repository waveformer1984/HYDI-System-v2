const RevenueEngine = require('../../../revenue-engine');
const { requireAuth } = require('../../../lib/auth/requireAuth.js');

const engine = new RevenueEngine();

export default async function handler(req, res) {
  switch (req.method) {
    case 'GET': {
      // Exposes lead PII (name/email) -- was previously unauthenticated,
      // see ISSUES_FOUND.md.
      const auth = await requireAuth(req, res, engine.supabase, { permission: 'revenue:view', routeName: 'revenue-leads' });
      if (!auth.ok) return;
      return await engine.getLeads(req, res);
    }
    case 'POST': {
      // Triggers a real (potentially expensive/external) lead-scrape --
      // was previously unauthenticated, see ISSUES_FOUND.md.
      const auth = await requireAuth(req, res, engine.supabase, { permission: 'revenue:manage', routeName: 'revenue-leads' });
      if (!auth.ok) return;
      try {
        const leads = await engine.scrapeLeads();
        res.json({ success: true, leads });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
      break;
    }
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
