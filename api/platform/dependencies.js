import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { DependencyGraph } = require('../../../protoforge/packages/dependency-graph/src/index');

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
    const graph = new DependencyGraph({});
    graph.buildFromDiscovery();
    const analysis = graph.analyze();
    res.status(200).json({
      ok: true,
      ...analysis,
      graph: graph.toJSON()
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    });
  }
}
