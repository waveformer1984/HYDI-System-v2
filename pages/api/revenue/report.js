const RevenueEngine = require('../../../revenue-engine');
const { requireAuth } = require('../../../lib/auth/requireAuth.js');

const engine = new RevenueEngine();

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Exposes real revenue figures -- was previously unauthenticated, see
  // ISSUES_FOUND.md.
  const auth = await requireAuth(req, res, engine.supabase, { permission: 'revenue:view', routeName: 'revenue-report' });
  if (!auth.ok) return;

  try {
    const { period } = req.query;
    const report = await engine.getRevenueReport(period);
    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
