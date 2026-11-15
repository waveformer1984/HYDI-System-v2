'use strict';

const { PartnershipStore } = require('./store');
const { transition, PIPELINE_STATES } = require('./pipeline');
const { validateOrgProfile } = require('./org-profile');
const { intakeOfficialSource } = require('./roles/scout');
const { analyzeEligibility } = require('./roles/eligibility');
const { buildApplicationDraft } = require('./roles/writer');
const { portfolioSnapshot } = require('./roles/monitor');
const { rankOpportunities } = require('./prioritize');
const { WORKFLOW_ROLES } = require('./constants');

/**
 * Single coordinator — dedupes, advances pipeline, no external writes.
 */
class PartnershipsFundingCoordinator {
  constructor(opts = {}) {
    this.store = opts.store || new PartnershipStore(opts);
    this.orgProfile = opts.orgProfile || null;
  }

  setOrgProfile(profile) {
    const v = validateOrgProfile(profile);
    if (!v.ok) return v;
    this.orgProfile = profile;
    return { ok: true };
  }

  /** Scout + dedupe */
  discoverFromSource(input) {
    const intake = intakeOfficialSource(input);
    if (!intake.ok) return intake;
    const state = this.store.load();
    const { opportunity, created } = this.store.upsertOpportunity(state, intake.record);
    if (created) {
      state.history.push({
        at: new Date().toISOString(),
        role: WORKFLOW_ROLES.OPPORTUNITY_SCOUT,
        event: 'discovered',
        opportunity_id: opportunity.id,
      });
    }
    this.store.save(state);
    return { ok: true, opportunity, created, duplicate: !created };
  }

  /** Verify source + run eligibility */
  evaluateOpportunity(opportunityId) {
    if (!this.orgProfile) return { ok: false, error: 'org_profile_required', classification: 'REQUIRES_OPERATOR_APPROVAL' };
    const state = this.store.load();
    const opp = state.opportunities.find((o) => o.id === opportunityId);
    if (!opp) return { ok: false, error: 'not_found' };

    if (opp.pipeline_state === PIPELINE_STATES.DISCOVERED) {
      const tr = transition(opp, PIPELINE_STATES.NEEDS_VERIFICATION, { actor: WORKFLOW_ROLES.PARTNERSHIP_COORDINATOR, reason: 'source_check' });
      if (!tr.ok) return tr;
    }

    const eligibility = analyzeEligibility(opp, this.orgProfile);
    opp.eligibility_result = eligibility.eligibility_result;
    opp.missing_facts = eligibility.missing_facts;
    opp.eligibility_notes = eligibility.notes;

    const next = transition(opp, eligibility.recommended_pipeline_state, {
      actor: WORKFLOW_ROLES.ELIGIBILITY_ANALYST,
      reason: 'eligibility_complete',
    });
    if (!next.ok) return next;

    this.store.save(state);
    return { ok: true, opportunity: opp, eligibility };
  }

  /** Draft application (no send) */
  prepareDraft(opportunityId) {
    if (!this.orgProfile) return { ok: false, error: 'org_profile_required' };
    const state = this.store.load();
    const opp = state.opportunities.find((o) => o.id === opportunityId);
    if (!opp) return { ok: false, error: 'not_found' };

    const eligibility = analyzeEligibility(opp, this.orgProfile);
    const draft = buildApplicationDraft(opp, this.orgProfile, eligibility);
    opp.application_draft = draft.draft;
    opp.unresolved_questions = draft.draft.unresolved_questions;

    const toDrafting = transition(opp, PIPELINE_STATES.DRAFTING, { actor: WORKFLOW_ROLES.APPLICATION_WRITER });
    if (!toDrafting.ok) return toDrafting;
    const awaiting = transition(opp, PIPELINE_STATES.AWAITING_APPROVAL, { actor: WORKFLOW_ROLES.APPLICATION_WRITER, reason: 'draft_ready' });
    if (!awaiting.ok) return awaiting;

    this.store.save(state);
    return { ok: true, opportunity: opp, draft: draft.draft, classification: 'AWAITING_OWNER_REVIEW' };
  }

  mobileSnapshot(opts = {}) {
    const state = this.store.load();
    const monitor = portfolioSnapshot(state, opts);
    const opportunities = (state.opportunities || [])
      .map((o) => ({
        id: o.id,
        provider: o.provider,
        program_name: o.program_name,
        benefit_category: o.benefit_category,
        pipeline_state: o.pipeline_state,
        eligibility_result: o.eligibility_result,
        deadline: o.deadline,
        official_source_url: o.official_source_url,
        has_draft: Boolean(o.application_draft),
        missing_questions: o.unresolved_questions || [],
        fit_summary: o.eligibility_notes || null,
        priority_score: rankOpportunities([o], this.orgProfile)[0]?.priority_score ?? null,
      }))
      .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));

    return {
      ok: true,
      checked_at: new Date().toISOString(),
      research_status: monitor.total ? 'opportunities_loaded' : 'no_verified_opportunities_loaded',
      monitor,
      opportunities,
      org_profile_approved: Boolean(this.orgProfile?.approved_by_owner),
    };
  }
}

module.exports = { PartnershipsFundingCoordinator };