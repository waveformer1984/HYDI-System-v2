/**
 * RecoveryBudgetManager — retry-episode expiry contract.
 *
 * Defect fixed (measured live 2026-09-20): componentRetryCounts is durable
 * per-component and resets ONLY on successful recovery — but the count gates
 * whether recovery can be attempted at all. A component that exhausted its
 * budget (protoforge-core 4/3 after the phantom-recovery storm) could never
 * attempt recovery again: refused → no attempt → no success → count never
 * resets → permanent deadlock. The only exit was manual JSONL surgery.
 *
 * Contract being tested:
 *   - retryCount bounds attempts WITHIN a failure episode (lastFailureAt
 *     within retryEpisodeMs)
 *   - when the episode lapses (component quiet for the whole window — the
 *     escalation was acted on or the fault cleared), the count expires and
 *     the component becomes eligible again
 *   - expiry is a recorded state transition (durable reset record + audit
 *     event), never a silent clear
 *   - inside the window the budget still refuses (no free reset loop)
 *   - a flapping component keeps lastFailureAt fresh → stays blocked
 *   - missing lastFailureAt with a positive count fails CLOSED
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { RecoveryBudgetManager } from '../../lib/operational/RecoveryBudget';
import { DurableBudgetStore } from '../../lib/operational/DurableBudgetStore';
import { SystemStateModel } from '../../lib/operational/SystemStateModel';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'budget-episode-'));
}

/** A manager wired to a temp durable store with a controllable clock.
 * circuitBreakerThreshold is set high so these tests exercise the retry
 * budget gate specifically — the breaker has its own coverage. */
function build(nowRef: { t: number }, dir?: string) {
  const model = new SystemStateModel();
  const store = dir ? new DurableBudgetStore(dir) : null;
  const mgr = new RecoveryBudgetManager(
    model,
    { retryEpisodeMs: 3600000, circuitBreakerThreshold: 100 },
    store ?? undefined,
    () => nowRef.t,
  );
  return { mgr, store, model };
}

const INCIDENT = 'incident-x';

describe('RecoveryBudgetManager — episode contract', () => {
  it('below budget → eligible', () => {
    const now = { t: Date.now() };
    const { mgr } = build(now);
    mgr.recordAttempt('svc', INCIDENT, false);
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(true);
  });

  it('at budget boundary (3/3) → refused', () => {
    const now = { t: Date.now() };
    const { mgr } = build(now);
    for (let i = 0; i < 3; i++) mgr.recordAttempt('svc', INCIDENT, false);
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(false);
    expect(mgr.canRecover('svc', INCIDENT).reason).toMatch(/retry budget exhausted/);
  });

  it('above budget (the live 4/3 case) → refused while episode is live', () => {
    const now = { t: Date.now() };
    const { mgr } = build(now);
    for (let i = 0; i < 4; i++) mgr.recordAttempt('svc', INCIDENT, false);
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(false);
  });

  it('repeated genuine failures still exhaust the budget', () => {
    const now = { t: Date.now() };
    const { mgr } = build(now);
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(true);
    mgr.recordAttempt('svc', INCIDENT, false);
    mgr.recordAttempt('svc', INCIDENT, false);
    mgr.recordAttempt('svc', INCIDENT, false);
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(false);
  });

  it('a refused request is not itself an attempt — refusal does not consume or reset budget', () => {
    const now = { t: Date.now() };
    const { mgr } = build(now);
    for (let i = 0; i < 3; i++) mgr.recordAttempt('svc', INCIDENT, false);
    const before = mgr.getStats('svc').retries;
    mgr.canRecover('svc', INCIDENT); // refused — must not mutate
    mgr.canRecover('svc', INCIDENT);
    expect(mgr.getStats('svc').retries).toBe(before);
  });

  it('successful recovery resets the count (existing transition preserved)', () => {
    const now = { t: Date.now() };
    const { mgr } = build(now);
    mgr.recordAttempt('svc', INCIDENT, false);
    mgr.recordAttempt('svc', INCIDENT, false);
    mgr.resetComponentRetries('svc'); // the recover()-success path
    expect(mgr.getStats('svc').retries).toBe(0);
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(true);
  });

  it('expired episode → eligible again (no permanent deadlock)', () => {
    const now = { t: Date.now() };
    const { mgr } = build(now);
    for (let i = 0; i < 4; i++) mgr.recordAttempt('svc', INCIDENT, false);
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(false);
    // Episode lapses: 1h+1ms after the last failure
    now.t += 3600000 + 1;
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(true);
  });

  it('within the window a restart still restores the exhausted count (persistence meaningful)', () => {
    const now = { t: Date.now() };
    const dir = mkTmpDir();
    const a = build(now, dir);
    for (let i = 0; i < 4; i++) a.mgr.recordAttempt('svc', INCIDENT, false);
    // "restart": a fresh manager + store over the same JSONL, same clock
    const b = build(now, dir);
    expect(b.mgr.canRecover('svc', INCIDENT).allowed).toBe(false);
  });

  it('after the window a restarted manager sees an expired episode — auditable reset', () => {
    const now = { t: Date.now() };
    const dir = mkTmpDir();
    const a = build(now, dir);
    for (let i = 0; i < 4; i++) a.mgr.recordAttempt('svc', INCIDENT, false);
    now.t += 3600000 + 1;
    const b = build(now, dir); // restore-time expiry
    const c = b.mgr.canRecover('svc', INCIDENT);
    expect(c.allowed).toBe(true);
    // The expiry must be recorded, not silent: durable store shows a reset
    // record and the audit event names the expired episode.
    const durable = b.store!.getState('svc');
    expect(durable!.retryCount).toBe(0);
    const events = b.model.getEventsByType('budget_episode_expired');
    expect(events.length).toBe(1);
    expect(events[0].detail.previousRetryCount).toBe(4);
  });

  it('flapping component keeps the episode live → stays blocked; quiet window lapses → renews', () => {
    const now = { t: Date.now() };
    const { mgr } = build(now);
    for (let i = 0; i < 3; i++) mgr.recordAttempt('svc', INCIDENT, false);
    now.t += 3000000; // 50min — still inside window
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(false);
    // Activity inside the window refreshes the episode anchor
    mgr.recordAttempt('svc', INCIDENT, false);
    now.t += 3000000; // 50min since that attempt — still inside window
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(false);
    // ...and only a FULL quiet window renews the budget
    now.t += 3600000 + 1;
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(true);
  });

  it('positive count with missing lastFailureAt fails closed', () => {
    const now = { t: Date.now() };
    const dir = mkTmpDir();
    // Hand-craft a durable record with a spent count but no timestamp —
    // an unbounded-age episode cannot be proven over, so it stays enforced.
    const store = new DurableBudgetStore(dir);
    store.updateState('svc', { retryCount: 4, lastFailureAt: null });
    const { mgr } = build(now, dir);
    expect(mgr.canRecover('svc', INCIDENT).allowed).toBe(false);
  });

  it('two managers sharing one durable store cannot double-spend the budget', () => {
    const now = { t: Date.now() };
    const dir = mkTmpDir();
    const a = build(now, dir);
    a.mgr.recordAttempt('svc', INCIDENT, false);
    a.mgr.recordAttempt('svc', INCIDENT, false);
    a.mgr.recordAttempt('svc', INCIDENT, false);
    // Second process sees the persisted count
    const b = build(now, dir);
    expect(b.mgr.canRecover('svc', INCIDENT).allowed).toBe(false);
  });
});
