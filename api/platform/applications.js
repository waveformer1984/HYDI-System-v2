import { createRequire } from 'module';

const require = createRequire(import.meta.url);
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
    const root = require('path').join(process.cwd());
    const applications = discover([
      require('path').join(root, 'switchboard'),
      require('path').join(root, 'protoforge-applications')
    ]);
    res.status(200).json({ ok: true, applications });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
}
