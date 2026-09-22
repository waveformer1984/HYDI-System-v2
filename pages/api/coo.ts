import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { collectAgentState } from '../../lib/heidi/AgentControlPlane';
import { collectHumanActionQueue } from '../../lib/heidi/HumanActionQueue';

// Read-only COO projection for the command-center UI. Every value comes
// from durable state — the API never fabricates; it labels staleness.
let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      host: process.env.PGHOST ?? '127.0.0.1',
      port: Number(process.env.PGPORT ?? 54322),
      database: process.env.PGDATABASE ?? 'postgres',
      user: process.env.PGUSER ?? 'postgres',
      password: process.env.PGPASSWORD ?? 'postgres',
      max: 2,
    });
  }
  return _pool;
}

const STALE_AFTER_MS = 10 * 60 * 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  const pool = getPool();
  try {
    const cooRow = await pool.query(
      `SELECT id, payload, created_at FROM heidi_events
       WHERE event_type = 'coo_state' ORDER BY created_at DESC LIMIT 1`,
    );
    const coo = cooRow.rows[0] ?? null;
    const cooAgeMs = coo ? Date.now() - new Date(coo.created_at).getTime() : null;

    const [agents, queue] = await Promise.all([
      collectAgentState(pool),
      collectHumanActionQueue(pool),
    ]);

    res.json({
      generatedAt: new Date().toISOString(),
      coo: coo ? {
        snapshotId: coo.id,
        snapshotAt: coo.created_at,
        ageMs: cooAgeMs,
        stale: (cooAgeMs ?? 0) > STALE_AFTER_MS,
        ...coo.payload,
      } : null,
      queue: {
        open: queue.open,
        backlogRowCount: queue.backlogRowCount,
        items: queue.items.slice(0, 25),
      },
      agents: {
        active: agents.activeCount,
        stale: agents.staleCount,
        agents: agents.agents,
        missions: agents.missions,
        messages: agents.messages.slice(-30),
      },
    });
  } catch (e) {
    res.status(200).json({
      generatedAt: new Date().toISOString(),
      error: e instanceof Error ? e.message : 'state read failed',
      coo: null, queue: null, agents: null,
    });
  }
}
