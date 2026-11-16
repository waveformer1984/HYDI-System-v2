import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken.js';
const { buildImprovementDashboard } = require('../../../lib/heidi/self-improvement/dashboard');

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
    const dashboard = await buildImprovementDashboard({
      root: process.cwd(),
      frankReachable: false,
      localCiIncidentOpen: process.env.HEIDI_LOCAL_CI_INCIDENT_OPEN === 'true',
    });
    return res.status(200).json(dashboard);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'error';
    return res.status(500).json({ ok: false, error: 'dashboard_failed', message: msg });
  }
}