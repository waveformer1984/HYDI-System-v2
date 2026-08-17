import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const path = require('path');
const { discover } = require('../../../../protoforge/packages/application-manifest/src/index');

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const name = (req.query?.name || new URL(req.url, 'http://localhost').pathname.split('/').pop()) || '';

  try {
    const root = path.join(process.cwd());
    const applications = discover([
      path.join(root, 'switchboard'),
      path.join(root, 'protoforge-applications')
    ]);
    const app = applications.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (!app) {
      res.status(404).json({ ok: false, error: 'Application not found' });
      return;
    }
    res.status(200).json({ ok: true, application: app });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
}
