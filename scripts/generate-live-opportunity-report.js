#!/usr/bin/env node
'use strict';

/**
 * Live (network) job scout + revenue-ops assessment → JSON report.
 * Uses only authorized public APIs in lib/job-scout/sources.js.
 * Never submits proposals or contacts clients.
 */

const fs = require('fs');
const path = require('path');
const { runScout } = require('../lib/job-scout/scout');
const { assessOpportunity } = require('../lib/revenue-ops/scoring');
const { listConnectors, connectorHealth } = require('../lib/revenue-ops/connectors');
const config = require('../config/job-scout.json');

const OUT =
  process.env.REVENUE_OPS_REPORT_PATH ||
  path.join(__dirname, '..', 'docs', 'reports', 'HEIDI_LIVE_OPPORTUNITY_DISCOVERY.json');

async function main() {
  const root = path.resolve(__dirname, '..');
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hydi-rev-report-'));
  const env = {
    ...process.env,
    JOB_SCOUT_DIR: path.join(tmpDir, 'job-scout'),
  };

  let scoutResult;
  try {
    scoutResult = await runScout({ env, config });
  } catch (error) {
    const payload = {
      generated_at: new Date().toISOString(),
      mode: 'LIVE',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      connectors: listConnectors(config.sources),
    };
    writeReport(payload);
    process.exitCode = 1;
    return;
  }

  const leadsPath = path.join(env.JOB_SCOUT_DIR, 'leads.json');
  let leads = [];
  try {
    const stored = JSON.parse(fs.readFileSync(leadsPath, 'utf8'));
    leads = stored.leads || [];
  } catch {
    leads = [];
  }
  const assessed = leads.slice(0, 50).map((lead) => ({
    id: lead.id,
    title: lead.title,
    company: lead.company,
    source: lead.source,
    source_url: lead.sourceUrl,
    budget: lead.budget || null,
    skills: lead.skills || [],
    posted_at: lead.postedAt || null,
    scout_score: lead.score,
    division: lead.division || null,
    assessment: assessOpportunity(lead, config),
    proposal_draft: lead.draft || null,
  }));

  const qualified = assessed
    .filter((a) => a.assessment.qualified)
    .sort((a, b) => (b.assessment.opportunityScore || 0) - (a.assessment.opportunityScore || 0));

  const statusPath = path.join(env.JOB_SCOUT_DIR, 'status.json');
  let scoutStatus = null;
  try {
    scoutStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  } catch {
    scoutStatus = null;
  }

  const payload = {
    generated_at: new Date().toISOString(),
    mode: 'LIVE',
    ok: scoutResult.ok !== false,
    scout: {
      newLeads: scoutResult.newLeads,
      newStrong: scoutResult.newStrong,
      sources: scoutResult.sources,
    },
    connectors: connectorHealth(scoutStatus, config.sources),
    blocked_marketplaces: require('../lib/revenue-ops/connectors').BLOCKED.map((b) => ({
      id: b.id,
      reason: b.reason,
    })),
    opportunities_found: assessed.length,
    qualified_count: qualified.length,
    opportunities: assessed,
    recommended_first: qualified[0] || null,
    human_approval_required_before: ['client_contact', 'proposal_submission', 'contract_acceptance'],
  };

  writeReport(payload);
  console.log(`[revenue-report] wrote ${OUT} (${qualified.length} qualified of ${assessed.length} assessed)`);
  process.exitCode = qualified.length ? 0 : 2;
}

function writeReport(payload) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = `${OUT}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, OUT);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});