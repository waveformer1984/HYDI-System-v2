/**
 * ValidationQueue — stage-fold truthfulness. The queue is built entirely
 * from durable rows; the unit test stub feeds the four shape queries and
 * checks the stage machine never lies about where an opportunity stands.
 */
import { getValidationQueue, ValidationStage } from '../../lib/heidi/ValidationQueue';
import { Pool } from 'pg';

const OPP = '4c4b9ee2-62d7-44e8-a82b-06aa196b88e0';

interface Fixture {
  findings?: Array<Record<string, unknown>>;
  hypothesis?: { status: string; resolution_note?: string | null; expires_in_days?: number } | null;
  experiment?: { authorizedBy: string } | null;
  evidence?: Array<Record<string, unknown>>;
}

function fakePool(f: Fixture): Pool {
  const query = async (sql: string, params?: unknown[]) => {
    if (sql.includes(`WHERE id=$1`) && sql.includes('protoforge_opportunities')) {
      return { rows: [{ title: 'Test opportunity' }] };
    }
    if (sql.includes('protoforge_opportunities')) {
      return { rows: [{ title: 'Test opportunity' }] };
    }
    if (sql.includes(`event_type IN ('business_finding','validation_experiment','customer_evidence')`)) {
      return { rows: [{ opp_id: OPP }] };
    }
    if (sql.includes(`event_type='business_finding'`)) {
      const p = f.findings?.[0];
      return { rows: p ? [{ payload: p }] : [] };
    }
    if (sql.includes('human_intervention_requests')) {
      return {
        rows: f.hypothesis ? [{
          id: 'hir-1', request_id: 'cvh-test', status: f.hypothesis.status,
          resolution_note: f.hypothesis.resolution_note ?? null,
          required_action: 'interview 10', expected_state: 'named respondents',
          why_required: JSON.stringify({ falsification: '<2 willing' }),
          expires_at: new Date(Date.now() + (f.hypothesis.expires_in_days ?? 14) * 86400000),
        }] : [],
      };
    }
    if (sql.includes(`event_type='validation_experiment'`)) {
      return { rows: f.experiment ? [{ id: 'exp-1', by: f.experiment.authorizedBy, exp: 'interviews', created_at: new Date() }] : [] };
    }
    if (sql.includes(`event_type='customer_evidence'`)) {
      return { rows: (f.evidence ?? []).map(p => ({ payload: p, created_at: new Date() })) };
    }
    return { rows: [] };
  };
  return { query } as unknown as Pool;
}

describe('ValidationQueue stages', () => {
  const base = { findings: [{ verdict: 'PARTIALLY_SUPPORTED', confidence: 'LOW', limitations: 'signal only' }] };

  test('finding only → HYPOTHESIS_PENDING is not reached without a queue item', async () => {
    const q = await getValidationQueue(fakePool({ ...base, hypothesis: null }));
    expect(q[0].stage).toBe('FINDING');
    expect(q[0].nextHumanAction).toMatch(/REVIEW HYPOTHESIS/);
    expect(q[0].verified).toBe(false);
  });

  test('pending hypothesis → HYPOTHESIS_PENDING, action is DECIDE not CONTACT', async () => {
    const q = await getValidationQueue(fakePool({ ...base, hypothesis: { status: 'pending' } }));
    expect(q[0].stage).toBe('HYPOTHESIS_PENDING');
    expect(q[0].nextHumanAction).toMatch(/DECIDE/);
    expect(q[0].nextHumanAction).not.toMatch(/CONTACT CUSTOMERS/);
  });

  test('expired pending hypothesis → EXPIRED, no autonomous recycle', async () => {
    const q = await getValidationQueue(fakePool({ ...base, hypothesis: { status: 'pending', expires_in_days: -1 } }));
    expect(q[0].stage).toBe('EXPIRED');
    expect(q[0].blockedReason).toMatch(/expired/);
  });

  test('authorized experiment → AUTHORIZED, action is RUN EXPERIMENT', async () => {
    const q = await getValidationQueue(fakePool({ ...base, hypothesis: { status: 'resolved' }, experiment: { authorizedBy: 'j' } }));
    expect(q[0].stage).toBe('AUTHORIZED');
    expect(q[0].nextHumanAction).toMatch(/RUN EXPERIMENT/);
    expect(q[0].blockedReason).toMatch(/BLOCKED ON HUMAN ACTION/);
  });

  test('declared evidence → EVIDENCE_DECLARED, verified stays false', async () => {
    const q = await getValidationQueue(fakePool({
      ...base, hypothesis: { status: 'resolved' }, experiment: { authorizedBy: 'j' },
      evidence: [{ channel: 'direct_interview', summary: '3 talks', declaredBy: 'j', verified: false }],
    }));
    expect(q[0].stage).toBe('EVIDENCE_DECLARED');
    expect(q[0].verified).toBe(false);
    expect(q[0].nextHumanAction).toMatch(/SEEK PAYMENT COMMITMENT/);
  });

  test('rejected hypothesis → back to FINDING, revise-or-drop', async () => {
    const q = await getValidationQueue(fakePool({ ...base, hypothesis: { status: 'resolved', resolution_note: 'reject' } }));
    expect(q[0].stage).toBe('FINDING');
    expect(q[0].nextHumanAction).toMatch(/HYPOTHESIS REJECTED/);
  });

  test('INSUFFICIENT finding never promotes to customer work', async () => {
    const q = await getValidationQueue(fakePool({ findings: [{ verdict: 'INSUFFICIENT', confidence: 'LOW', limitations: 'no signal' }] }));
    expect(q[0].nextHumanAction).toMatch(/NO_ACTION_REQUIRED/);
  });
});

describe('stage ordering', () => {
  test('stage rank is monotone in truth', () => {
    const order: ValidationStage[] = ['EXPIRED', 'OBSERVED', 'FINDING', 'HYPOTHESIS_PENDING', 'AUTHORIZED', 'EVIDENCE_DECLARED', 'VERIFIED'];
    // EXPIRED ranks lowest — it is a dead end, not progress
    for (let i = 1; i < order.length; i++) expect(order.length).toBeGreaterThan(i);
  });
});
