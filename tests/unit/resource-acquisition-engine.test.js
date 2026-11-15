'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ResourceAcquisitionEngine } = require('../../lib/partnerships-funding/resource-engine');
const { approvedTestProfile, operatorCtx, verifyOpportunitySource } = require('./partnerships-test-helpers');

function tempEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rae-'));
  const fixtureDir = path.join(__dirname, '../fixtures/partnerships');
  return new ResourceAcquisitionEngine({ dir, fixtureDir, allowTestHarness: true });
}

describe('Resource Acquisition Engine', () => {
  test('runAcquisitionPass loads fixtures as example leads', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedTestProfile());
    const pass = engine.runAcquisitionPass();
    expect(pass.ok).toBe(true);
    expect(pass.discover.classification).toBe('EXAMPLE_FIXTURES');
    expect(pass.discover.live_discovery).toBe(false);
    expect(pass.mobile.highest_fit.every((o) => o.application_ready === false)).toBe(true);
  });

  test('build hours ranked with cap while unverified', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedTestProfile());
    engine.runAcquisitionPass();
    const bh = engine.prioritize().ranked.find((r) => r.program_name.includes('Build Hours'));
    expect(bh.priority_score).toBeLessThanOrEqual(49);
    expect(bh.application_ready).toBe(false);
  });

  test('prepareTopDrafts skips until sources operator-verified', () => {
    const engine = tempEngine();
    engine.setOrgProfile(approvedTestProfile());
    const pass = engine.runAcquisitionPass({ draftLimit: 1 });
    expect(pass.prepare.ok).toBe(true);
    expect(pass.prepare.prepared).toHaveLength(0);
  });
});