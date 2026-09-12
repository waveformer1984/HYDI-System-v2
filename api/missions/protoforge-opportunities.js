'use strict';
/**
 * HYDI Mission Runner v1 -- protoforge.daily_opportunity_scan API.
 *
 * GET  /api/missions/protoforge-opportunities
 *   ?status=high_confidence|needs_review|rejected   (optional filter)
 *   ?format=briefing                                 (optional: return the
 *                                                      plain-text brief instead
 *                                                      of JSON)
 *   Read-only, unauthenticated -- same posture as api/health.js. Returns
 *   the latest persisted mission run plus the current opportunity queue.
 *
 * POST /api/missions/protoforge-opportunities
 *   Requires x-hydi-service-token (see lib/auth/verifyServiceToken.js),
 *   same guard as api/chat/route.js -- this is a mutating endpoint.
 *   Body: { action: 'trigger' }                       run the mission now
 *         { action: 'approve', id, approvedBy }        human approval (R1->authorized)
 *         { action: 'reject',  id, approvedBy }        human rejection
 *
 *   'approve' and 'reject' are the ONLY actions that change approval_status
 *   -- see lib/missions/approval.js. Neither one executes anything
 *   external; there is no 'execute' action in this API because v1 of this
 *   mission has no execution step (see lib/missions/approval.js's
 *   executeApprovedOpportunity, which throws NOT_IMPLEMENTED).
 */

const { verifyServiceToken } = require('../../lib/auth/verifyServiceToken');
const { listOpportunities, getLatestMissionRun } = require('../../lib/missions/opportunity-store');
const { approveOpportunity, rejectOpportunity } = require('../../lib/missions/approval');
const { buildBriefing } = require('../../lib/missions/briefing');
const { runMission } = require('../../scripts/missions/protoforge-daily-opportunity-scan');

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const opportunities = await listOpportunities({ status, limit: 100 });
      const latestRun = await getLatestMissionRun();

      if (req.query.format === 'briefing') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(buildBriefing(opportunities));
      }
      return res.status(200).json({ latestRun, opportunities, count: opportunities.length });
    }

    if (req.method === 'POST') {
      const { valid, reason } = verifyServiceToken(req.headers['x-hydi-service-token']);
      if (!valid) return res.status(401).json({ error: 'Unauthorized', reason });

      const { action, id, approvedBy } = req.body || {};
      if (action === 'trigger') {
        const result = await runMission();
        return res.status(200).json(result);
      }
      if (action === 'approve' || action === 'reject') {
        if (!id) return res.status(400).json({ error: 'id is required' });
        const fn = action === 'approve' ? approveOpportunity : rejectOpportunity;
        const updated = await fn(id, approvedBy);
        return res.status(200).json({ opportunity: updated });
      }
      return res.status(400).json({ error: `unknown action: ${action}` });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('protoforge-opportunities API error:', error);
    return res.status(500).json({ error: error.message });
  }
};
