/**
 * CooBriefing tests — the executive voice must be deterministic, honest
 * about staleness, and incapable of fabricating state (it only formats
 * what the persisted coo_state row contains).
 */

import {
  classifyCooIntent,
  answerFromCooState,
  formatCooBrief,
  COO_STALENESS_MS,
} from '../../lib/heidi/CooBriefing';
import type { CooState } from '../../lib/heidi/CooState';

function state(over: Partial<CooState> = {}): CooState {
  return {
    generatedAt: '2026-09-22T16:19:09Z',
    deployment: {
      verdict: 'QUALIFIED', identity: 'VALID', expectedCommit: 'e386e7c',
      actualCommit: 'e386e7c', pm2Pid: 5424, daemonPid: 29404, failures: [],
    },
    applicationHealth: 'HEALTHY',
    work: { goalsOpen: 1, goalsInProgress: 1, escalationsOpen: 7222, escalationsNew24h: 0, interventionsPending: 0, authEscalations24h: 0 },
    humanActions: { open: 0, backlogRowCount: 7222, items: [] },
    agents: { active: 0, stale: 0, missionsByStatus: {}, recent: [] },
    protoforge: { lastRunAt: '2026-09-22T14:10:08Z', lastRunStatus: 'success', opportunitiesTotal: 81, pendingReview: 81, approved: 0 },
    revenue: { opportunitiesOpen: 2 },
    events24h: { cognitive_cycle: 40 },
    nextAction: { kind: 'none', reason: 'no authorized work required' },
    briefing: '',
    ...over,
  };
}

describe('classifyCooIntent', () => {
  test.each([
    ["how's it going?", 'status'],
    ['give me a status report', 'status'],
    ['what needs my attention?', 'attention'],
    ['what do you need from me?', 'attention'],
    ['what are you working on?', 'activity'],
    ['what happened today?', 'activity'],
    ['what failed?', 'failure'],
    ['what broke overnight?', 'failure'],
    ['what is ProtoForge finding?', 'protoforge'],
    ['what is blocking revenue?', 'revenue'],
    ['what can I sell?', 'revenue'],
    ['show me checkout-ready offers', 'revenue'],
    ['show me the evidence', 'evidence'],
    ['why did you choose that next action?', 'why'],
    ['what do you need to be better?', 'needs'],
    ['what would make you more capable?', 'needs'],
    ['what are your biggest limitations right now?', 'needs'],
    ["what's holding you back?", 'needs'],
  ])('"%s" → %s', (msg, expected) => {
    expect(classifyCooIntent(msg)).toBe(expected);
  });

  test.each([
    'write a poem about dogs',
    'schedule a meeting for Tuesday',
    'restart the daemon', // an INSTRUCTION is not a COO question — no silent authority
  ])('non-operational "%s" → null', (msg) => {
    expect(classifyCooIntent(msg)).toBeNull();
  });
});

describe('answerFromCooState', () => {
  test('status returns the full §12 brief with real fields', () => {
    const out = answerFromCooState(state(), 'status', false);
    expect(out).toContain('HEIDI COO BRIEF');
    expect(out).toContain('e386e7c');
    expect(out).toContain('NO_ACTION_REQUIRED');
    expect(out).toContain('81 pending review');
  });

  test('attention with nothing pending says so and discloses backlog', () => {
    const out = answerFromCooState(state(), 'attention', false);
    expect(out).toMatch(/nothing needs your attention/i);
    expect(out).toContain('7222');
  });

  test('attention lists real queue items with source and reason', () => {
    const s = state({
      humanActions: {
        open: 1,
        backlogRowCount: 7222,
        items: [{
          id: 'intervention:req-1', source: 'intervention', category: 'credential', priority: 1,
          status: 'OPEN', reason: 'missing Stripe key', requestedAction: 'provision key',
          evidence: {}, authorizationLevel: 'R3', backlog: false,
          createdAt: 't', updatedAt: 't',
        }],
      },
    });
    const out = answerFromCooState(s, 'attention', false);
    expect(out).toContain('1 pending human action');
    expect(out).toContain('missing Stripe key');
    expect(out).toContain('7222');
  });

  test('stale snapshot is disclosed, never presented as current', () => {
    const out = answerFromCooState(state(), 'status', true);
    expect(out).toContain('SNAPSHOT STALE');
    expect(out).toContain('2026-09-22T16:19:09Z');
  });

  test('needs answers from durable state — customer boundary, capability decisions, self-directed work', () => {
    const s = state({
      humanActions: {
        open: 3,
        backlogRowCount: 7222,
        items: [
          {
            id: 'offer:o1', source: 'commercial_offer', category: 'customer_required', priority: 1,
            status: 'OPEN', reason: 'offer-acf357e977ba CHECKOUT_READY — cannot advance: no legitimate customer identity',
            requestedAction: 'provide customer identity', evidence: { offerId: 'offer-acf357e977ba' },
            authorizationLevel: 'R2', backlog: false, createdAt: 't', updatedAt: 't'
          },
          {
            id: 'auth:cap1', source: 'authorization_escalation', category: 'capability_authorization', priority: 1,
            status: 'OPEN', reason: 'grant or dismiss authorization for ops.agent_supervise',
            requestedAction: 'decide', evidence: {}, authorizationLevel: 'R3', backlog: false, createdAt: 't', updatedAt: 't'
          },
          {
            id: 'int:1', source: 'intervention', category: 'customer_validation_hypothesis', priority: 1,
            status: 'OPEN', reason: 'Customer contact requires explicit human approval',
            requestedAction: 'run interviews', evidence: {}, authorizationLevel: 'R3', backlog: false, createdAt: 't', updatedAt: 't'
          },
        ],
      },
      nextAction: { kind: 'capability', capabilityId: 'ops.recover_daemon_r0', reason: 'deployment drift detected' },
      deployment: { ...state().deployment, verdict: 'DEPLOYMENT_DRIFT' },
    });
    const out = answerFromCooState(s, 'needs', false);
    expect(out).toContain('a real customer email');
    expect(out).toContain('offer-acf357e977ba');
    expect(out).toContain('1 capability authorization decision');
    expect(out).toContain('1 other human decision');
    expect(out).toContain('ops.recover_daemon_r0');
    expect(out).toContain('DEPLOYMENT_DRIFT');
  });

  test('needs with a clean queue says nothing is needed', () => {
    const out = answerFromCooState(state(), 'needs', false);
    expect(out).toContain('nothing pending right now');
  });

  test('revenue answer never claims reconciled revenue', () => {
    const out = answerFromCooState(state(), 'revenue', false);
    expect(out).toMatch(/no reconciled revenue/i);
  });

  test('brief renders agents and recent missions from durable state', () => {
    const s = state({
      agents: {
        active: 2, stale: 0,
        missionsByStatus: { RUNNING: 1, COMPLETED: 2 },
        recent: [
          { missionId: 'mission-aaaa1111', role: 'ops', status: 'RUNNING', objective: 'sync world model' },
          { missionId: 'mission-bbbb2222', role: 'scout', status: 'COMPLETED', objective: 'scan opportunities' },
        ],
      },
    });
    const out = formatCooBrief(s, false);
    expect(out).toContain('AGENTS:      2 active · 0 stale · missions: 1 running, 2 completed');
    expect(out).toMatch(/RECENT:.*\[COMPLETED\] mission-.*\[RUNNING\] mission-/s);
    expect(out).toContain('scan opportunities');
  });

  test('revenue answer reports offer stages and the real boundary', () => {
    const s = state({
      revenue: {
        opportunitiesOpen: 2,
        offers: {
          total: 2,
          byStage: { AUTHORIZATION_REQUIRED: 1, RECONCILED: 1 },
          boundary: [{ offerId: 'offer-abc', stage: 'AUTHORIZATION_REQUIRED', reason: 'no customer identity' }],
        },
      },
    });
    const out = answerFromCooState(s, 'revenue', false);
    expect(out).toContain('1 AUTHORIZATION_REQUIRED');
    expect(out).toContain('offer-abc');
    expect(out).toContain('no customer identity');
    expect(out).toMatch(/no reconciled revenue/i);
  });

  test('snapshots without the offers field degrade gracefully', () => {
    const out = answerFromCooState(state(), 'revenue', false);
    expect(out).toContain('no offers');
  });

  test('revenue answer names sellable CHECKOUT_READY offers', () => {
    const s = state({
      revenue: {
        opportunitiesOpen: 2,
        offers: {
          total: 1,
          byStage: { CHECKOUT_READY: 1 },
          boundary: [],
          ready: [{ offerId: 'offer-a1', product: 'protoforge_model_prep', priceCents: 2900, currency: 'usd' }],
        },
      },
    });
    const out = answerFromCooState(s, 'revenue', false);
    expect(out).toContain('ready: offer-a1 protoforge_model_prep $29.00 usd');
    expect(out).toMatch(/no reconciled revenue/i);
    // sellable offers → the governed sell path is explained, not just named
    expect(out).toMatch(/customer's email/i);
    expect(out).toMatch(/revenue\.advance_offer proposal/);
    expect(out).toMatch(/approval/i);
  });

  test('revenue answer gives no sell-path instructions when nothing is sellable', () => {
    const s = state({
      revenue: { opportunitiesOpen: 2, offers: { total: 0, byStage: {}, boundary: [], ready: [] } },
    });
    const out = answerFromCooState(s, 'revenue', false);
    expect(out).not.toMatch(/customer's email/i);
  });

  test('attention flags pending proposals and points to the ACTIONS tab', () => {
    const s = state({
      humanActions: {
        open: 1, backlogRowCount: 0,
        items: [{
          id: 'proposal:p1', source: 'action_proposal', category: 'revenue.advance_offer',
          priority: 1, status: 'OPEN', reason: 'Advance offer offer-x',
          requestedAction: 'review and decide in the ACTIONS tab', evidence: {},
          authorizationLevel: 'R2', backlog: false, createdAt: 't', updatedAt: 't',
        }],
      },
    });
    const out = answerFromCooState(s, 'attention', false);
    expect(out).toContain('action_proposal');
    expect(out).toContain('1 governed action proposal(s)');
    expect(out).toContain('ACTIONS tab');
  });

  test('activity intent reports recent missions', () => {
    const s = state({
      agents: {
        active: 1, stale: 0, missionsByStatus: { COMPLETED: 1 },
        recent: [{ missionId: 'mission-x9', role: 'ops', status: 'COMPLETED', objective: 'world sync' }],
      },
    });
    const out = answerFromCooState(s, 'activity', false);
    expect(out).toContain('[COMPLETED]');
    expect(out).toContain('world sync');
  });

  test('protoforge answer keeps the intelligence≠demand distinction', () => {
    const out = answerFromCooState(state(), 'protoforge', false);
    expect(out).toMatch(/not validated demand/i);
  });

  test('failure intent reports real predicate failures', () => {
    const s = state({
      deployment: { ...state().deployment, verdict: 'DEPLOYMENT_DRIFT', failures: ['PID_MATCHES'] },
    });
    expect(answerFromCooState(s, 'failure', false)).toContain('PID_MATCHES');
  });

  test('why intent explains the deterministic selection', () => {
    const out = answerFromCooState(state(), 'why', false);
    expect(out).toContain('deterministic');
  });

  test('staleness constant exceeds the 30min cadence', () => {
    expect(COO_STALENESS_MS).toBeGreaterThan(30 * 60 * 1000);
  });
});
