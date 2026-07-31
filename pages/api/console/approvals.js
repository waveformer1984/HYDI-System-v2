'use strict';

const { getCockpitSession } = require('../../../src/hydi-v3/cockpitSession');
const { requireLocal } = require('../../../src/hydi-v3/localAccessGuard');

const ACTIONS = new Set(['approve', 'reject', 'modify', 'simulate', 'explain']);

/**
 * GET /api/console/approvals — the enriched Approval Center list (business
 * value, expected impact, risk, required resources, responsible agent,
 * execution plan) for every pending ExecutionGateway action and
 * BusinessWorkflowEngine workflow.
 *
 * POST /api/console/approvals — { id, action, notes? } where action is one
 * of approve | reject | modify | simulate | explain. Every action still
 * routes through ExecutionGateway / BusinessWorkflowEngine via
 * ApprovalCenter; this route grants no new authority. Localhost only; see
 * localAccessGuard.
 */
export default async function handler(req, res) {
  if (!requireLocal(req, res)) return;

  try {
    const session = await getCockpitSession();
    const api = session.consoleAPI;

    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ approvals: api.getApprovals() });
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
      const { id, action, notes } = body;

      if (!id || !ACTIONS.has(action)) {
        res.status(400).json({ error: 'invalid_request', message: `Provide "id" and one of: ${[...ACTIONS].join(', ')}.` });
        return;
      }

      let result;
      if (action === 'approve') result = await api.approve(id);
      else if (action === 'reject') result = api.reject(id);
      else if (action === 'modify') result = api.requestModification(id, notes || '');
      else if (action === 'simulate') result = await api.simulate(id);
      else if (action === 'explain') result = api.explainApproval(id);

      res.status(200).json(result);
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'method_not_allowed' });
  } catch (error) {
    res.status(500).json({
      error: 'approvals_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
