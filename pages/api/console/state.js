'use strict';

const { getCockpitSession } = require('../../../src/hydi-v3/cockpitSession');
const { requireLocal } = require('../../../src/hydi-v3/localAccessGuard');

/**
 * GET /api/console/state — current session context (focus, active
 * project/objective, owner priority, recent commands, conversation history,
 * window layout). Restored automatically after a restart by SessionMemory.
 *
 * PUT /api/console/state — update window layout only (the one piece of
 * session state the web console itself owns, e.g. collapsed panels).
 * Localhost only; see localAccessGuard.
 */
export default async function handler(req, res) {
  if (!requireLocal(req, res)) return;

  try {
    const session = await getCockpitSession();

    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(session.consoleAPI.getSessionState());
      return;
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
      const layout = session.consoleAPI.setWindowLayout(body.windowLayout || {});
      res.status(200).json({ windowLayout: layout });
      return;
    }

    res.setHeader('Allow', 'GET, PUT');
    res.status(405).json({ error: 'method_not_allowed' });
  } catch (error) {
    res.status(500).json({
      error: 'state_failed',
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
