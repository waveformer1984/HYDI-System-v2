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
    ['show me the evidence', 'evidence'],
    ['why did you choose that next action?', 'why'],
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

  test('revenue answer never claims reconciled revenue', () => {
    const out = answerFromCooState(state(), 'revenue', false);
    expect(out).toMatch(/no reconciled revenue/i);
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
