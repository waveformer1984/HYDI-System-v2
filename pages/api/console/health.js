'use strict';

const { getCockpitSession } = require('../../../src/hydi-v3/cockpitSession');
const { requireLocal } = require('../../../src/hydi-v3/localAccessGuard');

/**
 * GET /api/console/health — the business health dashboard: revenue
 * opportunities, manufacturing readiness, research progress, creative
 * pipeline, financial summary, and known data gaps. Never fabricates a
 * section it has no data for — see ConversationEngine.buildBusinessHealth().
 * Localhost only; see localAccessGuard.
 */
export default async function handler(req, res) {
  if (!requireLocal(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  try {
    const session = await getCockpitSession();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(session.consoleAPI.getHealth());
  } catch (error) {
    res.status(500).json({
      error: 'health_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
