import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const path = require('path');
const { discover } = require('../../../protoforge/packages/application-manifest/src/index');

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
    const root = path.join(process.cwd());
    const applications = discover([
      path.join(root, 'switchboard'),
      path.join(root, 'protoforge-applications')
    ]);
    const capabilities = new Set();
    for (const app of applications) {
      for (const cap of app.capabilities || []) {
        capabilities.add(cap);
      }
    }
    res.status(200).json({ ok: true, capabilities: [...capabilities].sort() });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
}
