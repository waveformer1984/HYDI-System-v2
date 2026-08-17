import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getRuntimeInventory } = require('../../lib/platform-diagnostics');

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const inventory = await getRuntimeInventory();
    res.status(200).json(inventory);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
}
