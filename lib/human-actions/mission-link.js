'use strict';

/**
 * Human Action ↔ Mission/Goal linkage — the bridge that makes
 * "waiting on a human" a durable, resumable state instead of a dead end.
 *
 * Status mapping (existing machinery, no schema change):
 *   goal.status='escalated' + context.waitingOnHuman=true
 *     ⇔ WAITING_ON_HUMAN. MissionRunner already settles human-gated
 *     failures as mission 'waiting_human' + goal 'escalated' through
 *     classifyFailure ('human_required' → governance). This module adds
 *     the missing half: the durable Human Action + the resume path.
 *
 * Resume semantics: a satisfied prerequisite flips the goal back to
 * 'pending'. The cognitive cycle's planner then re-dispatches it and the
 * MissionLedger re-claims the same mission row (workSlot=goalId) —
 * execution continues from durable state, not from a fresh start. The
 * capability itself resumes at its checkpoint (e.g. the Rezonate adapter
 * re-verifies an existing deployment instead of redeploying).
 *
 * Multi-blocker: a goal resumes only when EVERY linked action is
 * RESOLVED. One resolved + one open → still WAITING_ON_HUMAN, and the
 * report says exactly which prerequisite remains.
 *
 * All goal access goes through the injected `goals` object
 * ({ getGoal, updateGoal }) — a real GoalSystem in production, a fake in
 * tests. Nothing here writes goal state without evidence.
 */

function now() { return new Date().toISOString(); }

/**
 * Attach a human boundary to a goal: create/dedupe the Human Action and
 * mark the goal as waiting on it. Idempotent on blockerKey — repeated
 * calls with the same blocker return the existing action.
 */
async function attachBlockerToGoal(service, goals, { goalId, missionId, blockerKey, spec, actor }) {
  const { action, created } = service.request({
    ...spec,
    blockerKey,
    source: spec.source || 'mission',
    sourceGoalId: goalId,
    sourceMissionId: missionId || spec.sourceMissionId || null,
  });
  // Dedupe path: a pre-existing open action has no sourceGoalId — backfill
  // it so the resume sweep can find this goal either direction.
  if (!created && !action.sourceGoalId && typeof service.linkGoal === 'function') {
    service.linkGoal(action.id, goalId, actor || 'system');
  }
  // Spec refresh: the system may learn more about a boundary after the
  // action was seeded (a second accepted env var, better instructions).
  // The amendment is audited on the action; the verifier stays closed.
  if (!created && typeof service.amendSpec === 'function') {
    service.amendSpec(action.id, {
      verifier: spec.verifier, instructions: spec.instructions, actor: actor || 'system',
    });
  }
  const goal = await goals.getGoal(goalId);
  if (!goal) return { action, created, goal: null, error: `goal ${goalId} not found` };
  const ctx = { ...(goal.context || {}) };
  // Already linked and parked — attaching again must not pile up
  // duplicate escalations or evidence rows.
  if (ctx.waitingOnHuman && (ctx.humanActions || []).includes(action.id)) {
    return { action, created: false, goal, relinked: true };
  }
  const ids = new Set(ctx.humanActions || []);
  ids.add(action.id);
  ctx.humanActions = [...ids];
  ctx.waitingOnHuman = true;
  ctx.humanBlockerKeys = [...new Set([...(ctx.humanBlockerKeys || []), blockerKey].filter(Boolean))];
  const updated = await goals.updateGoal(goalId, {
    status: 'escalated',
    context: ctx,
    evidence: [{
      at: now(), runner: 'human-actions', type: 'WAITING_ON_HUMAN',
      humanActionId: action.id, blockerKey, actor: actor || 'system',
    }],
  });
  return { action, created, goal: updated };
}

/**
 * Resume sweep — for every goal parked on human actions, check whether
 * all linked actions are RESOLVED. Satisfied goals go back to 'pending'
 * so the next planning cycle re-dispatches them. Resolution of the
 * prerequisite is never reported as goal completion.
 */
async function resumeSatisfiedGoals(service, goals, { actor } = {}) {
  const db = service.list({ includeTerminal: true });
  const byId = new Map(db.map((a) => [a.id, a]));
  const linkedGoalIds = new Set(db.map((a) => a.sourceGoalId).filter(Boolean));
  // Goals parked on human actions are the authoritative wait-set — covers
  // links made before sourceGoalId backfill existed, and multi-link cases.
  const escalated = await goals.listGoals({ status: 'escalated', limit: 100 }).catch(() => []);
  for (const g of escalated) {
    if (g.context?.waitingOnHuman) linkedGoalIds.add(g.goalId);
  }
  const resumed = [];
  const stillWaiting = [];
  for (const goalId of linkedGoalIds) {
    const goal = await goals.getGoal(goalId).catch(() => null);
    if (!goal || !goal.context?.waitingOnHuman) continue;
    const linkedIds = new Set([
      ...(goal.context.humanActions || []),
      ...db.filter((a) => a.sourceGoalId === goalId).map((a) => a.id),
    ]);
    const linked = [...linkedIds].map((id) => byId.get(id)).filter(Boolean);
    const open = linked.filter((a) => !['RESOLVED', 'CANCELLED'].includes(a.status));
    const satisfied = linked.filter((a) => a.status === 'RESOLVED');
    if (open.length === 0 && satisfied.length > 0 && goal.status === 'escalated') {
      const ctx = { ...goal.context, waitingOnHuman: false, humanResolvedAt: now() };
      await goals.updateGoal(goalId, {
        status: 'pending',
        context: ctx,
        evidence: [{
          at: now(), runner: 'human-actions', type: 'HUMAN_PREREQUISITE_SATISFIED',
          resumedBy: actor || 'human-actions/resume',
          resolvedActionIds: satisfied.map((a) => a.id),
          verificationIds: satisfied.map((a) => a.verification?.verificationId).filter(Boolean),
          detail: 'all linked human actions RESOLVED — goal returned to runnable queue; prerequisite satisfied ≠ goal complete',
        }],
      }).then((g) => resumed.push({ goalId, actionIds: satisfied.map((a) => a.id), resumed: !!g }))
        .catch(() => stillWaiting.push({ goalId, reason: 'goal update failed' }));
    } else if (open.length > 0) {
      stillWaiting.push({
        goalId,
        satisfiedCount: satisfied.length,
        totalLinked: linked.length,
        waiting: open.map((a) => ({ actionId: a.id, blockerKey: a.blockerKey, status: a.status, missing: a.verification?.failureReason || a.lastError || null })),
      });
    }
  }
  return { resumed, stillWaiting };
}

/**
 * Scan escalated goals for human boundaries that have no linked action
 * yet — the catch-up path for boundaries hit before this module existed.
 * Reasons are matched to known verifiers; unmatched escalations get a
 * manual-attestation action (honest: no machine check exists for it).
 */
async function scanEscalatedGoals(service, goals, { listEscalated } = {}) {
  const escalated = listEscalated
    ? await listEscalated()
    : await goals.listGoals({ status: 'escalated', limit: 100 }).catch(() => []);
  const linked = [];
  for (const goal of escalated) {
    const ctx = goal.context || {};
    if (ctx.waitingOnHuman) { continue; } // already linked
    const reason = `${goal.title || ''} ${goal.result || ''}`;
    if (!/human|credential|authoriz|approv|external|manual|fund/i.test(reason)) continue;
    const known = matchKnownBlocker(reason);
    const spec = known || {
      title: `Human attention required: ${String(goal.title).slice(0, 120)}`,
      type: 'escalated-goal',
      description: `Goal escalated: ${String(goal.result || goal.title).slice(0, 300)}`,
      instructions: ['Review the goal evidence, perform the required human step, then ask Heidi to verify or attest.'],
      verifier: { name: 'manual', spec: {} },
      priority: 'normal',
    };
    const r = await attachBlockerToGoal(service, goals, {
      goalId: goal.goalId,
      blockerKey: `goal:${goal.goalId}`,
      spec,
      actor: 'goal-scan',
    });
    if (!r.error) linked.push(r.action.id);
  }
  return { scanned: escalated.length, linked };
}

/** Map an escalation reason onto a known verifier spec, if one fits. */
function matchKnownBlocker(reason) {
  if (/REZONATE_CHAIN_RPC|REZONATE_DEPLOYER_KEY|REZONATE_BUYER_KEY/i.test(reason)) {
    const { REZONATE_TESTNET_SPEC } = require('./detector');
    return { ...REZONATE_TESTNET_SPEC, sourceMissionId: undefined };
  }
  return null;
}

module.exports = { attachBlockerToGoal, resumeSatisfiedGoals, scanEscalatedGoals };
