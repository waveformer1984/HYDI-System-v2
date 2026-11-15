'use strict';

const { ResourceAcquisitionEngine } = require('../partnerships-funding/resource-engine');
const { ResourceDiscoveryEngine } = require('./discovery-engine');
const { multiBucketRankings } = require('./intelligence');
const { buildHydiProjectPackage, applicationChecklist } = require('./application-kit');
const { enrichOpportunityRecord } = require('./opportunity-schema');
const { assertOperatorAuthorization } = require('../partnerships-funding/operator-auth');

const ACTION_SPECS = Object.freeze({
  'resource.discover': { risk: 'R0', mutates: true },
  'resource.validate': { risk: 'R0', mutates: true },
  'resource.qualify': { risk: 'R0', mutates: true },
  'resource.rank': { risk: 'R0', mutates: false },
  'resource.prepare_application': { risk: 'R1', mutates: true },
  'resource.request_approval': { risk: 'R1', mutates: false },
  'resource.record_submission': { risk: 'R2', mutates: true },
  'resource.track_application': { risk: 'R0', mutates: false },
  'resource.record_award': { risk: 'R2', mutates: true },
  'resource.integrate': { risk: 'R2', mutates: false },
});

function createResourceActionRunner(opts = {}) {
  const engine = new ResourceAcquisitionEngine({ ...opts, allowTestHarness: Boolean(opts.allowTestHarness) });
  const discovery = new ResourceDiscoveryEngine({ coordinator: engine.coordinator, operatorIntakeDir: opts.operatorIntakeDir });

  async function run(action, input = {}, operatorContext = null) {
    const spec = ACTION_SPECS[action];
    if (!spec) return { ok: false, error: 'unknown_action', action };

    if (action === 'resource.discover') {
      const batch = discovery.discoverBatch({
        includeSeeds: input.includeSeeds !== false,
        includeOperator: input.includeOperator !== false,
        includeFixtures: Boolean(input.includeFixtures),
        fixtureDiscover: input.includeFixtures ? () => engine.discoverBundledFixtures() : null,
      });
      return { ok: true, action, output: batch };
    }

    if (action === 'resource.qualify') {
      if (input.profile) engine.setOrgProfile(input.profile);
      return { ok: true, action, output: engine.qualifyAll() };
    }

    if (action === 'resource.validate') {
      const auth = assertOperatorAuthorization(operatorContext, { allowTestHarness: engine.allowTestHarness });
      if (!auth.ok) return { ok: false, action, ...auth };
      const { opportunityId, evidence } = input;
      return { ok: true, action, output: engine.recordOperatorSourceVerification(opportunityId, evidence, operatorContext) };
    }

    if (action === 'resource.rank') {
      const state = engine.coordinator.store.load();
      const enriched = state.opportunities.map(enrichOpportunityRecord);
      const ranked = multiBucketRankings(enriched, engine.coordinator.orgProfile);
      return { ok: true, action, output: ranked };
    }

    if (action === 'resource.prepare_application') {
      if (input.profile) engine.setOrgProfile(input.profile);
      const id = input.opportunityId;
      const prep = id ? engine.coordinator.prepareDraft(id) : engine.prepareTopDrafts({ limit: input.limit || 1 });
      const kit = buildHydiProjectPackage();
      return { ok: true, action, output: { prepare: prep, project_package: kit } };
    }

    if (action === 'resource.request_approval') {
      const state = engine.coordinator.store.load();
      const opp = state.opportunities.find((o) => o.id === input.opportunityId);
      if (!opp) return { ok: false, error: 'not_found' };
      return {
        ok: true,
        action,
        output: {
          requires: 'human:owner',
          checklist: applicationChecklist(opp, opp.application_draft),
          classification: 'AWAITING_OWNER_REVIEW',
        },
      };
    }

    if (action === 'resource.record_submission') {
      return {
        ok: true,
        action,
        output: engine.recordSubmission(input.opportunityId, input.evidence, operatorContext),
      };
    }

    if (action === 'resource.track_application') {
      const state = engine.coordinator.store.load();
      const opp = state.opportunities.find((o) => o.id === input.opportunityId);
      if (!opp) return { ok: false, error: 'not_found' };
      return {
        ok: true,
        action,
        output: {
          opportunity: enrichOpportunityRecord(opp),
          submission_evidence: opp.submission_evidence || null,
          award: opp.award || null,
        },
      };
    }

    if (action === 'resource.record_award') {
      return { ok: true, action, output: engine.recordAward(input.opportunityId, input.evidence, operatorContext) };
    }

    if (action === 'resource.integrate') {
      const state = engine.coordinator.store.load();
      const opp = state.opportunities.find((o) => o.id === input.opportunityId);
      if (!opp?.award) return { ok: false, error: 'award_required' };
      const { integrationPlan } = require('../partnerships-funding/integration');
      return { ok: true, action, output: integrationPlan(opp) };
    }

    return { ok: false, error: 'unhandled_action', action };
  }

  return { engine, discovery, run, ACTION_SPECS };
}

module.exports = { createResourceActionRunner, ACTION_SPECS };