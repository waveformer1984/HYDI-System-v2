'use strict';

const { getCockpitSession } = require('../../../src/hydi-v3/cockpitSession');
const { requireLocal } = require('../../../src/hydi-v3/localAccessGuard');

const MAX_COMMAND_LENGTH = 500;

/**
 * POST /api/cockpit/command — run one natural-language cockpit command.
 *
 * Accepts the same vocabulary as the readline CLI and delegates to
 * ExecutiveCockpit.handleCommand, so approvals and rejections continue to route
 * through ExecutionGateway. Localhost only; see localAccessGuard.
 */
export default async function handler(req, res) {
  if (!requireLocal(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!text) {
    res.status(400).json({ error: 'missing_text', message: 'Provide a "text" command.' });
    return;
  }
  if (text.length > MAX_COMMAND_LENGTH) {
    res.status(400).json({ error: 'command_too_long', message: `Commands are limited to ${MAX_COMMAND_LENGTH} characters.` });
    return;
  }

  try {
    const session = await getCockpitSession();
    const response = await session.ask(text);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      error: 'command_failed',
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
