'use strict';

const { getCockpitSession } = require('../../../src/hydi-v3/cockpitSession');
const { requireLocal } = require('../../../src/hydi-v3/localAccessGuard');

/**
 * GET /api/console/timeline?category=&since=&limit= — the executive
 * timeline: completed work, new recommendations, workflow progress, agent
 * activity, approvals, system events, and backup events, all timestamped.
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
    const { category, since, limit } = req.query || {};
    const query = {};
    if (category) query.category = category;
    if (since) query.since = Number(since);
    if (limit) query.limit = Number(limit);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ items: session.consoleAPI.getTimeline(query) });
  } catch (error) {
    res.status(500).json({
      error: 'timeline_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
