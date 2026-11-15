import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken.js';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const auth = verifyServiceToken(req.headers['x-hydi-service-token'], process.env.HYDI_SERVICE_SECRET);
  if (!auth.valid) {
    return res.status(401).json({ error: 'unauthorized', reason: auth.reason });
  }

  try {
    const root = process.env.HYDI_REPO_ROOT || path.resolve(process.cwd());
    const { buildOperationsEvidenceSnapshot } = require('../../../lib/heidi/operations-evidence-snapshot');
    const snap = await buildOperationsEvidenceSnapshot({ root, env: process.env, fetchImpl: fetch });
    return res.status(snap.overall === 'UNAVAILABLE' ? 503 : 200).json(snap);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error';
    return res.status(500).json({ ok: false, error: msg });
  }
}