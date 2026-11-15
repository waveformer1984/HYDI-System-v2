'use strict';

const { verifyOpportunityRecord } = require('./adapters');
const { persistVerificationRecord } = require('./store');

async function runVerificationPass(coordinator, { limit = 48, concurrency = 2 } = {}) {
  const state = coordinator.store.load();
  const targets = state.opportunities.slice(0, limit);
  const summary = {
    ok: true,
    checked: 0,
    counts: {
      source_reachable: 0,
      weak_page_signal: 0,
      program_confirmed: 0,
      benefits_confirmed: 0,
      eligibility_confirmed: 0,
      application_ready: 0,
    },
    by_classification: {},
    results: [],
  };

  for (const opp of targets) {
    // eslint-disable-next-line no-await-in-loop
    const v = await verifyOpportunityRecord(opp);
    summary.checked += 1;
    opp.verification_flags = v.flags;
    opp.verification_evidence = v.evidence;
    opp.last_verification_timestamp = v.evidence.verified_at;
    opp.verification_classification = v.classification;
    if (v.flags.source_reachable) summary.counts.source_reachable += 1;
    if (v.flags.weak_page_signal) summary.counts.weak_page_signal += 1;
    if (v.flags.program_confirmed) summary.counts.program_confirmed += 1;
    summary.by_classification[v.classification] = (summary.by_classification[v.classification] || 0) + 1;
    const evidenceFile = persistVerificationRecord(opp.id, { opportunity_id: opp.id, ...v });
    summary.results.push({ id: opp.id, program_name: opp.program_name, flags: v.flags, classification: v.classification, evidence_file: evidenceFile });
    if (summary.checked % concurrency === 0) {
      coordinator.store.save(state);
    }
  }
  coordinator.store.save(state);
  return summary;
}

module.exports = { runVerificationPass };