'use strict';

const { enrichOpportunityRecord } = require('./opportunity-schema');
const { REGISTRY_LIFECYCLE } = require('./opportunity-schema');

function buildResourceDashboard(engineSnapshot, intelligence) {
  const opps = (engineSnapshot.opportunities || []).map(enrichOpportunityRecord);
  const verified = opps.filter((o) => o.source_verification_status === 'operator_verified');
  const qualified = opps.filter((o) => o.registry_lifecycle === REGISTRY_LIFECYCLE.QUALIFIED || o.eligibility_result === 'eligible');
  const pendingApps = opps.filter((o) => o.registry_lifecycle === REGISTRY_LIFECYCLE.AWAITING_APPROVAL);
  const activeApps = opps.filter((o) => ['submitted', 'follow_up'].includes(o.pipeline_state));
  const awarded = opps.filter((o) => o.registry_lifecycle === REGISTRY_LIFECYCLE.AWARDED);
  const rejected = opps.filter((o) => o.registry_lifecycle === REGISTRY_LIFECYCLE.REJECTED);
  const expiring = (engineSnapshot.monitor?.upcoming_deadlines || []).slice(0, 5);

  return {
    resource_overview: {
      total_discovered: opps.length,
      verified_opportunities: verified.length,
      qualified_opportunities: qualified.length,
      pending_applications: pendingApps.length,
      active_applications: activeApps.length,
      awarded_resources: awarded.length,
      rejected_opportunities: rejected.length,
      expiring_opportunities: expiring.length,
      fixture_backed: Boolean(engineSnapshot.fixture_backed),
      live_discovery: Boolean(engineSnapshot.live_discovery),
    },
    resource_value: {
      confirmed_funding_usd: null,
      potential_funding_usd: null,
      note: 'Potential values are not inferred without operator-verified benefit data.',
      awarded_count: awarded.length,
    },
    action_center: {
      applications_requiring_approval: pendingApps.map((o) => ({ id: o.id, program_name: o.program_name })),
      missing_information: opps
        .filter((o) => o.registry_lifecycle === REGISTRY_LIFECYCLE.NEEDS_INFORMATION)
        .map((o) => ({ id: o.id, program_name: o.program_name })),
      upcoming_deadlines: expiring,
      new_opportunities: opps.filter((o) => o.registry_lifecycle === REGISTRY_LIFECYCLE.DISCOVERED).length,
    },
    resource_tracking: activeApps.concat(awarded).map((o) => ({
      id: o.id,
      provider: o.provider,
      application_status: o.registry_lifecycle,
      submission: o.submission_evidence || null,
      award: o.award || null,
    })),
    rankings: intelligence
      ? Object.fromEntries(Object.entries(intelligence.buckets).map(([k, v]) => [k, v.slice(0, 5).map((x) => ({
          id: x.id,
          program_name: x.program_name,
          intelligence_score: x.intelligence_score,
          intelligence_reasons: x.intelligence_reasons,
          application_ready: x.application_ready,
        }))]))
      : null,
  };
}

module.exports = { buildResourceDashboard };