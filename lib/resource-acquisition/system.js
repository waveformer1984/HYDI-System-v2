'use strict';

const { createResourceActionRunner } = require('./actions');
const { buildResourceDashboard } = require('./dashboard-snapshot');
const { runLiveReachabilityCheck } = require('./live-fetch');
const { multiBucketRankings } = require('./intelligence');

/**
 * Master facade — partnerships coordinator + discovery + intelligence + actions.
 * No background daemon; invoke via CLI or mission one-shot.
 */
class HydiResourceAcquisitionSystem {
  constructor(opts = {}) {
    this.runner = createResourceActionRunner(opts);
  }

  setOrgProfile(profile) {
    return this.runner.engine.setOrgProfile(profile);
  }

  async runCycle({ mode = 'weekly', profile = null, liveReachability = false } = {}) {
    if (profile) this.setOrgProfile(profile);
    const trace = { mode, started_at: new Date().toISOString(), steps: [] };

    const discover = await this.runner.run('resource.discover', {
      includeSeeds: true,
      includeOperator: true,
      includeFixtures: mode === 'weekly' || mode === 'monthly',
    });
    trace.steps.push({ action: 'resource.discover', ok: discover.ok });

    const qualify = await this.runner.run('resource.qualify');
    trace.steps.push({ action: 'resource.qualify', ok: qualify.ok, skipped: !profile });

    const rank = await this.runner.run('resource.rank');
    trace.steps.push({ action: 'resource.rank', ok: rank.ok });

    let live = null;
    if (liveReachability && process.env.HYDI_ALLOW_LIVE_DISCOVERY === '1') {
      const urls = rank.output.ranked.map((o) => o.official_source_url).filter(Boolean);
      live = await runLiveReachabilityCheck(urls);
      trace.steps.push({ action: 'live_reachability', ok: live.ok, checked: live.checked });
    }

    const mobile = this.dashboardSnapshot();
    trace.completed_at = new Date().toISOString();
    return { ok: true, trace, discover, qualify, rank, live, mobile };
  }

  dashboardSnapshot() {
    const base = this.runner.engine.acquisitionSnapshot();
    const state = this.runner.engine.coordinator.store.load();
    const intel = multiBucketRankings(state.opportunities, this.runner.engine.coordinator.orgProfile);
    return {
      ...base,
      dashboard: buildResourceDashboard(base, intel),
      intelligence_buckets: Object.keys(intel.buckets),
    };
  }
}

module.exports = { HydiResourceAcquisitionSystem };