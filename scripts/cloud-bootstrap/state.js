'use strict';

/**
 * Cloud-bootstrap state: a small JSON record of which cloud services are
 * live, when they were last verified, and what (if anything) a human must do.
 *
 * The file lives at the repo root (gitignored — it describes THIS machine's
 * view of the infrastructure, and must never contain secret values).
 */

const fs = require('fs');
const path = require('path');

const STATE_VERSION = 1;
const DEFAULT_STATE_PATH = path.join(__dirname, '../../.cloud-bootstrap-state.json');

function emptyState() {
  return { version: STATE_VERSION, services: {} };
}

function loadState(statePath = DEFAULT_STATE_PATH) {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== STATE_VERSION || typeof parsed.services !== 'object') {
      return emptyState();
    }
    return parsed;
  } catch {
    return emptyState();
  }
}

function saveState(state, statePath = DEFAULT_STATE_PATH) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Record a service run result. `result` must be secret-free:
 * { status: 'verified'|'blocked'|'failed', detail, actionRequired? }
 */
function recordResult(state, service, result, now = new Date()) {
  return {
    ...state,
    services: {
      ...state.services,
      [service]: {
        status: result.status,
        detail: result.detail || '',
        actionRequired: result.actionRequired || null,
        lastChecked: now.toISOString(),
      },
    },
  };
}

/**
 * Decide which of `services` actually need a run.
 * Skip a service only when it was VERIFIED within `ttlMs` and force is off —
 * blocked/failed services are always retried (that is what makes incremental
 * bootstrap work: once J fixes the dashboard side, the next run picks it up).
 */
function planRuns(state, services, { force = false, ttlMs = 10 * 60 * 1000, now = new Date() } = {}) {
  return services.filter((service) => {
    if (force) return true;
    const rec = state.services[service];
    if (!rec) return true;
    if (rec.status !== 'verified') return true;
    const age = now.getTime() - Date.parse(rec.lastChecked);
    return !(age >= 0 && age < ttlMs);
  });
}

module.exports = { STATE_VERSION, DEFAULT_STATE_PATH, emptyState, loadState, saveState, recordResult, planRuns };
