/**
 * Client Dashboard API — compatibility adapter
 *
 * Thin HTTP wrapper around lib/dashboard/revenue-service.js.
 * All financial_ledger aggregation now lives in one shared module.
 */

const { fetchClientDashboard } = require('../lib/dashboard/revenue-service');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { project } = req.query;
  if (!project) {
    return res.status(400).json({ error: 'Project code required' });
  }

  try {
    const dashboard = await fetchClientDashboard(project);

    if (!dashboard) {
      return res.status(503).json({ error: 'Revenue service unavailable' });
    }

    res.status(200).json(dashboard);
  } catch (error) {
    console.error('Client dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
