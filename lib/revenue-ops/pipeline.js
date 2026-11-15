'use strict';

const path = require('path');
const fs = require('fs');
const { runScout, scoutDir } = require('../job-scout/scout');
const { connectorHealth } = require('./connectors');
const { syncFromScoutLeads, loadStore, opsDir, loadConfig } = require('./store');
function readJsonFile(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/**
 * Discovery cycle: scout (if requested) + opportunity sync + summary.
 */
async function runDiscoveryCycle(opts = {}) {
  const env = opts.env || process.env;
  let scoutSummary = opts.scoutSummary || null;
  if (opts.runScout) {
    scoutSummary = await runScout({ ...opts, env });
  }
  const dir = scoutDir(env);
  const { leads = [] } = readJsonFile(path.join(dir, 'leads.json'), {});
  const status = readJsonFile(path.join(dir, 'status.json'), scoutSummary);
  const jobConfig = readJsonFile(
    env.JOB_SCOUT_CONFIG ? path.resolve(env.JOB_SCOUT_CONFIG) : path.join(process.cwd(), 'config', 'job-scout.json'),
    {},
  );
  const sync = syncFromScoutLeads(leads, { env, now: opts.now });
  const store = loadStore(opsDir(env));
  const connectors = connectorHealth(status, jobConfig.sources || {});
  return {
    ok: status ? status.ok !== false : true,
    scout: status,
    sync,
    connectors,
    opportunities: store.opportunities,
    config: loadConfig(env),
  };
}

module.exports = { runDiscoveryCycle };