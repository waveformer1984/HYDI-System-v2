'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ResourceAcquisitionEngine } = require('../../lib/partnerships-funding/resource-engine');

const approvedProfile = {
  approved_by_owner: true,
  legal: { entity_name: 'UNKNOWN', business_email: 'UNKNOWN' },
  classification: { structure: 'open_source' },
  funding: { vc_backed: 'UNKNOWN', vc_partner_name: 'UNKNOWN' },
  product: { one_line_description: 'HYDI' },
  goals: { requested_support: ['api_credits', 'technical_support'] },
  sharing: {},
};

function tempEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rae-'));
  const fixtureDir = path.join(__dirname, '../fixtures/partnerships');
  return new ResourceAcquisitionEngine({ dir, fixtureDir });
}

describe('Resource Acquisition Engine', () => {
  test('runAcquisitionPass loads fixtures and ranks', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedProfile);
    const pass = engine.runAcquisitionPass();
    expect(pass.ok).toBe(true);
    expect(pass.discover.count).toBeGreaterThanOrEqual(3);
    expect(pass.rank.length).toBeGreaterThanOrEqual(3);
    expect(pass.mobile.highest_fit.length).toBeGreaterThan(0);
    expect(pass.mobile.recurring_discovery.enabled).toBe(false);
  });

  test('build hours ranks above ineligible paths when education matches goal', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedProfile);
    engine.runAcquisitionPass();
    const bh = engine.prioritize().ranked.find((r) => r.program_name.includes('Build Hours'));
    const vc = engine.prioritize().ranked.find((r) => r.program_name.includes('VC partners'));
    expect(bh.priority_score).toBeGreaterThan(vc.priority_score);
  });

  test('submission blocked without evidence', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedProfile);
    const pass = engine.runAcquisitionPass({ draftLimit: 1 });
    const top = pass.rank[0];
    const prep = engine.coordinator.prepareDraft(top.id);
    expect(prep.ok).toBe(true);
    const sub = engine.recordSubmission(top.id, {});
    expect(sub.ok).toBe(false);
  });

  test('submission succeeds only with reference', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedProfile);
    engine.runAcquisitionPass({ draftLimit: 1 });
    const top = engine.prioritize().ranked[0];
    engine.coordinator.prepareDraft(top.id);
    const sub = engine.recordSubmission(top.id, {
      submission_reference: 'operator-ticket-42',
      destination: 'openai-startup-vc-portal',
      at: '2026-11-15T00:00:00.000Z',
    });
    expect(sub.ok).toBe(true);
    expect(sub.opportunity.pipeline_state).toBe('submitted');
  });

  test('award requires award_reference', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedProfile);
    const id = engine.discoverFromSource(require('../fixtures/partnerships/openai-build-hours.json')).opportunity.id;
    engine.coordinator.evaluateOpportunity(id);
    engine.coordinator.prepareDraft(id);
    engine.recordSubmission(id, { submission_reference: 'x', destination: 'y' });
    const bad = engine.recordAward(id, {});
    expect(bad.ok).toBe(false);
    const good = engine.recordAward(id, {
      award_reference: 'email-confirmation-id',
      benefit_type: 'technical_support',
    });
    expect(good.ok).toBe(true);
    expect(good.integration.automatic_integration).toBe(false);
  });
});