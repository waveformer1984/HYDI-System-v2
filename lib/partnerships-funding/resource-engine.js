'use strict';

const fs = require('fs');
const path = require('path');
const { PartnershipsFundingCoordinator } = require('./coordinator');
const { rankOpportunities } = require('./prioritize');
const { integrationPlan } = require('./integration');
const { transition, PIPELINE_STATES } = require('./pipeline');
const { WORKFLOW_ROLES } = require('./constants');
const { INTAKE_KIND } = require('./source-verification');
const { assertOperatorAuthorization, validateEvidenceBundle } = require('./operator-auth');

/**
 * Resource Acquisition Engine — single coordinator, no always-on agents.
 * discover (intake) → qualify → prioritize → prepare → track (evidence-gated submit/award).
 */
class ResourceAcquisitionEngine {
  constructor(opts = {}) {
    this.coordinator = new PartnershipsFundingCoordinator({ ...opts, _allowTestHarness: Boolean(opts.allowTestHarness) });
    this.coordinator._allowTestHarness = Boolean(opts.allowTestHarness);
    this.fixtureDir = opts.fixtureDir || path.join(__dirname, '..', '..', 'tests/fixtures/partnerships');
    this.allowTestHarness = Boolean(opts.allowTestHarness);
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
      const enriched = { ...input, intake_kind: INTAKE_KIND.EXAMPLE_FIXTURE };
      results.push(this.discoverFromSource(enriched));
    }
    return {
      ok: true,
      count: results.length,
      results,
      classification: 'EXAMPLE_FIXTURES',
      live_discovery: false,
      note: 'Bundled JSON under tests/fixtures is for workflow testing — not live-verified program data.',
    };
  }

  recordOperatorSourceVerification(opportunityId, evidence, operatorContext) {
    return this.coordinator.recordOperatorSourceVerification(opportunityId, evidence, operatorContext);
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
    const profileCheck = this.coordinator.orgProfile;
    if (!profileCheck?.approved_by_owner) {
      return { ok: false, error: 'not_owner_approved', classification: 'REQUIRES_OPERATOR_APPROVAL' };
    }
    const { ranked } = this.prioritize();
    const picks = ranked
      .filter((o) => o.eligibility_result !== 'ineligible' && o.benefits_verified)
      .slice(0, Math.max(1, limit));
    const prepared = [];
    for (const o of picks) {
      prepared.push(this.coordinator.prepareDraft(o.id));
    }
    return { ok: true, prepared, classification: 'AWAITING_OWNER_REVIEW' };
  }

  /** Owner-approved submit — reference + operator authorization (not either alone). */
  recordSubmission(opportunityId, evidence, operatorContext) {
    const auth = assertOperatorAuthorization(operatorContext, { allowTestHarness: this.allowTestHarness });
    if (!auth.ok) return auth;
    const bundle = validateEvidenceBundle(evidence, { requireSubmission: true });
    if (!bundle.ok) return bundle;
    const state = this.coordinator.store.load();
    const opp = state.opportunities.find((o) => o.id === opportunityId);
    if (!opp) return { ok: false, error: 'not_found' };
    if (opp.pipeline_state !== PIPELINE_STATES.AWAITING_APPROVAL) {
      return { ok: false, error: 'not_awaiting_approval', state: opp.pipeline_state };
    }
    const enrichedEvidence = {
      ...evidence,
      operator_action: { actor: auth.actor, method: auth.method, at: evidence.at || new Date().toISOString() },
    };
    const tr = transition(opp, PIPELINE_STATES.SUBMITTED, {
      actor: auth.actor,
      reason: 'owner_authorized_submission',
      evidence: enrichedEvidence,
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

  recordAward(opportunityId, evidence, operatorContext) {
    const auth = assertOperatorAuthorization(operatorContext, { allowTestHarness: this.allowTestHarness });
    if (!auth.ok) return auth;
    const bundle = validateEvidenceBundle(evidence, { requireAward: true });
    if (!bundle.ok) return bundle;
    const state = this.coordinator.store.load();
    const opp = state.opportunities.find((o) => o.id === opportunityId);
    if (!opp) return { ok: false, error: 'not_found' };
    const enrichedEvidence = {
      ...evidence,
      operator_action: { actor: auth.actor, method: auth.method, at: evidence.at || new Date().toISOString() },
    };
    const tr = transition(opp, PIPELINE_STATES.AWARDED, {
      actor: auth.actor,
      reason: 'award_confirmed',
      evidence: enrichedEvidence,
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
      fixture_backed: true,
      live_discovery: false,
      highest_fit: ranked.slice(0, 5).map((o) => ({
        id: o.id,
        provider: o.provider,
        program_name: o.program_name,
        priority_score: o.priority_score,
        priority_reasons: o.priority_reasons,
        eligibility_result: o.eligibility_result,
        pipeline_state: o.pipeline_state,
        intake_kind: o.intake_kind,
        source_verification_status: o.source_verification_status,
        source_claimed_verified_at: o.source_verified_at || null,
        source_operator_verified_at: o.source_operator_verified_at || null,
        application_ready: o.application_ready,
        benefits_verified: o.benefits_verified,
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