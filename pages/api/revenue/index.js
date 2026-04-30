const RevenueAPI = require('../../../api/revenue');

const revenueAPI = new RevenueAPI();

export default async function handler(req, res) {
  const { method } = req;

  switch (method) {
    case 'GET':
      // Get dashboard overview
      return await revenueAPI.getDashboard(req, res);
    case 'POST':
      // Create lead, quote, etc based on action
      const { action } = req.body;
      
      switch (action) {
        case 'create_lead':
          return await revenueAPI.createLead(req, res);
        case 'create_quote':
          return await revenueAPI.createQuote(req, res);
        case 'create_checkout':
          return await revenueAPI.createCheckout(req, res);
        default:
          return res.status(400).json({ success: false, error: 'Unknown action' });
      }
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      res.status(405).end(`Method ${method} Not Allowed`);
  }
}
