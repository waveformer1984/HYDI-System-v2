'use strict';

/**
 * Portfolio registry loader — the single read path for config/portfolio.json.
 * Read-only: consumers (Ursula AppLauncher today; fix-list and runtime-audit
 * later) get validated entries, never a partially-parsed file.
 *
 * kind: 'local'    — repo app; needs repoPath, port, healthUrl
 *       'suite'    — blueprint under the Ursula Suite Flask server
 *       'external' — off-host link; url only
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, '..', '..', 'config', 'portfolio.json');
const KINDS = new Set(['local', 'suite', 'external']);
const LOCAL_REQUIRED = ['id', 'name', 'division', 'repoPath'];
const SUITE_REQUIRED = ['id', 'name', 'blueprintPath'];

function validateEntry(app, idx, errors) {
  if (!app || typeof app !== 'object' || !app.id || !app.name) {
    errors.push(`apps[${idx}]: missing id/name`);
    return;
  }
  const kind = app.kind || 'local';
  if (!KINDS.has(kind)) { errors.push(`${app.id}: unknown kind '${kind}'`); return; }
  const required = kind === 'suite' ? SUITE_REQUIRED : kind === 'external' ? ['id', 'name', 'url'] : LOCAL_REQUIRED;
  for (const key of required) {
    if (app[key] === undefined || app[key] === null) errors.push(`${app.id}: missing '${key}' for kind '${kind}'`);
  }
  if (kind === 'local' && app.port !== undefined && app.port !== null && (!Number.isInteger(app.port) || app.port < 1 || app.port > 65535)) {
    errors.push(`${app.id}: invalid port '${app.port}'`);
  }
}

/**
 * Load and validate the registry. Returns { ok, apps, suiteBase, external, errors }.
 * Never throws on a missing/malformed file — callers get ok:false + errors.
 */
function loadPortfolio(filePath = DEFAULT_PATH) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { ok: false, apps: [], suiteBase: null, external: [], errors: [`cannot read ${filePath}: ${e.message}`] };
  }
  const errors = [];
  const apps = Array.isArray(raw.apps) ? raw.apps : [];
  apps.forEach((app, i) => validateEntry(app, i, errors));
  const suiteBase = (raw.suiteDefaults && raw.suiteDefaults.suiteBase) || null;
  const external = Array.isArray(raw.external && raw.external.apps) ? raw.external.apps : [];
  return { ok: errors.length === 0, apps, suiteBase, external, errors };
}

/** Local apps that carry a PM2 name — the supervision surface runtime:audit/fix-list will reuse. */
function pm2Managed(portfolio = loadPortfolio()) {
  return portfolio.apps.filter((a) => a && a.pm2Name);
}

/**
 * Test-identity gate: a dev/"sign in as test user" identity may only be
 * issued while stripeMode is exactly 'test'. Any live path — including
 * 'live-via-main-app' (orders mint real checkouts via heidi-web) — refuses.
 */
function canIssueTestIdentity(app) {
  return !!app && app.stripeMode === 'test';
}

module.exports = { loadPortfolio, pm2Managed, canIssueTestIdentity, KINDS };
