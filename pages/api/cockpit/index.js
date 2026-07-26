'use strict';

const { getCockpitSession } = require('../../../src/hydi-v3/cockpitSession');
const { requireLocal } = require('../../../src/hydi-v3/localAccessGuard');

/**
 * GET /api/cockpit — the local executive dashboard.
 *
 * Serves the same briefing the readline CLI prints, rendered to HTML by
 * BriefingRenderer. Localhost only; see localAccessGuard.
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
    const html = session.briefingHtml({ commandEndpoint: '/api/cockpit/command' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(html);
  } catch (error) {
    res.status(500).json({
      error: 'briefing_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
