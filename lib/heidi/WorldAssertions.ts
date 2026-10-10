/**
 * WorldAssertions — durable typed assertions over heidi_events, layered
 * on top of the existing WorldModel (entity/state aggregation). This is
 * the belief layer: facts, beliefs, hypotheses, unknowns — not entities.
 *
 *   fact       — verified durable evidence, provenance required
 *   belief     — inference with confidence + derivedFrom ids
 *   hypothesis — falsifiable, carries falsification condition
 *   unknown    — explicit gap, carries reason
 *
 * LLM output can only produce belief/hypothesis/unknown — 'fact' requires
 * durable provenance, never model confidence. Contradiction revises —
 * never overwrites.
 */
import { Pool } from 'pg';

export type AssertionKind = 'fact' | 'belief' | 'hypothesis' | 'unknown';

export interface Assertion {
  kind: AssertionKind;
  subject: string;
  predicate: string;
  value: string;
  provenance: string;           // 'db:<table>' | 'event:<id>' | 'human:<who>' | 'model:<name>' etc.
  confidence?: number;          // belief only, 0..1
  falsification?: string;       // hypothesis only
  reason?: string;              // unknown only
  derivedFrom?: string[];       // event/assertion ids
}

export async function assertWorld(pool: Pool, a: Assertion): Promise<string | null> {
  // Facts can only be asserted against durable sources — a model claiming
  // 'fact' without an observed provenance is demoted to belief.
  if (a.kind === 'fact' && !/^(db:|event:|human:)/.test(a.provenance)) a.kind = 'belief';
  const r = await pool.query(
    `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ('world_assertion', $1, now()) RETURNING id`,
    [JSON.stringify(a)],
  ).catch(() => null);
  return r?.rows[0]?.id ?? null;
}

/** Record that newEvidence contradicts an existing assertion — both ids survive. */
export async function reviseBelief(
  pool: Pool,
  assertionId: string,
  direction: 'weakened' | 'refuted' | 'reinforced',
  evidenceId: string,
  note: string,
): Promise<string | null> {
  const r = await pool.query(
    `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ('belief_revision', $1, now()) RETURNING id`,
    [JSON.stringify({ assertionId, direction, evidenceId, note })],
  ).catch(() => null);
  return r?.rows[0]?.id ?? null;
}

/** Current assertions on a subject — newest first, with revisions folded in. */
export async function worldState(pool: Pool, subject: string): Promise<Array<Assertion & { id: string; revisions: Array<Record<string, unknown>> }>> {
  const { rows } = await pool.query(
    `SELECT id, payload, created_at FROM heidi_events WHERE event_type='world_assertion'
       AND payload->>'subject'=$1 ORDER BY created_at`,
    [subject],
  );
  const revs = await pool.query(
    `SELECT payload FROM heidi_events WHERE event_type='belief_revision' ORDER BY created_at`,
  );
  const byId = new Map<string, Array<Record<string, unknown>>>();
  for (const r of revs.rows) {
    const p = r.payload as { assertionId?: string };
    if (p.assertionId) {
      if (!byId.has(p.assertionId)) byId.set(p.assertionId, []);
      (byId.get(p.assertionId) as Array<Record<string, unknown>>).push(r.payload as Record<string, unknown>);
    }
  }
  return (rows as Array<{ id: string; payload: Assertion }>).map(r => ({
    ...r.payload, id: r.id, revisions: byId.get(r.id) ?? [],
  }));
}
