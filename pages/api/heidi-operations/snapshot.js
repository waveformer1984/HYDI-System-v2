import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken.js';

const DEFAULT_CORE = 'http://127.0.0.1:3459';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const auth = verifyServiceToken(req.headers['x-hydi-service-token'], process.env.HYDI_SERVICE_SECRET);
  if (!auth.valid) {
    return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
  }

  const coreUrl = String(process.env.HEIDI_CORE_URL || DEFAULT_CORE).replace(/\/+$/, '');
  const coreSecret = process.env.HEIDI_SECRET;
  if (!coreSecret) {
    return res.status(503).json({
      error: 'heidi_secret_not_configured',
      note: 'Proxy refuses to call heidi-core without HEIDI_SECRET — prevents open core bypass',
    });
  }

  try {
    const upstream = await fetch(`${coreUrl}/operations/snapshot`, {
      headers: { 'x-heidi-secret': coreSecret, accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json');
    return res.send(body);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error';
    return res.status(502).json({ ok: false, error: 'heidi_core_unreachable', message: msg });
  }
}