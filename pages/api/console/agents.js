'use strict';

const { getCockpitSession } = require('../../../src/hydi-v3/cockpitSession');
const { requireLocal } = require('../../../src/hydi-v3/localAccessGuard');

/**
 * GET /api/console/agents — every agent's workspace summary.
 * GET /api/console/agents?name=Manufacturing%20Manager — one agent's full
 * workspace: priorities, recent/pending work, recommendations, risks,
 * confidence, and explainability. Localhost only; see localAccessGuard.
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
    const { name } = req.query || {};
    res.setHeader('Cache-Control', 'no-store');

    if (name) {
      const known = session.agentWorkspace ? session.agentWorkspace.listAgentNames() : [];
      if (!known.includes(String(name))) {
        res.status(404).json({ error: 'unknown_agent', message: `No agent named "${name}". Known agents: ${known.join(', ')}.` });
        return;
      }
      res.status(200).json(session.consoleAPI.getAgent(String(name)));
      return;
    }

    res.status(200).json({ agents: session.consoleAPI.getAgents() });
  } catch (error) {
    res.status(500).json({
      error: 'agents_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
