const RevenueEngine = require('../../../revenue-engine');

const engine = new RevenueEngine();

export default async function handler(req, res) {
  switch (req.method) {
    case 'GET':
      return await engine.getLeads(req, res);
    case 'POST':
      try {
        const leads = await engine.scrapeLeads();
        res.json({ success: true, leads });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
      break;
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
