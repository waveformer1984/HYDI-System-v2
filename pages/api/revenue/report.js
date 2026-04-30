const RevenueEngine = require('../../../revenue-engine');

const engine = new RevenueEngine();

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { period } = req.query;
    const report = await engine.getRevenueReport(period);
    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
