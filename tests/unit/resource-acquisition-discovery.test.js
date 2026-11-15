'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { HydiResourceAcquisitionSystem } = require('../../lib/resource-acquisition/system');
const { approvedTestProfile } = require('./partnerships-test-helpers');

describe('Resource acquisition discovery registry', () => {
  test('curated seeds dedupe to unique opportunities', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-'));
    const system = new HydiResourceAcquisitionSystem({ dir, allowTestHarness: true });
    const out = await system.runCycle({ mode: 'weekly' });
    expect(out.discover.ok).toBe(true);
    expect(out.discover.output.intake_count).toBeGreaterThanOrEqual(40);
    const state = system.runner.engine.coordinator.store.load();
    expect(state.opportunities.length).toBeGreaterThanOrEqual(40);
    const keys = new Set(state.opportunities.map((o) => o.dedup_key));
    expect(keys.size).toBe(state.opportunities.length);
  });

  test('dashboard separates potential from awarded value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-'));
    const system = new HydiResourceAcquisitionSystem({ dir, allowTestHarness: true });
    system.setOrgProfile(approvedTestProfile());
    return system.runCycle({ mode: 'daily', profile: approvedTestProfile() }).then(() => {
      const dash = system.dashboardSnapshot().dashboard;
      expect(dash.resource_value.confirmed_funding_usd).toBeNull();
      expect(dash.resource_value.note).toMatch(/not inferred/i);
      expect(dash.resource_overview.fixture_backed).toBe(true);
    });
  });
});