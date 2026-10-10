/**
 * ValidationQueue — the deterministic customer-validation state machine,
 * folded from durable rows only. No memory, no inference, no optimistic
 * stages. Each stage requires a real durable predecessor:
 *
 *   OBSERVED        opportunity exists
 *   FINDING         business_finding event
 *   HYPOTHESIS      human_intervention_requests (pending)   ← human decision
 *   AUTHORIZED      validation_experiment event             ← human approved
 *   EVIDENCE_DECLARED customer_evidence (verified:false)    ← human did it
 *   VERIFIED        never from declarations — paid job only
 *
 * Stages never collapse: AUTHORIZED is not EXECUTED, DECLARED is not
 * VERIFIED. An expired hypothesis or experiment is truthfully BLOCKED.
 */

import { Pool } from 'pg';

export type ValidationStage =
  | 'OBSERVED'
  | 'FINDING'
  | 'HYPOTHESIS_PENDING'
  | 'AUTHORIZED'
  | 'EVIDENCE_DECLARED'
  | 'VERIFIED'
  | 'BLOCKED_ON_HUMAN'
  | 'EXPIRED';

export interface ValidationItem {
  opportunityId: string;
  opportunityTitle: string;
  stage: ValidationStage;
  finding: { verdict: string; confidence: string; limitations: string } | null;
  hypothesisRequestId: string | null;
  hypothesisStatus: string | null;
  hypothesisExpiresAt: string | null;
  experimentId: string | null;
  experimentAuthorizedBy: string | null;
  proposedExperiment: string | null;
  falsification: string | null;
  evidenceRequired: string | null;
  evidence: Array<{ channel: string; summary: string; declaredBy: string; verified: boolean; createdAt: string }>;
  verified: false; // declarations can never make this true
  nextHumanAction: string;
  blockedReason: string | null;
}

export async function getValidationQueue(pool: Pool): Promise<ValidationItem[]> {
  const items = new Map<string, ValidationItem>();

  const opps = await pool.query(
    `SELECT DISTINCT payload->>'opportunityId' AS opp_id FROM heidi_events
       WHERE event_type IN ('business_finding','validation_experiment','customer_evidence')`,
  );
  for (const r of opps.rows as Array<{ opp_id: string }>) {
    const meta = await pool.query(`SELECT title FROM protoforge_opportunities WHERE id=$1`, [r.opp_id]);
    items.set(r.opp_id, {
      opportunityId: r.opp_id,
      opportunityTitle: meta.rows[0]?.title ?? r.opp_id.slice(0, 8),
      stage: 'OBSERVED',
      finding: null,
      hypothesisRequestId: null, hypothesisStatus: null, hypothesisExpiresAt: null,
      experimentId: null, experimentAuthorizedBy: null,
      proposedExperiment: null, falsification: null, evidenceRequired: null,
      evidence: [],
      verified: false,
      nextHumanAction: 'INVESTIGATE — create a business finding first',
      blockedReason: null,
    });
  }

  for (const item of items.values()) {
    // Latest finding
    const f = await pool.query(
      `SELECT payload FROM heidi_events WHERE event_type='business_finding'
         AND payload->>'opportunityId'=$1 ORDER BY created_at DESC LIMIT 1`,
      [item.opportunityId],
    );
    if (f.rows[0]) {
      const p = f.rows[0].payload as Record<string, unknown>;
      item.finding = { verdict: String(p.verdict), confidence: String(p.confidence), limitations: String(p.limitations ?? '') };
      item.stage = 'FINDING';
      item.nextHumanAction = p.verdict === 'INSUFFICIENT' || p.verdict === 'NOT_SUPPORTED'
        ? 'NO_ACTION_REQUIRED — evidence does not support customer work'
        : 'REVIEW HYPOTHESIS — a falsifiable customer-validation hypothesis is pending your decision';
    }

    // Hypothesis (human queue item)
    const h = await pool.query(
      `SELECT id, request_id, status, required_action, expected_state, expires_at, resolution_note
         FROM human_intervention_requests
         WHERE intervention_type='customer_validation_hypothesis' AND objective LIKE $1
         ORDER BY created_at DESC LIMIT 1`,
      [`%${item.opportunityId}%`],
    );
    if (h.rows[0]) {
      const hr = h.rows[0];
      item.hypothesisRequestId = hr.request_id;
      item.hypothesisStatus = hr.status;
      item.hypothesisExpiresAt = hr.expires_at ? new Date(hr.expires_at).toISOString() : null;
      item.proposedExperiment = hr.required_action;
      item.evidenceRequired = hr.expected_state;
      try {
        const meta = JSON.parse(String(hr.why_required ?? '{}')) as { falsification?: string };
        item.falsification = meta.falsification ?? null;
      } catch { /* non-JSON why_required */ }
      const expired = hr.expires_at && new Date(hr.expires_at).getTime() < Date.now();
      if (hr.status === 'pending') {
        item.stage = expired ? 'EXPIRED' : 'HYPOTHESIS_PENDING';
        item.nextHumanAction = expired
          ? 'HYPOTHESIS EXPIRED — decide whether to reject or re-issue'
          : `DECIDE — approve or reject the validation experiment (queue item intervention:${hr.request_id})`;
        item.blockedReason = expired ? 'hypothesis expired without a human decision' : null;
      } else if (hr.status === 'resolved' && hr.resolution_note === 'reject') {
        item.stage = 'FINDING';
        item.nextHumanAction = 'HYPOTHESIS REJECTED — revise or drop this opportunity';
      }
    }

    // Authorized experiment (the human said yes — record, not contact)
    const e = await pool.query(
      `SELECT id, payload->>'authorizedBy' AS by, payload->>'proposedExperiment' AS exp, created_at
         FROM heidi_events WHERE event_type='validation_experiment'
         AND payload->>'opportunityId'=$1 AND payload->>'status'='AUTHORIZED'
         ORDER BY created_at DESC LIMIT 1`,
      [item.opportunityId],
    );
    if (e.rows[0]) {
      item.experimentId = e.rows[0].id;
      item.experimentAuthorizedBy = e.rows[0].by;
      item.proposedExperiment = item.proposedExperiment ?? e.rows[0].exp;
      item.stage = 'AUTHORIZED';
      item.nextHumanAction = `RUN EXPERIMENT — ${item.proposedExperiment ?? 'perform the authorized validation'} — then declare evidence via chat`;
      item.blockedReason = 'BLOCKED ON HUMAN ACTION — authorized does not mean contacted';
    }

    // Declared evidence — never VERIFIED, never CONFIRMED by declaration
    const ev = await pool.query(
      `SELECT payload, created_at FROM heidi_events WHERE event_type='customer_evidence'
         AND payload->>'opportunityId'=$1 ORDER BY created_at DESC`,
      [item.opportunityId],
    );
    for (const r of ev.rows) {
      const p = r.payload as Record<string, unknown>;
      item.evidence.push({
        channel: String(p.channel ?? 'other'), summary: String(p.summary ?? '').slice(0, 200),
        declaredBy: String(p.declaredBy ?? 'unknown'), verified: false,
        createdAt: new Date(r.created_at).toISOString(),
      });
    }
    if (ev.rows.length > 0) {
      item.stage = 'EVIDENCE_DECLARED';
      item.blockedReason = 'evidence declared but unverified — CONFIRMED requires a real paid customer job';
      item.nextHumanAction = item.finding?.verdict === 'CONFIRMED'
        ? 'NONE — real payment evidence exists'
        : 'SEEK PAYMENT COMMITMENT — declared interest is not proof; the gate requires a real paid job';
    }
  }

  return [...items.values()].sort((a, b) => stageRank(b.stage) - stageRank(a.stage));
}

function stageRank(s: ValidationStage): number {
  return { VERIFIED: 7, EVIDENCE_DECLARED: 6, AUTHORIZED: 5, HYPOTHESIS_PENDING: 4, FINDING: 3, OBSERVED: 2, BLOCKED_ON_HUMAN: 1, EXPIRED: 0 }[s];
}
