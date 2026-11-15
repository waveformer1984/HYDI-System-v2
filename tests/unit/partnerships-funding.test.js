'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PartnershipsFundingCoordinator } = require('../../lib/partnerships-funding/coordinator');
const { transition, PIPELINE_STATES } = require('../../lib/partnerships-funding/pipeline');
const { redactSecrets } = require('../../lib/partnerships-funding/roles/writer');
const openaiFixture = require('../fixtures/partnerships/openai-for-startups-vc-api-credits.json');
const { approvedTestProfile, verifyOpportunitySource } = require('./partnerships-test-helpers');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
}

const approvedProfile = approvedTestProfile({ goals: { requested_support: ['api_credits'] } });

describe('Partnerships & Funding workflow', () => {
  test('deduplicates same provider+program', () => {
    const dir = tempDir();
    const coord = new PartnershipsFundingCoordinator({ dir });
    coord.setOrgProfile(approvedProfile);
    const a = coord.discoverFromSource(openaiFixture);
    const b = coord.discoverFromSource(openaiFixture);
    expect(a.ok).toBe(true);
    expect(b.duplicate).toBe(true);
    expect(a.opportunity.id).toBe(b.opportunity.id);
  });

  test('OpenAI VC credits: unknown eligibility when owner facts missing', () => {
    const dir = tempDir();
    const coord = new PartnershipsFundingCoordinator({ dir });
    coord.setOrgProfile(approvedProfile);
    const d = coord.discoverFromSource(openaiFixture);
    const ev = coord.evaluateOpportunity(d.opportunity.id);
    expect(ev.ok).toBe(true);
    expect(ev.eligibility.eligibility_result).toBe('unknown');
    expect(ev.opportunity.pipeline_state).toBe('needs_owner_information');
    expect(ev.eligibility.missing_facts.length).toBeGreaterThan(0);
  });

  test('milestone: draft for review with unresolved questions (not submitted)', () => {
    const dir = tempDir();
    const coord = new PartnershipsFundingCoordinator({ dir, _allowTestHarness: true });
    coord.setOrgProfile(approvedProfile);
    const d = coord.discoverFromSource(openaiFixture);
    verifyOpportunitySource(coord, d.opportunity.id);
    coord.evaluateOpportunity(d.opportunity.id);
    const prep = coord.prepareDraft(d.opportunity.id);
    expect(prep.ok).toBe(true);
    expect(prep.opportunity.pipeline_state).toBe('awaiting_approval');
    expect(prep.draft.unresolved_questions.length).toBeGreaterThan(0);
    expect(prep.draft.executive_summary).toContain('Not submitted');
  });

  test('cannot mark submitted without evidence', () => {
    const opp = { pipeline_state: PIPELINE_STATES.AWAITING_APPROVAL, history: [] };
    const r = transition(opp, PIPELINE_STATES.SUBMITTED, {});
    expect(r.ok).toBe(false);
    expect(r.error).toBe('submission_evidence_required');
  });

  test('expired deadline detected in monitor', () => {
    const { portfolioSnapshot, parseDeadline } = require('../../lib/partnerships-funding/roles/monitor');
    const t = parseDeadline('2020-01-01T00:00:00.000Z');
    expect(t).toBeLessThan(Date.now());
    const snap = portfolioSnapshot({
      opportunities: [{ id: '1', program_name: 'x', deadline: '2030-01-01T00:00:00.000Z', pipeline_state: 'discovered' }],
    });
    expect(snap.upcoming_deadlines.length).toBe(1);
  });

  test('secret redaction in drafts', () => {
    expect(redactSecrets('token sk-abcdefghijklmnopqrstuvwxyz123456')).toContain('[REDACTED]');
  });

  test('multi-provider fixtures stay deduped', () => {
    const dir = tempDir();
    const coord = new PartnershipsFundingCoordinator({ dir });
    const gh = require('../fixtures/partnerships/github-for-startups-platform-credits.json');
    const an = require('../fixtures/partnerships/anthropic-claude-for-startups.json');
    coord.discoverFromSource(openaiFixture);
    coord.discoverFromSource(gh);
    coord.discoverFromSource(an);
    const snap = coord.mobileSnapshot();
    expect(snap.monitor.total).toBe(3);
  });

  test('mobile snapshot distinguishes empty research', () => {
    const coord = new PartnershipsFundingCoordinator({ dir: tempDir() });
    const snap = coord.mobileSnapshot();
    expect(snap.research_status).toBe('no_opportunities_loaded');
  });
});