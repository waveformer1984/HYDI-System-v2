/**
 * CustomerValidation — the honesty boundary between market signal and
 * customer truth.
 *
 * market signal → hypothesis (structured decision) → human approve →
 * authorized experiment → REAL declared evidence → updated finding.
 *
 * Hard rules:
 *  - A hypothesis is a structured human decision, never execution.
 *  - Declared evidence is provenance `human_declared`, verified:false —
 *    the system cannot check a conversation it didn't have.
 *  - CONFIRMED requires a real paid customer job (live Stripe session),
 *    not a declaration. Claims upgrade confidence, never truth class.
 */

import { Pool } from 'pg';

export interface ValidationHypothesis {
  hypothesis: string;
  falsification: string;
  proposedExperiment: string;
  evidenceRequired: string;
}

export function hypothesisFor(signal: { analystSummary: string | null; sourceCount: number; limitations: string }): ValidationHypothesis {
  const problem = signal.analystSummary?.slice(0, 160) || 'the evidenced problem space';
  return {
    hypothesis: `A specific customer segment experiences the problem evidenced by market research (${signal.sourceCount} sources) strongly enough to pay for a bounded solution.`,
    falsification: `10 direct conversations OR a 2-week waitlist produces <2 people willing to commit money or significant time for ${problem.slice(0, 80)}.`,
    proposedExperiment: 'Human-led: J conducts structured customer interviews (10 target) or publishes a paid-waitlist page. ProtoForge prepares the interview script/waitlist copy; J runs the contact.',
    evidenceRequired: 'Recorded conversation summaries with named-respondent counts, or real Stripe/waitlist rows. Confirmed requires a paid customer job.',
  };
}

export async function createHypothesisRecord(pool: Pool, opportunityId: string, h: ValidationHypothesis): Promise<string | null> {
  // One open hypothesis per opportunity — no queue spam.
  const dup = await pool.query(
    `SELECT id FROM human_intervention_requests WHERE status='pending'
       AND intervention_type='customer_validation_hypothesis'
       AND objective LIKE $1 LIMIT 1`,
    [`%${opportunityId}%`],
  );
  if (dup.rows.length > 0) return dup.rows[0].id as string;
  // The intervention attaches to the verdict goal that produced the finding.
  const parent = await pool.query(
    `SELECT id FROM heidi_goals WHERE context->>'capabilityId'='ops.opp_verdict'
       AND context->'capabilityParams'->>'opportunityId'=$1
       ORDER BY updated_at DESC LIMIT 1`,
    [opportunityId],
  );
  const r = await pool.query(
    `INSERT INTO human_intervention_requests (request_id, goal_id, intervention_type, objective, why_required, required_action, expected_state, blocker, expires_at, status, created_at)
     VALUES ($5, $6, 'customer_validation_hypothesis', $1, $2, $3, $4, 'Customer contact and experiments require explicit human approval — ProtoForge structures, J decides.', now() + interval '14 days', 'pending', now()) RETURNING id`,
    [`Approve customer-validation experiment for opportunity ${opportunityId}`,
    JSON.stringify({ opportunityId, hypothesis: h.hypothesis, falsification: h.falsification }),
    h.proposedExperiment, h.evidenceRequired,
    `cvh-${Date.now().toString(36)}-${opportunityId.slice(0, 8)}`,
    parent.rows[0]?.id ?? opportunityId],
  );
  return r.rows[0]?.id as string ?? null;
}

/** Resolve the authorized experiment for an opportunity, if J approved one. */
export async function authorizedExperiment(pool: Pool, opportunityId: string): Promise<{ eventId: string; hypothesis: ValidationHypothesis } | null> {
  const r = await pool.query(
    `SELECT id, payload FROM heidi_events WHERE event_type='validation_experiment'
       AND payload->>'opportunityId'=$1 AND payload->>'status'='AUTHORIZED'
       ORDER BY created_at DESC LIMIT 1`,
    [opportunityId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { eventId: row.id as string, hypothesis: (row.payload as { hypothesis?: ValidationHypothesis }).hypothesis as ValidationHypothesis };
}

/**
 * Record human-declared customer evidence and emit an updated business
 * finding. `hasPaidJob` is the only path to CONFIRMED, computed by the
 * caller from the real customer_jobs table — declarations never reach it.
 */
export async function recordEvidence(
  pool: Pool,
  opportunityId: string,
  evidence: { channel: string; summary: string; respondents?: number; declaredBy: string },
  hasPaidJob: boolean,
): Promise<{ eventId: string | null; verdict: string; findingId: string | null }> {
  const ev = await pool.query(
    `INSERT INTO heidi_events (event_type, payload, created_at)
     VALUES ('customer_evidence', $1, now()) RETURNING id`,
    [JSON.stringify({ opportunityId, ...evidence, provenance: 'human_declared', verified: false })],
  ).catch(() => null);
  const eventId = ev?.rows[0]?.id as string ?? null;

  const verdict = hasPaidJob ? 'CONFIRMED' : 'PARTIALLY_SUPPORTED';
  const limitations = hasPaidJob
    ? 'confirmed by real paid customer job — customer demand evidenced with money'
    : 'human-declared customer interest — not independently verifiable, no payment evidence; remains below CONFIRMED until a paid job exists';
  const finding = await pool.query(
    `INSERT INTO heidi_events (event_type, payload, created_at)
     VALUES ('business_finding', $1, now()) RETURNING id`,
    [JSON.stringify({
      opportunityId, verdict, confidence: hasPaidJob ? 'HIGH' : 'MEDIUM',
      evidence: { customerEvidenceEventId: eventId, channel: evidence.channel, respondents: evidence.respondents ?? null, paidJob: hasPaidJob },
      limitations,
      recommendedAction: hasPaidJob
        ? 'PROCEED — real customer payment exists; validate scope and fulfilment (R2)'
        : 'CONTINUE_VALIDATION — declared interest is signal, not proof; continue the experiment or seek payment commitment',
      authorization: 'R1',
      basedOnEvidence: eventId,
    })],
  ).catch(() => null);
  return { eventId, verdict, findingId: finding?.rows[0]?.id as string ?? null };
}

/** The only path to CONFIRMED: a real paid customer job on a live Stripe session. */
export async function hasRealPaidJob(pool: Pool): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM customer_jobs WHERE payment_status='paid'
       AND stripe_checkout_session_id LIKE 'cs_live_%' LIMIT 1`,
  ).catch(() => ({ rows: [] }));
  return r.rows.length > 0;
}
