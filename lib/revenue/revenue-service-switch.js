'use strict';

/**
 * Revenue service switch — the durable, auditable ON/OFF control for one
 * commercial service.
 *
 * Three deliberately separate flags (one switch never grants everything):
 *
 *   serviceEnabled     — Heidi may run the approved service workflow:
 *                        resolve machine-executable blockers, research and
 *                        record prospects, prepare offers/orders, dispatch
 *                        eligible fulfillment when payment predicates pass.
 *   acquisitionEnabled — Heidi may perform explicitly authorized prospecting
 *                        and outreach. Stays OFF until an outreach
 *                        authorization boundary is resolved.
 *   livePaymentsEnabled — the live-payment surface may move real money.
 *                        Stays OFF until live credentials + per-transaction
 *                        authorization exist. This switch NEVER grants that
 *                        authorization — LiveTransactionAuthorization does.
 *
 * Semantics:
 *   OFF — no new automatically initiated commercial work. Existing orders,
 *         payments, jobs, refunds and customer obligations are preserved;
 *         monitoring and reconciliation continue.
 *   ON  — readiness/policy is still validated before each consequential
 *         transition; only eligible work starts.
 *
 * Fail-closed: an unreadable/malformed config reads as OFF. Every flip is
 * appended to transitions[] — durable audit, never a silent rewrite.
 *
 * File shape (.hydi-operational/revenue-service.json):
 *   { services: { checkpoint_audit: { serviceEnabled, acquisitionEnabled,
 *     livePaymentsEnabled, updatedAt, updatedBy, transitions[] } } }
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(process.cwd(), '.hydi-operational', 'revenue-service.json');
const SWITCH_FIELDS = ['serviceEnabled', 'acquisitionEnabled', 'livePaymentsEnabled'];

function defaultService() {
  return {
    serviceEnabled: false,
    acquisitionEnabled: false,
    livePaymentsEnabled: false,
    updatedAt: null,
    updatedBy: null,
    transitions: [],
  };
}

function readConfig(configPath = DEFAULT_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { services: {} };
  } catch {
    return { services: {} }; // fail-closed: unreadable → everything OFF
  }
}

function writeConfig(cfg, configPath) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  try { fs.copyFileSync(configPath, configPath + '.bak'); } catch { /* first write */ }
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, configPath);
}

/** Read one service's switch state. Absent/malformed → all OFF. */
function getServiceSwitch(serviceId, configPath = DEFAULT_PATH) {
  const cfg = readConfig(configPath);
  const s = cfg.services && cfg.services[serviceId];
  if (!s || typeof s !== 'object') return defaultService();
  return {
    ...defaultService(),
    serviceEnabled: s.serviceEnabled === true,
    acquisitionEnabled: s.acquisitionEnabled === true,
    livePaymentsEnabled: s.livePaymentsEnabled === true,
    updatedAt: s.updatedAt ?? null,
    updatedBy: s.updatedBy ?? null,
    transitions: Array.isArray(s.transitions) ? s.transitions : [],
  };
}

/** Is automatically initiated commercial work allowed for this service? */
function isServiceEnabled(serviceId, configPath = DEFAULT_PATH) {
  return getServiceSwitch(serviceId, configPath).serviceEnabled;
}

/**
 * Flip one or more flags. `changes` may only contain known switch fields;
 * unknown keys are ignored (fail-closed), never persisted. Returns the
 * new state with a transitions[] audit entry per actual change.
 */
function setServiceSwitch(serviceId, changes, { actor = 'operator', configPath = DEFAULT_PATH, reason = null } = {}) {
  const cfg = readConfig(configPath);
  cfg.services = cfg.services || {};
  const prev = getServiceSwitch(serviceId, configPath);
  const now = new Date().toISOString();
  const applied = [];
  for (const f of SWITCH_FIELDS) {
    if (typeof changes[f] === 'boolean' && changes[f] !== prev[f]) {
      applied.push({ field: f, from: prev[f], to: changes[f] });
    }
  }
  const next = {
    ...prev,
    transitions: [...prev.transitions],
  };
  for (const a of applied) next[a.field] = a.to;
  next.updatedAt = now;
  next.updatedBy = actor;
  if (applied.length) {
    next.transitions.push({
      at: now, actor,
      changes: applied.map((a) => `${a.field}:${a.from}→${a.to}`).join(', '),
      reason,
    });
  }
  cfg.services[serviceId] = next;
  writeConfig(cfg, configPath);
  return { changed: applied.length > 0, applied, state: next };
}

module.exports = {
  DEFAULT_PATH,
  SWITCH_FIELDS,
  getServiceSwitch,
  isServiceEnabled,
  setServiceSwitch,
};
