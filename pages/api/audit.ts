/**
 * API LAYER — /api/audit
 *
 * Returns recent heidi_events and daemon audit log entries for the
 * operational UI's Activity/Audit panel. Queries the live Postgres
 * database and reads the daemon audit JSONL file.
 *
 * GET /api/audit?limit=20 — recent heidi_events
 * GET /api/audit?source=daemon&limit=20 — recent daemon audit entries
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

interface AuditEntry {
  id: string | number;
  event_type: string;
  division: string | null;
  payload: unknown;
  verdict: string | null;
  created_at: string;
  source: 'heidi_events' | 'daemon_audit';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const source = (req.query.source as string) || 'heidi_events';

  try {
    if (source === 'daemon') {
      // Read daemon audit log (JSONL file)
      const fs = await import('fs');
      const path = await import('path');
      const auditPath = path.resolve(process.cwd(), '.heidi-daemon-audit.jsonl');

      if (!fs.existsSync(auditPath)) {
        return res.status(200).json({ entries: [], count: 0, source: 'daemon_audit' });
      }

      const content = fs.readFileSync(auditPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // Take last `limit` entries, reverse to newest-first
      const recent = lines.slice(-limit).reverse();
      const entries: AuditEntry[] = recent.map((line, idx) => {
        try {
          const parsed = JSON.parse(line);
          return {
            id: parsed.cycleId || `daemon-${idx}`,
            event_type: parsed.phase || 'self_sufficiency',
            division: parsed.loopState || null,
            payload: {
              cycleCount: parsed.cycleCount,
              capabilityHealth: parsed.capabilityHealth,
              selfRepairResult: parsed.selfRepairResult,
              durationMs: parsed.durationMs,
            },
            verdict: parsed.selfRepairResult?.repaired > 0 ? 'repaired' : 'cycled',
            created_at: parsed.timestamp,
            source: 'daemon_audit' as const,
          };
        } catch {
          return null as unknown as AuditEntry;
        }
      }).filter(Boolean);

      return res.status(200).json({ entries, count: entries.length, source: 'daemon_audit' });
    }

    // Default: query heidi_events from Postgres
    const pool = new Pool({
      host: process.env.PG_HOST || '127.0.0.1',
      port: parseInt(process.env.PG_PORT || '54322', 10),
      database: process.env.PG_DATABASE || 'postgres',
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || 'postgres',
      max: 2,
      idleTimeoutMillis: 5000,
    });

    try {
      const result = await pool.query(
        `SELECT id, event_type, division, payload, verdict, created_at
         FROM heidi_events
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit],
      );

      const entries: AuditEntry[] = result.rows.map((row) => ({
        id: row.id,
        event_type: row.event_type,
        division: row.division,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        verdict: row.verdict,
        created_at: row.created_at,
        source: 'heidi_events' as const,
      }));

      return res.status(200).json({ entries, count: entries.length, source: 'heidi_events' });
    } finally {
      await pool.end();
    }
  } catch (error) {
    console.error('[api/audit] Failed:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(500).json({
      error: `Audit query failed: ${error instanceof Error ? error.message : 'unknown'}`,
    });
  }
}
