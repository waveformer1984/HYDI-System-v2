'use strict';

const { getCockpitSession } = require('../../../src/hydi-v3/cockpitSession');
const { requireLocal } = require('../../../src/hydi-v3/localAccessGuard');
const BriefingRenderer = require('../../../src/hydi-v3/BriefingRenderer');

/**
 * GET /api/cockpit/briefing — structured briefing for programmatic consumers.
 *
 * Returns the raw briefing object, the format-neutral section model, and the
 * plain-text rendering, so integrations never re-derive presentation rules.
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
    const briefing = session.briefing();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      briefing,
      model: BriefingRenderer.toSections(briefing),
      text: BriefingRenderer.toText(briefing),
    });
  } catch (error) {
    res.status(500).json({
      error: 'briefing_failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
