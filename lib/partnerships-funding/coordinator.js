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
const { isOperatorVerifiedSource, computeApplicationReady, SOURCE_VERIFICATION_STATUS } = require('./source-verification');
const { assertOperatorAuthorization } = require('./operator-auth');

/**
 * Single coordinator — dedupes, advances pipeline, no external writes.
 */
class PartnershipsFundingCoordinator {
  constructor(opts = {}) {
    this.store = opts.store || new PartnershipStore(opts);
    this.orgProfile = opts.orgProfile || null;
    this._allowTestHarness = Boolean(opts._allowTestHarness);
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
    if (opp.pipeline_state === PIPELINE_STATES.AWAITING_APPROVAL || opp.pipeline_state === PIPELINE_STATES.SUBMITTED) {
      return { ok: true, opportunity: opp, eligibility: { eligibility_result: opp.eligibility_result }, idempotent: true };
    }

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

  recordOperatorSourceVerification(opportunityId, evidence, operatorContext) {
    const auth = assertOperatorAuthorization(operatorContext, { allowTestHarness: this._allowTestHarness });
    if (!auth.ok) return auth;
    const state = this.store.load();
    const opp = state.opportunities.find((o) => o.id === opportunityId);
    if (!opp) return { ok: false, error: 'not_found' };
  if (!evidence?.source_checked_at) {
      return { ok: false, error: 'source_checked_at_required' };
    }
    opp.source_verification_status = SOURCE_VERIFICATION_STATUS.OPERATOR_VERIFIED;
    opp.source_operator_verified_at = evidence.source_checked_at;
    opp.source_verification_note = evidence.note || null;
    opp.published_benefits_verified = Boolean(
      evidence.published_benefits_verified ?? evidence.benefits_verified,
    );
    opp.application_open_verified =
      evidence.application_open_verified === true
        ? true
        : evidence.application_open_verified === false
          ? false
          : null;
    opp.benefits_verified = opp.published_benefits_verified;
    opp.operator_verification_evidence = {
      official_source_url: evidence.official_source_url || opp.official_source_url,
      source_checked_at: evidence.source_checked_at,
      benefit_terms_excerpt: evidence.benefit_terms_excerpt || null,
      restrictions_excerpt: evidence.restrictions_excerpt || null,
      application_status_note: evidence.application_status_note || null,
    };
    state.history.push({
      at: new Date().toISOString(),
      role: WORKFLOW_ROLES.PARTNERSHIP_COORDINATOR,
      event: 'source_operator_verified',
      opportunity_id: opportunityId,
      operator: auth.actor,
    });
    this.store.save(state);
    return { ok: true, opportunity: opp };
  }

  /** Draft application (no send) */
  prepareDraft(opportunityId) {
    const profileCheck = validateOrgProfile(this.orgProfile);
    if (!profileCheck.ok) return profileCheck;
    const state = this.store.load();
    const opp = state.opportunities.find((o) => o.id === opportunityId);
    if (!opp) return { ok: false, error: 'not_found' };
    if (opp.pipeline_state === PIPELINE_STATES.AWAITING_APPROVAL && opp.application_draft) {
      return { ok: true, opportunity: opp, draft: opp.application_draft, classification: 'AWAITING_OWNER_REVIEW', idempotent: true };
    }
    if (!isOperatorVerifiedSource(opp)) {
      return {
        ok: false,
        error: 'source_not_operator_verified',
        classification: 'REQUIRES_OPERATOR_APPROVAL',
        message: 'Drafting blocked until operator verifies the official source (fixtures are example leads only).',
      };
    }
    if (!opp.published_benefits_verified) {
      return {
        ok: false,
        error: 'published_benefits_not_verified',
        classification: 'REQUIRES_OPERATOR_APPROVAL',
        message:
          'Drafting blocked until operator attests published benefit terms and restrictions (automated URL probe is not sufficient).',
      };
    }

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
      .map((o) => {
        const rank = rankOpportunities([o], this.orgProfile)[0] || {};
        return {
          id: o.id,
          provider: o.provider,
          program_name: o.program_name,
          benefit_category: o.benefit_category,
          pipeline_state: o.pipeline_state,
          eligibility_result: o.eligibility_result,
          deadline: o.deadline,
          official_source_url: o.official_source_url,
          intake_kind: o.intake_kind,
          source_verification_status: o.source_verification_status,
          source_claimed_verified_at: o.source_verified_at || null,
          source_operator_verified_at: o.source_operator_verified_at || null,
          benefits_verified: Boolean(o.benefits_verified),
          application_ready: computeApplicationReady(o, this.orgProfile),
          has_draft: Boolean(o.application_draft),
          missing_questions: o.unresolved_questions || [],
          fit_summary: o.eligibility_notes || null,
          priority_score: rank.priority_score ?? null,
          benefit_summary: rank.benefits_verified ? o.benefit_summary : null,
        };
      })
      .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));

    const anyOperatorVerified = opportunities.some((o) => o.source_verification_status === SOURCE_VERIFICATION_STATUS.OPERATOR_VERIFIED);
    return {
      ok: true,
      checked_at: new Date().toISOString(),
      research_status: anyOperatorVerified
        ? 'operator_verified_leads_present'
        : monitor.total
          ? 'example_leads_loaded_unverified'
          : 'no_opportunities_loaded',
      monitor,
      opportunities,
      org_profile_approved: Boolean(this.orgProfile?.approved_by_owner),
      profile_fields_exposed: false,
    };
  }
}

module.exports = { PartnershipsFundingCoordinator };