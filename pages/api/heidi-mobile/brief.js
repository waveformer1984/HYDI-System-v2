// Heidi Mobile morning brief — the plain-text digest heidi-core composes at
// /morning-brief (shifts, PM2/disk/Ollama health, open PRs + CI, pending
// approvals). Device auth is enforced by guard(); heidi-core is reached
// server-side over localhost, same as lib/heidi-core-chat.js.

import { guard } from '../../../lib/heidi-mobile/guard.js';

const CORE_URL = () => String(process.env.HEIDI_CORE_URL || 'http://127.0.0.1:3459').replace(/\/+$/, '');

export default async function handler(req, res) {
  const g = guard(req, res, { methods: ['GET'], routeName: 'brief', rateMax: 20 });
  if (!g.ok) return;

  try {
    const upstream = await fetch(`${CORE_URL()}/morning-brief`, {
      signal: AbortSignal.timeout(12000),
      headers: { accept: 'application/json' },
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: 'upstream', message: `heidi-core answered ${upstream.status}` });
    }
    const data = await upstream.json();
    return res.status(200).json({
      generated_at: data.generatedAt,
      ct_date: data.ctDate,
      lines: Array.isArray(data.lines) ? data.lines : [],
      failures: Array.isArray(data.failures) ? data.failures : [],
    });
  } catch (e) {
    return res.status(502).json({ error: 'unreachable', message: e && e.message ? e.message : 'heidi-core unreachable' });
  }
}
