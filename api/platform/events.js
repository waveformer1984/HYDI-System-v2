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
    const byEvent = new Map();
    for (const app of applications) {
      for (const ev of app.eventsProduced || []) {
        const entry = byEvent.get(ev) || { eventType: ev, producedBy: [], consumedBy: [] };
        if (!entry.producedBy.includes(app.name)) entry.producedBy.push(app.name);
        byEvent.set(ev, entry);
      }
      for (const ev of app.eventsConsumed || []) {
        const entry = byEvent.get(ev) || { eventType: ev, producedBy: [], consumedBy: [] };
        if (!entry.consumedBy.includes(app.name)) entry.consumedBy.push(app.name);
        byEvent.set(ev, entry);
      }
    }
    const events = [...byEvent.values()].sort((a, b) => a.eventType.localeCompare(b.eventType));
    res.status(200).json({ ok: true, events });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
}
