/**
 * Action chokepoint (Phase 3).
 *
 * Problem being closed (HYDI_BASELINE.json, 2026-09-18): five independent
 * execution paths with no shared governance boundary. The most dangerous was
 * lib/action-executor.ts -- it dispatches six action types including
 * `send_email`, which POSTs to api.resend.com and sends REAL outbound mail,
 * with no risk classification and no authorization of any kind. Its only guard
 * was "is RESEND_API_KEY configured".
 *
 * Why this file gates lib/action-executor.ts specifically: it is where Paths D
 * and E converge. lib/agents/base-agent.ts:51 routes every agent action through
 * it, lib/orchestrator.ts uses it as the fallback executor, and
 * lib/action-approval.ts:82 executes approved actions through it. One guard
 * here covers all three.
 *
 * Path C (heidi-core/actions/action-executor.js) is a DIFFERENT class with its
 * own allowlists and is out of scope here -- stated so that coverage is not
 * overclaimed.
 *
 * The invariant: an action's risk decides whether it may run autonomously, and
 * anything above the autonomous tier requires producible evidence of approval.
 * Unknown action types fail closed at R5.
 */

import { evaluateAction, ACTION_RISK } from '../../lib/governance/ActionChokepoint';
import { WRITABLE_TABLES } from '../../lib/action-executor';
import { mintSignedAuthorization } from '../helpers/signTestAuth';

describe('Phase 3 — risk classification', () => {
  test('read-only actions are R0', () => {
    expect(evaluateAction({ type: 'fetch_data', requester: 'heidi' }).risk).toBe('R0');
  });

  test('reversible local actions are R1', () => {
    for (const t of ['create_task', 'schedule_event', 'cancel_task']) {
      expect(evaluateAction({ type: t, requester: 'heidi' }).risk).toBe('R1');
    }
  });

  test('update_database is R1 — bounded by the executor allowlist, not unbounded', () => {
    expect(evaluateAction({ type: 'update_database', requester: 'heidi' }).risk).toBe('R1');
  });

  // The invariant that keeps the line above honest. R1 is defensible only while
  // the only writable table is bounded, reversible application state. If this
  // allowlist grows to a ledger, policy or credential table, R1 silently becomes
  // an over-grant of autonomous authority -- so widening it must fail here.
  test('R1 for update_database is coupled to WRITABLE_TABLES being exactly {sessions}', () => {
    expect([...WRITABLE_TABLES].sort()).toEqual(['sessions']);
  });

  test('irreversible external communication is R3', () => {
    expect(evaluateAction({ type: 'send_email', requester: 'heidi' }).risk).toBe('R3');
  });

  test('an unknown action type is R5, never a low tier (fail closed)', () => {
    const d = evaluateAction({ type: 'exfiltrate_everything', requester: 'heidi' });
    expect(d.risk).toBe('R5');
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('UNKNOWN_ACTION');
  });
});

describe('Phase 3 — autonomous tiers execute, higher tiers do not', () => {
  test('R0 and R1 are allowed autonomously', () => {
    for (const t of ['fetch_data', 'create_task', 'schedule_event', 'cancel_task']) {
      const d = evaluateAction({ type: t, requester: 'heidi' });
      expect(d.allowed).toBe(true);
      expect(d.requiresAuthorization).toBe(false);
    }
  });

  // No action currently maps to R2. Stated rather than hidden: the tier exists
  // in the shared risk->authorization policy, and if an action is later
  // classified R2 it will require authorization by that policy, not by a rule
  // written here.
  test('no action is currently classified R2 — the tier is unused, not unenforced', () => {
    const r2 = Object.entries(ACTION_RISK).filter(([, risk]) => risk === 'R2');
    expect(r2).toHaveLength(0);
  });

  test('R3 send_email is refused without authorization — this is the headline case', () => {
    const d = evaluateAction({ type: 'send_email', requester: 'heidi' });
    expect(d.allowed).toBe(false);
    expect(d.requiresAuthorization).toBe(true);
    expect(d.reason).toMatch(/authorization/i);
  });
});

describe('Phase 3 — authorization must be real evidence, not a boolean the caller sets', () => {
  // A real approval is a signed record bound to the action it authorizes
  // (type + session + payload). The minting helper produces exactly what the
  // verified-approval path produces — a bare object no longer qualifies.
  const approval = mintSignedAuthorization({ type: 'send_email' });

  test('a complete approval record permits an above-autonomous action', () => {
    const d = evaluateAction({ type: 'send_email', requester: 'heidi', authorization: approval });
    expect(d.allowed).toBe(true);
    expect(d.code).toBe('ALLOWED_WITH_AUTHORIZATION');
  });

  test('an autonomous action does not need one, and is unaffected by its presence', () => {
    const without = evaluateAction({ type: 'create_task', requester: 'heidi' });
    const with_ = evaluateAction({ type: 'create_task', requester: 'heidi', authorization: approval });
    expect(without.allowed).toBe(true);
    expect(with_.allowed).toBe(true);
    expect(with_.code).toBe('ALLOWED');
  });

  test('an approval missing approvedBy is rejected', () => {
    const d = evaluateAction({
      type: 'send_email',
      requester: 'heidi',
      authorization: { approvalRef: 'x', grantedAt: approval.grantedAt } as any,
    });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('INVALID_AUTHORIZATION');
  });

  test('an approval missing approvalRef is rejected — an unreferenced approval is unauditable', () => {
    const d = evaluateAction({
      type: 'send_email',
      requester: 'heidi',
      authorization: { approvedBy: 'user:owner', grantedAt: approval.grantedAt } as any,
    });
    expect(d.allowed).toBe(false);
    expect(d.code).toBe('INVALID_AUTHORIZATION');
  });

  test('a truthy non-object authorization does not work', () => {
    for (const bogus of [true, 1, 'approved', {}]) {
      const d = evaluateAction({ type: 'send_email', requester: 'heidi', authorization: bogus as any });
      expect(d.allowed).toBe(false);
    }
  });

  test('authorization cannot elevate an R5 action, however well-formed', () => {
    const d = evaluateAction({ type: 'unknown_thing', requester: 'heidi', authorization: approval });
    expect(d.allowed).toBe(false);
    expect(d.risk).toBe('R5');
    // The gate distinguishes "unmodelled" from "modelled and forbidden" -- both
    // are R5 and neither is executable, but the operator needs to know which,
    // because the remedies differ (classify it vs. don't do it).
    expect(d.code).toBe('UNKNOWN_ACTION');
    expect(d.reason).toMatch(/not in the action risk map/i);
  });
});

describe('Phase 3 — every decision is auditable', () => {
  test('a decision carries the fields the contract requires', () => {
    const d = evaluateAction({ type: 'send_email', requester: 'heidi', reason: 'follow up with lead', target: 'a@b.com' });
    expect(d.actionId).toBeTruthy();
    expect(d.risk).toBe('R3');
    expect(d.requester).toBe('heidi');
    expect(d.timestamp).toBeTruthy();
    expect(typeof d.reason).toBe('string');
    expect(d.reason.length).toBeGreaterThan(10);
  });

  test('the risk map is non-empty and covers every type ActionExecutor dispatches', () => {
    for (const t of ['create_task', 'fetch_data', 'update_database', 'schedule_event', 'send_email', 'cancel_task']) {
      expect(ACTION_RISK[t]).toBeTruthy();
    }
  });
});
