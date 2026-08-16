import cors from '../lib/cors.js';
const { handleCors } = cors;

export default async function handler(req, res) {
  const corsOk = handleCors(req, res, {
    allowedMethods: 'POST, OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
  });
  if (!corsOk) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Bridge storage lives in the dashboard-status function so that
  // GET and POST share the same in-memory state. Forward the signed
  // snapshot there and let it validate and store the payload.
  res.redirect(307, '/api/dashboard-status');
}
