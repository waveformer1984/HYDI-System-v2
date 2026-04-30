const RevenueEngine = require('../../../revenue-engine');

const engine = new RevenueEngine();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const result = await engine.runRevenueCycle();
    res.json({ 
      success: true, 
      metrics: result.metrics,
      report: result.report 
    });
  } catch (error) {
    console.error('Revenue cycle error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
}
