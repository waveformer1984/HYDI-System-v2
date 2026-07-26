'use strict';

const { getCockpitSession } = require('../../../src/hydi-v3/cockpitSession');
const { requireLocal } = require('../../../src/hydi-v3/localAccessGuard');
const ConsoleRenderer = require('../../../src/hydi-v3/ConsoleRenderer');
const BriefingRenderer = require('../../../src/hydi-v3/BriefingRenderer');

/**
 * GET /api/console — the Local Operations Console web interface.
 *
 * Renders the same ConsoleAPI data the CLI reads (briefing, approvals,
 * timeline, business health, agent workspace, command palette, session
 * state) through ConsoleRenderer, so the web and CLI surfaces can never
 * diverge. Localhost only; see localAccessGuard.
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
    const api = session.consoleAPI;
    const briefing = session.briefing();

    const html = ConsoleRenderer.toHtml({
      briefingSections: BriefingRenderer.toSections(briefing),
      approvals: api.getApprovals(),
      timeline: api.getTimeline({ limit: 30 }),
      health: api.getHealth(),
      agents: api.getAgents(),
      commandPalette: api.getCommandPalette(),
      sessionState: api.getSessionState(),
    }, { commandEndpoint: '/api/console/command' });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(html);
  } catch (error) {
    res.status(500).json({
      error: 'console_render_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
