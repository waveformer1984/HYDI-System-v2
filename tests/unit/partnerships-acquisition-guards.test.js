'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ResourceAcquisitionEngine } = require('../../lib/partnerships-funding/resource-engine');
const { PartnershipsFundingCoordinator } = require('../../lib/partnerships-funding/coordinator');
const { approvedTestProfile, operatorCtx, verifyOpportunitySource } = require('./partnerships-test-helpers');
const openaiFixture = require('../fixtures/partnerships/openai-for-startups-vc-api-credits.json');

function tempEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pag-'));
  const fixtureDir = path.join(__dirname, '../fixtures/partnerships');
  return new ResourceAcquisitionEngine({ dir, fixtureDir, allowTestHarness: true });
}

describe('Partnerships acquisition guards (PR #593 review)', () => {
  test('unapproved profile cannot setOrgProfile with agent-only approved flag', () => {
    const coord = new PartnershipsFundingCoordinator({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'p-')) });
    const bad = coord.setOrgProfile({ ...approvedTestProfile(), owner_approval_record: undefined, approved_by_owner: true });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('owner_approval_record_required');
  });

  test('unapproved profile cannot produce application drafts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p-'));
    const coord = new PartnershipsFundingCoordinator({ dir, _allowTestHarness: true });
    const d = coord.discoverFromSource({ ...openaiFixture, intake_kind: 'example_fixture' });
    coord.evaluateOpportunity(d.opportunity.id);
    const prep = coord.prepareDraft(d.opportunity.id);
    expect(prep.ok).toBe(false);
    expect(prep.error).toBe('invalid_profile');
  });

  test('operator source without published terms blocks prepare', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p-'));
    const coord = new PartnershipsFundingCoordinator({ dir, _allowTestHarness: true });
    coord.setOrgProfile(approvedTestProfile());
    const d = coord.discoverFromSource({ ...openaiFixture, intake_kind: 'example_fixture' });
    coord.recordOperatorSourceVerification(
      d.opportunity.id,
      { source_checked_at: '2026-11-15T12:00:00.000Z', published_benefits_verified: false },
      operatorCtx,
    );
    coord.evaluateOpportunity(d.opportunity.id);
    const blocked = coord.prepareDraft(d.opportunity.id);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('published_benefits_not_verified');
  });

  test('approved profile still blocked until operator verifies source', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p-'));
    const coord = new PartnershipsFundingCoordinator({ dir, _allowTestHarness: true });
    coord.setOrgProfile(approvedTestProfile());
    const d = coord.discoverFromSource({ ...openaiFixture, intake_kind: 'example_fixture' });
    coord.evaluateOpportunity(d.opportunity.id);
    const blocked = coord.prepareDraft(d.opportunity.id);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe('source_not_operator_verified');
  });

  test('fixture data stays visibly unverified in mobile snapshot', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedTestProfile());
    engine.runAcquisitionPass();
    const snap = engine.acquisitionSnapshot();
    expect(snap.fixture_backed).toBe(true);
    expect(snap.live_discovery).toBe(false);
    expect(snap.research_status).toBe('example_leads_loaded_unverified');
    expect(snap.highest_fit.every((o) => o.application_ready === false)).toBe(true);
    expect(snap.highest_fit.every((o) => o.source_verification_status === 'example_unverified')).toBe(true);
  });

  test('priority score cap prevents unverified from looking application-ready', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedTestProfile());
    engine.runAcquisitionPass();
    const ranked = engine.prioritize().ranked;
    for (const o of ranked) {
      if (o.source_verification_status === 'example_unverified') {
        expect(o.priority_score).toBeLessThanOrEqual(49);
        expect(o.application_ready).toBe(false);
      }
    }
  });

  test('submission reference alone is insufficient without operator authorization', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedTestProfile());
    const d = engine.discoverFromSource(openaiFixture);
    verifyOpportunitySource(engine.coordinator, d.opportunity.id);
    engine.coordinator.evaluateOpportunity(d.opportunity.id);
    engine.coordinator.prepareDraft(d.opportunity.id);
    const noAuth = engine.recordSubmission(d.opportunity.id, { submission_reference: 'ticket-1', destination: 'portal' }, {});
    expect(noAuth.ok).toBe(false);
    const withAuth = engine.recordSubmission(
      d.opportunity.id,
      { submission_reference: 'ticket-1', destination: 'portal' },
      operatorCtx,
    );
    expect(withAuth.ok).toBe(true);
  });

  test('award blocked without operator authorization', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedTestProfile());
    const d = engine.discoverFromSource(openaiFixture);
    verifyOpportunitySource(engine.coordinator, d.opportunity.id);
    engine.coordinator.evaluateOpportunity(d.opportunity.id);
    engine.coordinator.prepareDraft(d.opportunity.id);
    engine.recordSubmission(d.opportunity.id, { submission_reference: 'x', destination: 'y' }, operatorCtx);
    expect(engine.recordAward(d.opportunity.id, { award_reference: 'email-1' }, {}).ok).toBe(false);
    expect(engine.recordAward(d.opportunity.id, { award_reference: 'email-1' }, operatorCtx).ok).toBe(true);
  });

  test('re-running acquisition pass does not duplicate opportunities or drafts', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedTestProfile());
    engine.runAcquisitionPass({ draftLimit: 1 });
    const first = engine.coordinator.store.load();
    const top = engine.prioritize().ranked[0];
    verifyOpportunitySource(engine.coordinator, top.id);
    engine.coordinator.evaluateOpportunity(top.id);
    const firstDraft = engine.coordinator.prepareDraft(top.id);
    expect(firstDraft.ok).toBe(true);
    engine.runAcquisitionPass({ draftLimit: 1 });
    const second = engine.coordinator.store.load();
    expect(second.opportunities.length).toBe(first.opportunities.length);
    const again = engine.coordinator.prepareDraft(top.id);
    expect(again.ok).toBe(true);
    expect(again.idempotent).toBe(true);
  });

  test('mobile snapshot does not leak private profile fields', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p-'));
    const coord = new PartnershipsFundingCoordinator({ dir, _allowTestHarness: true });
    coord.setOrgProfile(approvedTestProfile({ legal: { entity_name: 'Acme LLC', business_email: 'owner@secret.test' } }));
    coord.discoverFromSource(openaiFixture);
    const snap = coord.mobileSnapshot();
    const blob = JSON.stringify(snap);
    expect(blob).not.toContain('owner@secret.test');
    expect(snap.profile_fields_exposed).toBe(false);
    expect(snap.opportunities[0].benefit_summary).toBeNull();
  });
});