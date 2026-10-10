'use strict';

/**
 * Blocker inventory — the system-wide audit that proves no eligible
 * blocker is silently abandoned.
 *
 * Sources of durable blocked state:
 *   1. detector RULES         — env/config boundaries, checked live
 *   2. durable action store   — every materialized blocker
 *   3. governed-elsewhere     — proposals / escalations / interventions
 *     live in their own queues (human DECISIONS, not external
 *     prerequisites); they are counted as governed, never duplicated
 *     into Human Actions
 *
 * For every item the inventory reports exactly one disposition:
 *   HA-ELIGIBLE      — is (or should be) a durable Human Action
 *   GOVERNED-ELSEWHERE — tracked by its own governed queue
 *   POLICY-BLOCKED   — R4: prohibited, fail-closed
 *   HUMAN-ONLY       — R2/R3: needs authority/physical action no
 *                      connected system holds
 *   UNCLASSIFIED     — should be ZERO; anything else is a defect
 */

const { classifyAction, RESOLUTION_POLICY } = require('./resolver-policy');
const { RULES } = require('./detector');
const { envNamePresent, envValue } = require('./verifiers');
const { HumanActionService } = require('./service');

const PRODUCTION_BOUNDARY_KEYS = new Set([
  'stripe:live-credential', 'protoforge:public-base-url',
  'stripe:live-webhook-endpoint', 'stripe:webhook-processing',
]);

/**
 * Full inventory. svc/env injectable for hermetic tests.
 * Returns a compact, secret-safe audit object.
 */
function inventoryBlockers({ service, env } = {}) {
  const svc = service || new HumanActionService();
  const e = env || { envNamePresent, envValue };
  const t = new Date().toISOString();

  // ── 1. Detector rules — every known boundary, active or clear ──────
  const rules = RULES.map((r) => ({
    blockerKey: r.key,
    active: !!r.active(e, svc),
    hasPolicy: !!RESOLUTION_POLICY[r.key],
    resolutionClass: RESOLUTION_POLICY[r.key]?.resolutionClass ?? 'fallback',
  }));

  // ── 2. Durable actions — classified coverage ────────────────────────
  const all = svc.list({ includeTerminal: true });
  const open = svc.listOpen();
  const byClass = { R0: 0, R1: 0, R2: 0, R3: 0, R4: 0, unclassified: 0 };
  const openItems = [];
  for (const a of open) {
    const cls = a.resolver?.resolutionClass || classifyAction(a).resolutionClass;
    byClass[cls in byClass ? cls : 'unclassified']++;
    openItems.push({
      actionId: a.id, blockerKey: a.blockerKey, status: a.status,
      resolutionClass: cls, resolverId: a.resolver?.resolverId ?? null,
      lastOutcome: a.resolver?.lastOutcome ?? null,
      verifier: a.verifier?.name ?? null,
      owner: a.owner ?? 'operator',
      priority: a.priority ?? 'normal',
    });
  }

  // ── 3. Dispositions — every open action lands in exactly one ────────
  const dispositions = { 'HA-ELIGIBLE-ARMED': 0, 'HUMAN-ONLY': 0, 'POLICY-BLOCKED': 0, 'UNCLASSIFIED': 0 };
  for (const i of openItems) {
    if (i.resolutionClass === 'R0' || i.resolutionClass === 'R1') dispositions['HA-ELIGIBLE-ARMED']++;
    else if (i.resolutionClass === 'R4') dispositions['POLICY-BLOCKED']++;
    else if (i.resolutionClass === 'R2' || i.resolutionClass === 'R3') dispositions['HUMAN-ONLY']++;
    else dispositions['UNCLASSIFIED']++;
  }

  // ── 4. Anomalies ────────────────────────────────────────────────────
  const openKeys = new Set();
  const duplicates = [];
  for (const a of open) {
    if (a.blockerKey && openKeys.has(a.blockerKey)) duplicates.push(a.blockerKey);
    openKeys.add(a.blockerKey);
  }

  const waitingHuman = openItems.filter((i) => i.resolutionClass === 'R2' || i.resolutionClass === 'R3');
  const verifying = openItems.filter((i) => i.status === 'VERIFYING');
  const resolving = openItems.filter((i) => i.resolutionClass === 'R0' || i.resolutionClass === 'R1');
  const recentlyResolved = all
    .filter((a) => a.status === 'RESOLVED')
    .sort((x, y) => String(y.completedAt || '').localeCompare(String(x.completedAt || '')))
    .slice(0, 10)
    .map((a) => ({ actionId: a.id, blockerKey: a.blockerKey, completedAt: a.completedAt, resolution: a.resolution }));

  return {
    generatedAt: t,
    rules: {
      total: rules.length,
      active: rules.filter((r) => r.active).map((r) => r.blockerKey),
      clear: rules.filter((r) => !r.active).map((r) => r.blockerKey),
    },
    actions: {
      total: all.length,
      open: open.length,
      byClass,
      dispositions,
      duplicatesPrevented: duplicates.length === 0,
      duplicateKeys: duplicates,
    },
    waiting: { onHuman: waitingHuman.length, verifying: verifying.length, resolving: resolving.length },
    blocking: {
      revenue: openItems.filter((i) => PRODUCTION_BOUNDARY_KEYS.has(i.blockerKey) || /^(revenue:|payment-signal:)/.test(i.blockerKey || '')).length,
      production: openItems.filter((i) => PRODUCTION_BOUNDARY_KEYS.has(i.blockerKey)).length,
    },
    recentlyResolved,
    openItems,
  };
}

/**
 * One-line-per-section briefing block for COO/chat surfaces.
 * Durable counts only — never an LLM narrative.
 */
function formatInventoryBrief(inv) {
  const b = inv.actions.byClass;
  const lines = [
    'Human Actions',
    '-------------',
    `Open: ${inv.actions.open}  ·  resolving: ${inv.waiting.resolving} (R0/R1)  ·  waiting on you: ${inv.waiting.onHuman} (R2/R3)  ·  verifying: ${inv.waiting.verifying}`,
    `Blocking revenue: ${inv.blocking.revenue}  ·  blocking production: ${inv.blocking.production}`,
    `Recently resolved: ${inv.recentlyResolved.length}${inv.recentlyResolved.length ? ` (latest: ${inv.recentlyResolved[0].blockerKey} ${inv.recentlyResolved[0].completedAt?.slice(0, 16) || ''})` : ''}`,
    `Classes: R0=${b.R0} R1=${b.R1} R2=${b.R2} R3=${b.R3} R4=${b.R4} unclassified=${b.unclassified}`,
    inv.actions.duplicatesPrevented ? 'Dedupe: clean (no duplicate open actions per blocker)' : `Dedupe violations: ${inv.actions.duplicateKeys.join(', ')}`,
  ];
  return lines.join('\n');
}

module.exports = { inventoryBlockers, formatInventoryBrief, PRODUCTION_BOUNDARY_KEYS };
