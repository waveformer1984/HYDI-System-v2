/**
 * OpportunityVerdict — the deterministic business stage of the loop.
 *
 * Reads the agent mission's durable events for an opportunity and emits
 * a typed verdict. Deterministic by design: an analyst summary plus
 * source count is MARKET EVIDENCE — never customer demand, never
 * revenue proof. The enum cannot promote an opportunity to a customer
 * claim no matter what the research found.
 */

import { Pool } from 'pg';

export type OppVerdict = 'CONFIRMED' | 'PARTIALLY_SUPPORTED' | 'NOT_SUPPORTED' | 'INSUFFICIENT' | 'MISSION_PENDING';

export interface OppVerdictResult {
  verdict: OppVerdict;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  evidence: { sourceCount: number; analystSummary: string | null; missionStatus: string | null };
  limitations: string;
  recommendedAction: string;
  authorization: string;
}

export async function verdictForOpportunity(pool: Pool, opportunityId: string): Promise<OppVerdictResult | null> {
  // The mission record for this opportunity — agent_mission events
  // carry the id inside `objective`, not a dedicated field.
  const mission = await pool.query(
    `SELECT payload->>'missionId' AS mid, payload->>'role' AS role, payload->>'status' AS status
       FROM heidi_events
       WHERE event_type='agent_mission' AND payload->>'objective' ILIKE $1
       ORDER BY created_at DESC LIMIT 20`,
    [`%${opportunityId}%`],
  );
  const analystRow = mission.rows.find(r => r.role === 'analyst') ?? mission.rows[0];
  const missionRow = analystRow;
  if (!missionRow?.mid) return null; // no mission — caller should INVESTIGATE first

  // Terminal mission status? Fold the latest agent_status for this mission.
  const status = await pool.query(
    `SELECT payload->>'status' AS s FROM heidi_events
       WHERE event_type='agent_status' AND payload->>'missionId'=$1
       ORDER BY created_at DESC LIMIT 1`,
    [missionRow.mid],
  );
  const missionStatus = status.rows[0]?.s ?? missionRow.status ?? null;
  if (missionStatus !== 'COMPLETED' && missionStatus !== 'FAILED') {
    return {
      verdict: 'MISSION_PENDING', confidence: 'LOW',
      evidence: { sourceCount: 0, analystSummary: null, missionStatus },
      limitations: 'mission still in flight',
      recommendedAction: 'WAIT — mission in progress', authorization: 'R0',
    };
  }
  if (missionStatus === 'FAILED') {
    return {
      verdict: 'INSUFFICIENT', confidence: 'LOW',
      evidence: { sourceCount: 0, analystSummary: null, missionStatus },
      limitations: 'mission failed — no analyst output',
      recommendedAction: 'NO_ACTION — investigate with different angle or drop', authorization: 'R0',
    };
  }

  // Analyst + research output across ALL sibling missions whose
  // objective names this opportunity — the mission tree is per-agent.
  const agentResults = await pool.query(
    `SELECT payload->'result' AS res FROM heidi_events
       WHERE event_type='agent_status' AND payload->>'missionId' IN (
         SELECT payload->>'missionId' FROM heidi_events
           WHERE event_type='agent_mission' AND payload->>'objective' ILIKE $1
       ) AND payload->>'status'='COMPLETED' AND payload->'result' IS NOT NULL
       ORDER BY created_at DESC LIMIT 10`,
    [`%${opportunityId}%`],
  );
  const results = agentResults.rows.map(r => r.res as Record<string, unknown>);
  const summaries = results.map(r => String(r.summary ?? r.topic ?? '')).filter(Boolean);
  const sourceCount = results.reduce((s, r) => s + (Number(r.sourceCount) || 0), 0);
  const disagreements = results.flatMap(r => Array.isArray(r.disagreements) ? r.disagreements as string[] : []);
  const summary = summaries[summaries.length - 1] ?? null;

  if (sourceCount === 0 && !summary) {
    return {
      verdict: 'INSUFFICIENT', confidence: 'LOW',
      evidence: { sourceCount, analystSummary: null, missionStatus },
      limitations: 'no analyst summary or sources — the signal may be noise',
      recommendedAction: 'NO_ACTION_REQUIRED — insufficient evidence to justify further work', authorization: 'R0',
    };
  }

  // Real research exists — this is MARKET SIGNAL, the ceiling for
  // source-based investigation. CONFIRMED requires customer/payment
  // evidence this loop does not possess, so the enum caps here.
  const disputed = disagreements.length > 0;
  const strong = sourceCount >= 4;
  const limitBits = ['source-based market signal only — not customer demand, not willingness to pay, not revenue'];
  if (disputed) limitBits.push(`sibling research disagreement: ${disagreements[0]}`);
  return {
    verdict: 'PARTIALLY_SUPPORTED', confidence: strong && !disputed ? 'MEDIUM' : 'LOW',
    evidence: { sourceCount, analystSummary: summary?.slice(0, 300) ?? null, missionStatus },
    limitations: limitBits.join('; '),
    recommendedAction: strong && !disputed
      ? 'QUALIFY — define the smallest falsifiable customer hypothesis for this problem (R1 bounded work)'
      : 'OBSERVE — signal exists but thin or disputed; monitor rather than build',
    authorization: 'R1',
  };
}
