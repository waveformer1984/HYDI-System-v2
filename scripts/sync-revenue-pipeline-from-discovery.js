#!/usr/bin/env node
'use strict';

/**
 * Imports qualified leads from HEIDI_LIVE_OPPORTUNITY_DISCOVERY.json into
 * revenue-ops store (.runtime/revenue-ops). Does not submit proposals.
 */

const fs = require('fs');
const path = require('path');
const { syncFromScoutLeads, loadStore, saveStore, opsDir, transition } = require('../lib/revenue-ops/store');

const DISCOVERY =
  process.env.DISCOVERY_REPORT_PATH ||
  path.join(__dirname, '..', 'docs', 'reports', 'HEIDI_LIVE_OPPORTUNITY_DISCOVERY.json');

const OUT_MD =
  process.env.REVENUE_PIPELINE_REPORT_PATH ||
  path.join(__dirname, '..', 'docs', 'reports', 'HEIDI_REVENUE_PIPELINE_REPORT.md');

const OUT_JSON =
  path.join(__dirname, '..', 'docs', 'reports', 'HEIDI_REVENUE_PIPELINE_ACCEPTANCE.json');

function leadFromOpportunity(row) {
  return {
    id: row.id,
    source: row.source,
    sourceUrl: row.source_url,
    title: row.title,
    description: row.title,
    company: row.company,
    budget: row.budget,
    skills: row.skills,
    postedAt: row.posted_at,
    score: row.scout_score,
    division: row.division,
    draft: row.proposal_draft,
  };
}

function main() {
  const report = JSON.parse(fs.readFileSync(DISCOVERY, 'utf8'));
  const qualified = (report.opportunities || []).filter((o) => o.assessment?.qualified);

  const env = {
    ...process.env,
    REVENUE_OPS_DIR: process.env.REVENUE_OPS_DIR || path.join(require('os').tmpdir(), `hydi-rev-pipe-${process.pid}`),
  };
  env.REVENUE_OPS_CONFIG = env.REVENUE_OPS_CONFIG || path.join(__dirname, '..', 'config', 'revenue-ops.json');

  const leads = qualified.map(leadFromOpportunity);
  syncFromScoutLeads(leads, { env, now: Date.now() });

  const store = loadStore(opsDir(env));
  const ranked = [...store.opportunities]
    .filter((o) => o.assessment?.qualified)
    .sort((a, b) => (b.assessment?.opportunityScore || 0) - (a.assessment?.opportunityScore || 0));

  for (const opp of ranked) {
    if (opp.state === 'PROPOSAL_READY') {
      try {
        transition(store, opp.id, 'AWAITING_APPROVAL', { actor: 'sync-revenue-pipeline', note: 'awaiting human before submit' });
      } catch {
        /* already past */
      }
    }
  }
  saveStore(opsDir(env), store);

  const acceptance = {
    generated_at: new Date().toISOString(),
    mode: report.mode || 'UNKNOWN',
    discovery_generated_at: report.generated_at,
    qualified_imported: qualified.length,
    pipeline_states: ranked.map((o) => ({
      id: o.id,
      title: o.title,
      source_url: o.sourceUrl,
      state: o.state,
      opportunity_score: o.assessment?.opportunityScore,
      economics: o.assessment?.economics,
      human_approval_required_before_submit: o.state === 'AWAITING_APPROVAL',
    })),
    recommended_first: ranked[0]
      ? { id: ranked[0].id, title: ranked[0].title, source_url: ranked[0].sourceUrl, state: ranked[0].state }
      : null,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(acceptance, null, 2));

  const md = [
    '# Heidi revenue pipeline report',
    '',
    `**Generated:** ${acceptance.generated_at}`,
    `**Discovery source:** \`${DISCOVERY}\` (${report.mode})`,
    `**Qualified imported:** ${qualified.length}`,
    '',
    '## Pipeline states (human approval before SUBMITTED)',
    '',
    '| State | Title | Source | Score |',
    '|-------|-------|--------|-------|',
    ...ranked.slice(0, 15).map(
      (o) => `| ${o.state} | ${o.title?.slice(0, 60)} | ${o.sourceUrl ? '[link](' + o.sourceUrl + ')' : '—'} | ${o.assessment?.opportunityScore ?? '—'} |`,
    ),
    '',
    '## Recommended first',
    '',
    acceptance.recommended_first
      ? `- **${acceptance.recommended_first.title}** — ${acceptance.recommended_first.source_url} (${acceptance.recommended_first.state})`
      : '- None',
    '',
    'Machine-readable: `HEIDI_REVENUE_PIPELINE_ACCEPTANCE.json`',
  ].join('\n');

  fs.writeFileSync(OUT_MD, md);
  console.log(`[revenue-pipeline] ${qualified.length} qualified → store ${opsDir(env)}`);
  console.log(`[revenue-pipeline] wrote ${OUT_MD}`);
}

main();