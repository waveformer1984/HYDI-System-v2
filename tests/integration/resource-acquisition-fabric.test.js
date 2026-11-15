'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { HydiResourceAcquisitionSystem } = require('../../lib/resource-acquisition/system');
const { approvedTestProfile, operatorCtx, verifyOpportunitySource } = require('../unit/partnerships-test-helpers');

describe('Resource acquisition fabric integration', () => {
  test('discover → qualify → rank → prepare with operator gates', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raf-'));
    const system = new HydiResourceAcquisitionSystem({ dir, allowTestHarness: true });
    const profile = approvedTestProfile();
    await system.runCycle({ mode: 'weekly', profile });

    const rank = await system.runner.run('resource.rank');
    const top = rank.output.ranked[0];
    verifyOpportunitySource(system.runner.engine.coordinator, top.id);

    await system.runner.run('resource.qualify', { profile });
    const prep = await system.runner.run('resource.prepare_application', { opportunityId: top.id, profile });
    expect(prep.output.prepare.ok).toBe(true);

    const approval = await system.runner.run('resource.request_approval', { opportunityId: top.id });
    expect(approval.output.requires).toBe('human:owner');

    const sub = await system.runner.run(
      'resource.record_submission',
      { opportunityId: top.id, evidence: { submission_reference: 'TRACE-1', destination: 'portal' } },
      operatorCtx,
    );
    expect(sub.output.ok).toBe(true);

    const track = await system.runner.run('resource.track_application', { opportunityId: top.id });
    expect(track.output.submission_evidence.reference).toBe('TRACE-1');
  });
});