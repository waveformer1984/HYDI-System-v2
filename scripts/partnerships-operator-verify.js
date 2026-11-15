#!/usr/bin/env node
'use strict';

/**
 * Operator attestation for one opportunity — source + published terms (no auto-submit).
 *
 *   HYDI_PARTNERSHIPS_OPERATOR_SECRET=… node scripts/partnerships-operator-verify.js <opportunityId> \
 *     --terms --application-open=unknown
 *
 * Reads operator token from HYDI_OPERATOR_TOKEN or pass OPERATOR_TOKEN=...
 */

const readline = require('readline');
const { ResourceAcquisitionEngine } = require('../lib/partnerships-funding/resource-engine');
const { loadApprovedOrgProfileFromEnv } = require('../lib/partnerships-funding/profile-loader');

function parseArgs(argv) {
  const id = argv.find((a) => !a.startsWith('-'));
  const terms = argv.includes('--terms');
  let applicationOpen = null;
  for (const a of argv) {
    if (a.startsWith('--application-open=')) {
      const v = a.split('=')[1];
      if (v === 'true') applicationOpen = true;
      else if (v === 'false') applicationOpen = false;
      else applicationOpen = null;
    }
  }
  return { id, terms, applicationOpen };
}

async function promptLine(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => rl.question(q, resolve));
  rl.close();
  return answer.trim();
}

async function main() {
  const { id, terms, applicationOpen } = parseArgs(process.argv.slice(2));
  if (!id) {
    console.error('Usage: node scripts/partnerships-operator-verify.js <opportunityId> [--terms] [--application-open=true|false|unknown]');
    process.exit(2);
  }
  const token = process.env.OPERATOR_TOKEN || process.env.HYDI_OPERATOR_TOKEN;
  if (!token) {
    console.error('Set OPERATOR_TOKEN (must match HYDI_PARTNERSHIPS_OPERATOR_SECRET)');
    process.exit(2);
  }
  const engine = new ResourceAcquisitionEngine({ allowTestHarness: false });
  const loaded = loadApprovedOrgProfileFromEnv();
  if (loaded.ok) engine.setOrgProfile(loaded.profile);

  const state = engine.coordinator.store.load();
  const opp = state.opportunities.find((o) => o.id === id);
  if (!opp) {
    console.error('opportunity_not_found:', id);
    process.exit(1);
  }

  const benefitTerms = terms
    ? await promptLine('Published benefit terms (one paragraph, factual): ')
    : '';
  const restrictions = terms ? await promptLine('Restrictions (one paragraph): ') : '';
  const statusNote =
    applicationOpen === true
      ? 'operator: applications reported open'
      : applicationOpen === false
        ? 'operator: applications reported closed'
        : 'operator: application window not verified';

  const evidence = {
    source_checked_at: new Date().toISOString(),
    official_source_url: opp.official_source_url,
    published_benefits_verified: Boolean(terms && benefitTerms.length > 0),
    application_open_verified: applicationOpen,
    benefit_terms_excerpt: benefitTerms || null,
    restrictions_excerpt: restrictions || null,
    application_status_note: statusNote,
    note: 'CLI operator attestation',
  };

  const result = engine.recordOperatorSourceVerification(id, evidence, {
    actor: 'human:operator',
    method: 'cli_partnerships_operator_verify',
    token,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});