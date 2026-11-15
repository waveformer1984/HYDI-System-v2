'use strict';

const fs = require('fs');
const path = require('path');
const { PartnershipsFundingCoordinator } = require('./coordinator');
const { rankOpportunities } = require('./prioritize');
const { integrationPlan } = require('./integration');
const { transition, PIPELINE_STATES } = require('./pipeline');
const { WORKFLOW_ROLES } = require('./constants');

/**
 * Resource Acquisition Engine — single coordinator, no always-on agents.
 * discover (intake) → qualify → prioritize → prepare → track (evidence-gated submit/award).
 */
class ResourceAcquisitionEngine {
  constructor(opts = {}) {
    this.coordinator = new PartnershipsFundingCoordinator(opts);
    this.fixtureDir = opts.fixtureDir || path.join(__dirname, '..', '..', 'tests/fixtures/partnerships');
  }

  setOrgProfile(profile) {
    return this.coordinator.setOrgProfile(profile);
  }

  discoverFromSource(input) {
    return this.coordinator.discoverFromSource(input);
  }

  /** Load all JSON fixtures in tests/fixtures/partnerships (operator can add more files). */
  discoverBundledFixtures() {
    const files = fs.existsSync(this.fixtureDir)
      ? fs.readdirSync(this.fixtureDir).filter((f) => f.endsWith('.json'))
      : [];
    const results = [];
    for (const file of files) {
      const input = JSON.parse(fs.readFileSync(path.join(this.fixtureDir, file), 'utf8'));
      results.push(this.discoverFromSource(input));
    }
    return { ok: true, count: results.length, results, classification: 'VERIFIED_SIMULATED' };
  }

  qualifyAll() {
    if (!this.coordinator.orgProfile) {
      return { ok: false, error: 'org_profile_required', classification: 'REQUIRES_OPERATOR_APPROVAL' };
    }
    const state = this.coordinator.store.load();
    const evaluated = [];
    for (const opp of state.opportunities) {
      evaluated.push(this.coordinator.evaluateOpportunity(opp.id));
    }
    return { ok: true, evaluated, classification: 'VERIFIED_SIMULATED' };
  }

  prioritize() {
    const state = this.coordinator.store.load();
    return {
      ok: true,
      ranked: rankOpportunities(state.opportunities, this.coordinator.orgProfile),
    };
  }

  /** Prepare drafts for top N by priority (still no external send). */
  prepareTopDrafts({ limit = 1 } = {}) {
    const { ranked } = this.prioritize();
    const picks = ranked
      .filter((o) => o.eligibility_result !== 'ineligible')
      .slice(0, Math.max(1, limit));
    const prepared = [];
    for (const o of picks) {
      prepared.push(this.coordinator.prepareDraft(o.id));
    }
    return { ok: true, prepared, classification: 'AWAITING_OWNER_REVIEW' };
  }

  /** Owner-approved submit — requires evidence object. */
  recordSubmission(opportunityId, evidence) {
    const state = this.coordinator.store.load();
    const opp = state.opportunities.find((o) => o.id === opportunityId);
    if (!opp) return { ok: false, error: 'not_found' };
    if (opp.pipeline_state !== PIPELINE_STATES.AWAITING_APPROVAL) {
      return { ok: false, error: 'not_awaiting_approval', state: opp.pipeline_state };
    }
    const tr = transition(opp, PIPELINE_STATES.SUBMITTED, {
      actor: 'human:operator',
      reason: 'owner_authorized_submission',
      evidence,
    });
    if (!tr.ok) return tr;
    opp.submission_evidence = {
      reference: evidence.submission_reference,
      at: evidence.at || new Date().toISOString(),
      destination: evidence.destination || null,
    };
    state.history.push({
      at: new Date().toISOString(),
      role: WORKFLOW_ROLES.PARTNERSHIP_COORDINATOR,
      event: 'submitted',
      opportunity_id: opportunityId,
    });
    this.coordinator.store.save(state);
    return { ok: true, opportunity: opp, classification: 'REQUIRES_OPERATOR_APPROVAL' };
  }

  recordAward(opportunityId, evidence) {
    const state = this.coordinator.store.load();
    const opp = state.opportunities.find((o) => o.id === opportunityId);
    if (!opp) return { ok: false, error: 'not_found' };
    const tr = transition(opp, PIPELINE_STATES.AWARDED, {
      actor: 'human:operator',
      reason: 'award_confirmed',
      evidence,
    });
    if (!tr.ok) return tr;
    opp.award = {
      reference: evidence.award_reference,
      benefit_type: evidence.benefit_type || opp.benefit_category,
      expires_at: evidence.expires_at || null,
      obligations: evidence.obligations || [],
      at: evidence.at || new Date().toISOString(),
    };
    const plan = integrationPlan(opp);
    opp.integration_plan = plan;
    this.coordinator.store.save(state);
    return { ok: true, opportunity: opp, integration: plan, classification: 'REQUIRES_OPERATOR_APPROVAL' };
  }

  /** One-shot pass: fixtures → qualify → rank → optional draft limit. */
  runAcquisitionPass({ draftLimit = 0 } = {}) {
    const discover = this.discoverBundledFixtures();
    const qualify = this.qualifyAll();
    const rank = this.prioritize();
    let prepare = null;
    if (draftLimit > 0 && qualify.ok) {
      prepare = this.prepareTopDrafts({ limit: draftLimit });
    }
    return {
      ok: discover.ok && qualify.ok,
      discover,
      qualify,
      rank: rank.ranked,
      prepare,
      mobile: this.acquisitionSnapshot(),
    };
  }

  acquisitionSnapshot() {
    const base = this.coordinator.mobileSnapshot();
    const { ranked } = this.prioritize();
    return {
      ...base,
      engine: 'resource_acquisition_v1',
      highest_fit: ranked.slice(0, 5).map((o) => ({
        id: o.id,
        provider: o.provider,
        program_name: o.program_name,
        priority_score: o.priority_score,
        priority_reasons: o.priority_reasons,
        eligibility_result: o.eligibility_result,
        pipeline_state: o.pipeline_state,
      })),
      recurring_discovery: {
        enabled: false,
        classification: 'REQUIRES_OPERATOR_APPROVAL',
        note: 'Scheduled discovery not enabled in v1',
      },
    };
  }
}

module.exports = { ResourceAcquisitionEngine };