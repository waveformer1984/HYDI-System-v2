const RevenueEngine = require('../../../revenue-engine');
const { requireAuth } = require('../../../lib/auth/requireAuth.js');
const logger = require('../../../lib/structured-logger').child({ component: 'api/revenue/cycle' });

const engine = new RevenueEngine();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Triggers a real revenue-processing cycle -- was previously
  // unauthenticated, see ISSUES_FOUND.md.
  const auth = await requireAuth(req, res, engine.supabase, { permission: 'revenue:manage', routeName: 'revenue-cycle' });
  if (!auth.ok) return;

  try {
    const result = await engine.runRevenueCycle();
    res.json({ 
      success: true, 
      metrics: result.metrics,
      report: result.report 
    });
  } catch (error) {
    logger.error('Revenue cycle error', { error: error.message });
    res.status(500).json({
      success: false, 
      error: error.message 
    });
  }
}
