'use strict';

/**
 * Marketplace connector registry. Active connectors delegate to lib/job-scout
 * adapters (read-only public APIs). Blocked connectors report honest status —
 * no scraping, no CAPTCHA bypass, no unauthorized automation.
 */

const { ADAPTERS } = require('../job-scout/sources');

/** @typedef {'active'|'blocked'|'unconfigured'} ConnectorAccess */

const BLOCKED = [
  { id: 'upwork', name: 'Upwork', reason: 'No permitted read-only API in repo; RSS retired Aug 2024; requires approved partner API.' },
  { id: 'fiverr', name: 'Fiverr', reason: 'No official public listing API; automated access not implemented.' },
  { id: 'peopleperhour', name: 'PeoplePerHour', reason: 'No authorized feed integration.' },
  { id: 'contra', name: 'Contra', reason: 'No authorized feed integration.' },
  { id: 'guru', name: 'Guru', reason: 'No authorized feed integration.' },
  { id: 'linkedin', name: 'LinkedIn Jobs', reason: 'Requires LinkedIn API partnership; not configured.' },
  { id: 'indeed', name: 'Indeed', reason: 'Publisher API credentials not configured.' },
];

const ACTIVE_META = {
  freelancer: { name: 'Freelancer.com' },
  remotive: { name: 'Remotive' },
  remoteok: { name: 'RemoteOK' },
  hn: { name: 'HN Seeking Freelancer' },
};

function listConnectors(jobScoutSources = {}) {
  const out = [];
  for (const [id, meta] of Object.entries(ACTIVE_META)) {
    const enabled = Boolean(jobScoutSources[id] && jobScoutSources[id].enabled !== false);
    out.push({
      id,
      name: meta.name,
      access: enabled && ADAPTERS[id] ? 'active' : 'unconfigured',
      adapter: Boolean(ADAPTERS[id]),
      lastScan: null,
    });
  }
  for (const b of BLOCKED) {
    out.push({ id: b.id, name: b.name, access: 'blocked', blockReason: b.reason, lastScan: null });
  }
  return out;
}

/**
 * Merge last scan outcomes from job-scout status.json.
 * @param {object|null} scoutStatus
 * @param {object} jobScoutSources
 */
function connectorHealth(scoutStatus, jobScoutSources = {}) {
  const connectors = listConnectors(jobScoutSources);
  const sources = (scoutStatus && scoutStatus.sources) || {};
  for (const c of connectors) {
    const r = sources[c.id];
    if (!r) continue;
    c.lastScan = scoutStatus.ranAt || null;
    c.lastOk = Boolean(r.ok);
    c.lastCount = r.count || 0;
    c.lastError = r.ok ? null : (r.error || 'unknown_error').slice(0, 200);
  }
  return connectors;
}

module.exports = { listConnectors, connectorHealth, BLOCKED };